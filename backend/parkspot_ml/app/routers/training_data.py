"""
NAF Training Data API Router

Endpoints for receiving and storing training data from mobile devices.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import numpy as np
from pathlib import Path
import json
from datetime import datetime

router = APIRouter()

# Storage directory
DATA_DIR = Path("training_data")
DATA_DIR.mkdir(exist_ok=True)


class NafSampleUpload(BaseModel):
    timestamp: float
    listener_pos: List[float]
    emitter_pos: List[float]
    orientation: List[float]
    channel: int
    stft_mag_flat: List[float]
    stft_phase_flat: Optional[List[float]] = None
    num_time_bins: int
    num_freq_bins: int
    # RF data for hybrid HNSF model
    rf_rssi: Optional[List[float]] = None  # RSSI vector (16 beacons)
    rf_beacon_count: Optional[int] = 0


class TrainingDataUpload(BaseModel):
    samples: List[NafSampleUpload]
    device_id: str
    session_id: str


class UploadResponse(BaseModel):
    success: bool
    samples_received: int
    session_id: str
    storage_path: str


@router.post("/training-data", response_model=UploadResponse)
async def upload_training_data(data: TrainingDataUpload):
    """
    Receive and store NAF training data from mobile devices.

    Reconstructs 2D STFT arrays and saves as NPZ for training.
    """
    try:
        session_dir = DATA_DIR / data.device_id / data.session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        saved_count = 0

        for i, sample in enumerate(data.samples):
            # Reconstruct 2D STFT from flat arrays
            stft_mag = np.array(sample.stft_mag_flat).reshape(
                sample.num_time_bins, sample.num_freq_bins
            )

            stft_if = np.zeros_like(stft_mag)
            if sample.stft_phase_flat:
                stft_if = np.array(sample.stft_phase_flat).reshape(
                    sample.num_time_bins, sample.num_freq_bins
                )

            # Prepare RF data (default to zeros if not provided)
            rf_rssi = np.array(sample.rf_rssi if sample.rf_rssi else [-100] * 16, dtype=np.float32)
            rf_beacon_count = np.array(sample.rf_beacon_count or 0, dtype=np.int32)

            # Save as NPZ with hybrid data
            sample_path = session_dir / f"sample_{i:04d}.npz"
            np.savez_compressed(
                sample_path,
                listener_pos=np.array(sample.listener_pos, dtype=np.float32),
                emitter_pos=np.array(sample.emitter_pos, dtype=np.float32),
                orientation=np.array(sample.orientation, dtype=np.float32),
                channel=np.array(sample.channel, dtype=np.int32),
                stft_mag=stft_mag.astype(np.float32),
                stft_if=stft_if.astype(np.float32),
                rf_rssi=rf_rssi,
                rf_beacon_count=rf_beacon_count,
                timestamp=np.array(sample.timestamp)
            )
            saved_count += 1

        # Save session metadata
        meta_path = session_dir / "metadata.json"
        with open(meta_path, 'w') as f:
            json.dump({
                'device_id': data.device_id,
                'session_id': data.session_id,
                'sample_count': saved_count,
                'created': datetime.now().isoformat()
            }, f, indent=2)

        print(f"[NAF] Saved {saved_count} samples to {session_dir}")

        return UploadResponse(
            success=True,
            samples_received=saved_count,
            session_id=data.session_id,
            storage_path=str(session_dir)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/training-data/sessions")
async def list_sessions():
    """List all training data sessions."""
    sessions = []

    for device_dir in DATA_DIR.iterdir():
        if device_dir.is_dir():
            for session_dir in device_dir.iterdir():
                if session_dir.is_dir():
                    meta_path = session_dir / "metadata.json"
                    if meta_path.exists():
                        with open(meta_path) as f:
                            meta = json.load(f)
                            sessions.append(meta)
                    else:
                        # Count samples manually
                        sample_count = len(list(session_dir.glob("*.npz")))
                        sessions.append({
                            'device_id': device_dir.name,
                            'session_id': session_dir.name,
                            'sample_count': sample_count
                        })

    return {
        'sessions': sessions,
        'total_sessions': len(sessions)
    }


@router.get("/training-data/stats")
async def training_data_stats():
    """Get statistics about collected training data."""
    total_samples = 0
    total_sessions = 0
    devices = set()

    for device_dir in DATA_DIR.iterdir():
        if device_dir.is_dir():
            devices.add(device_dir.name)
            for session_dir in device_dir.iterdir():
                if session_dir.is_dir():
                    total_sessions += 1
                    total_samples += len(list(session_dir.glob("*.npz")))

    return {
        'total_samples': total_samples,
        'total_sessions': total_sessions,
        'unique_devices': len(devices),
        'storage_path': str(DATA_DIR.absolute())
    }
