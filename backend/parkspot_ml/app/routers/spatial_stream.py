"""
Real-time Spatial Streaming v2

Uses the HNSF model's structure predictions to place wall points.
The model predicts 4 wall distances, which we convert to world positions.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional, Set
import torch
import numpy as np
import asyncio
import json
import math
from pathlib import Path
from datetime import datetime

router = APIRouter(tags=["spatial"])

# Connected WebSocket clients
sensor_clients: Set[WebSocket] = set()
viewer_clients: Set[WebSocket] = set()

# Model cache
_model = None
_device = None


def get_model():
    """Load or return cached model."""
    global _model, _device

    if _model is None:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from naf.hybrid_model import create_hybrid_model

        # Detect device
        if torch.backends.mps.is_available():
            _device = 'mps'
        elif torch.cuda.is_available():
            _device = 'cuda'
        else:
            _device = 'cpu'

        # Load model
        checkpoint_path = Path(__file__).parent.parent.parent / "naf_checkpoints" / "hybrid_best.pt"
        if not checkpoint_path.exists():
            checkpoint_path = Path("/app/naf_checkpoints/best_model.pt")

        _model = create_hybrid_model(device=_device)

        if checkpoint_path.exists():
            checkpoint = torch.load(checkpoint_path, map_location=_device, weights_only=False)
            if 'model_state_dict' in checkpoint:
                _model.load_state_dict(checkpoint['model_state_dict'])
            else:
                _model.load_state_dict(checkpoint)
            print(f"[Spatial] Loaded model from {checkpoint_path}")
        else:
            print("[Spatial] WARNING: No checkpoint found, using random weights")

        _model.eval()

    return _model, _device


def predict_walls(
    position: List[float],
    orientation: List[float],
    rf_rssi: List[float],
    stft_mag: Optional[List[float]] = None,
    stft_time_bins: int = 0,
    stft_freq_bins: int = 0
) -> Dict:
    """
    Use model to predict wall locations around the listener.

    The model's 'structure' output has 4 values representing distances
    to walls in 4 directions (front, right, back, left) relative to
    the listener's orientation.

    Args:
        position: [x, y, z] listener position
        orientation: [theta, phi] orientation angles
        rf_rssi: BLE beacon RSSI values
        stft_mag: Flattened STFT magnitude array (optional, for acoustic input)
        stft_time_bins: Number of time bins in STFT
        stft_freq_bins: Number of frequency bins in STFT

    Returns wall points in world coordinates.
    """
    model, device = get_model()

    # Prepare inputs
    pos = torch.tensor([position], dtype=torch.float32, device=device)
    orient = torch.tensor([orientation], dtype=torch.float32, device=device)
    rf = torch.tensor([rf_rssi], dtype=torch.float32, device=device)

    # Prepare acoustic input if available
    acoustic_mag = None
    time_coord = None
    freq_coord = None

    if stft_mag and len(stft_mag) > 0 and stft_time_bins > 0 and stft_freq_bins > 0:
        # Sample a representative point from the STFT (center bin)
        center_idx = len(stft_mag) // 2
        acoustic_mag = torch.tensor([stft_mag[center_idx]], dtype=torch.float32, device=device)
        # Normalized time/freq coordinates (0-1)
        time_coord = torch.tensor([0.5], dtype=torch.float32, device=device)
        freq_coord = torch.tensor([0.5], dtype=torch.float32, device=device)

    with torch.no_grad():
        # Use full model forward if we have acoustic data
        if acoustic_mag is not None:
            result = model(
                listener_pos=pos,
                emitter_pos=pos,  # Same as listener for phone
                orientation=orient,
                channel=torch.zeros(1, dtype=torch.float32, device=device),
                time=time_coord,
                freq=freq_coord,
                acoustic_mag=acoustic_mag,
                rf_rssi=rf
            )
        else:
            # Fallback to predict_scene (no acoustic)
            result = model.predict_scene(pos, orientation=orient, rf_rssi=rf)

        # Structure: 4 values - scale from model output to wall distances
        # Model outputs small normalized values, scale to 0-10 meter range
        raw_structure = result['structure'][0].cpu().numpy()
        # Use sigmoid-like scaling: values are typically 0-0.1, scale to 1-8 meters
        structure = 1.0 + np.abs(raw_structure) * 50  # Scale up to wall distances
        structure = np.clip(structure, 0.5, 10.0)  # Clamp to reasonable range

        loudness = result['loudness'].item()

    # Convert relative distances to world positions
    # Use listener orientation (yaw) to rotate directions
    yaw = orientation[0]  # radians

    # 4 directions relative to listener facing (spaced 90 degrees)
    # Front, Right, Back, Left
    dir_offsets = [0, math.pi/2, math.pi, -math.pi/2]

    wall_points = []
    wall_colors = []

    # Always generate wall points in 4 directions
    for i, dir_offset in enumerate(dir_offsets):
        dist = float(structure[i])

        # Calculate wall point position in world coordinates
        world_yaw = yaw + dir_offset
        wall_x = position[0] + dist * math.cos(world_yaw)
        wall_y = position[1] + dist * math.sin(world_yaw)
        wall_z = position[2]

        wall_points.append([wall_x, wall_y, wall_z])

        # Color based on distance (close = red, far = blue)
        t = min(1.0, dist / 8.0)
        wall_colors.append([1 - t, t * 0.7, t])

        # Add vertical points for wall height
        for z_offset in [-1.5, -0.75, 0.75, 1.5]:
            wall_z = position[2] + z_offset
            wall_points.append([wall_x, wall_y, wall_z])
            wall_colors.append([1 - t, t * 0.7, t])

    return {
        "wall_points": wall_points,
        "wall_colors": wall_colors,
        "structure": structure.tolist(),
        "loudness": loudness,
        "position": position,
        "orientation": orientation
    }


@router.websocket("/stream")
async def spatial_stream(websocket: WebSocket):
    """
    WebSocket endpoint for phone to send sensor data.
    Receives sensor updates, runs model inference, broadcasts to viewers.
    """
    await websocket.accept()
    sensor_clients.add(websocket)
    print(f"[Spatial] Sensor client connected. Total: {len(sensor_clients)}")

    try:
        while True:
            data = await websocket.receive_json()

            if data.get("type") == "sensor_data":
                position = data.get("position", [0, 0, 0])
                orientation = data.get("orientation", [0, 0])
                rf_rssi = data.get("rf_rssi", [-100] * 16)
                stft_data = data.get("stft")  # Acoustic STFT from phone

                # Pad RF if needed
                while len(rf_rssi) < 16:
                    rf_rssi.append(-100)
                rf_rssi = rf_rssi[:16]

                # DEBUG: Log what we're receiving every 50 updates
                import random
                if random.random() < 0.02:  # ~2% of updates
                    has_stft = bool(stft_data and stft_data.get("magnitude"))
                    avg_rssi = sum(rf_rssi) / len(rf_rssi)
                    strong_beacons = sum(1 for r in rf_rssi if r > -80)
                    print(f"[DEBUG] RF avg={avg_rssi:.1f}dBm, strong={strong_beacons}, STFT={has_stft}")

                # Extract STFT if available
                stft_mag = None
                stft_time_bins = 0
                stft_freq_bins = 0
                if stft_data and stft_data.get("magnitude"):
                    stft_mag = stft_data.get("magnitude")
                    stft_time_bins = stft_data.get("timeBins", 0)
                    stft_freq_bins = stft_data.get("freqBins", 0)

                # Get wall predictions from model (with optional acoustic input)
                wall_data = predict_walls(
                    position=position,
                    orientation=orientation,
                    rf_rssi=rf_rssi,
                    stft_mag=stft_mag,
                    stft_time_bins=stft_time_bins,
                    stft_freq_bins=stft_freq_bins
                )

                # Prepare message for viewers
                update = {
                    "type": "spatial_update",
                    "phone_position": position,
                    "phone_orientation": orientation,
                    "wall_points": wall_data["wall_points"],
                    "wall_colors": wall_data["wall_colors"],
                    "structure": wall_data["structure"],
                    "loudness": wall_data["loudness"],
                    "timestamp": datetime.now().isoformat()
                }

                # Broadcast to all viewers
                disconnected = []
                for client in viewer_clients:
                    try:
                        await client.send_json(update)
                    except:
                        disconnected.append(client)

                for client in disconnected:
                    viewer_clients.discard(client)

                # Ack to sender
                await websocket.send_json({
                    "type": "ack",
                    "walls_detected": len(wall_data["wall_points"]),
                    "structure": wall_data["structure"]
                })

            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        sensor_clients.discard(websocket)
        print(f"[Spatial] Sensor client disconnected. Total: {len(sensor_clients)}")
    except Exception as e:
        print(f"[Spatial] Stream error: {e}")
        sensor_clients.discard(websocket)


@router.websocket("/viewer")
async def spatial_viewer(websocket: WebSocket):
    """
    WebSocket endpoint for 3D viewers to receive spatial updates.
    """
    await websocket.accept()
    viewer_clients.add(websocket)
    print(f"[Spatial] Viewer connected. Total: {len(viewer_clients)}")

    # Send welcome message
    await websocket.send_json({
        "type": "welcome",
        "message": "Connected to spatial stream. Waiting for sensor data...",
        "viewers": len(viewer_clients),
        "sensors": len(sensor_clients)
    })

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        viewer_clients.discard(websocket)
        print(f"[Spatial] Viewer disconnected. Total: {len(viewer_clients)}")
    except Exception as e:
        print(f"[Spatial] Viewer error: {e}")
        viewer_clients.discard(websocket)


@router.get("/status")
async def spatial_status():
    """Get streaming status."""
    return {
        "sensor_clients": len(sensor_clients),
        "viewer_clients": len(viewer_clients),
        "model_loaded": _model is not None
    }


@router.get("/test-predict")
async def test_predict():
    """Test wall prediction at origin."""
    result = predict_walls(
        position=[0, 0, 0],
        orientation=[0, 0],
        rf_rssi=[-70, -75, -80, -85, -90] + [-100] * 11
    )
    return result
