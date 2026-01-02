"""
NAF API Router

FastAPI endpoints for Neural Acoustic Fields inference and visualization.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Tuple, Optional
import torch
import os
from pathlib import Path

# NAF imports (relative to app)
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from naf.model import NeuralAcousticField, create_naf_model
from naf.visualize import NAFVisualizer, generate_loudness_map_json

router = APIRouter()

# Global model instance (loaded once)
_naf_model: Optional[NeuralAcousticField] = None
_naf_visualizer: Optional[NAFVisualizer] = None

# Detect device
if torch.backends.mps.is_available():
    DEVICE = 'mps'
elif torch.cuda.is_available():
    DEVICE = 'cuda'
else:
    DEVICE = 'cpu'


def get_naf_model() -> NeuralAcousticField:
    """Get or load NAF model."""
    global _naf_model, _naf_visualizer

    if _naf_model is None:
        # Try to load from checkpoint
        checkpoint_path = os.getenv("NAF_CHECKPOINT", "naf_checkpoints/best_model.pt")

        if Path(checkpoint_path).exists():
            print(f"[NAF] Loading model from {checkpoint_path}")
            _naf_model = create_naf_model(device=DEVICE)
            checkpoint = torch.load(checkpoint_path, map_location=DEVICE)
            _naf_model.load_state_dict(checkpoint['model_state_dict'])
            _naf_model.eval()
        else:
            # Create untrained model for testing
            print("[NAF] No checkpoint found, using untrained model")
            _naf_model = create_naf_model(device=DEVICE)
            _naf_model.eval()

        _naf_visualizer = NAFVisualizer(_naf_model, device=DEVICE)

    return _naf_model


def get_naf_visualizer() -> NAFVisualizer:
    """Get NAF visualizer (creates model if needed)."""
    global _naf_visualizer
    if _naf_visualizer is None:
        get_naf_model()
    return _naf_visualizer


# Request/Response models
class LoudnessRequest(BaseModel):
    emitter_x: float
    emitter_y: float
    x_min: float = -5.0
    x_max: float = 5.0
    y_min: float = -5.0
    y_max: float = 5.0
    resolution: int = 32


class LoudnessResponse(BaseModel):
    emitter: List[float]
    bounds: List[List[float]]
    resolution: int
    data: List[List[float]]


class SceneStructureResponse(BaseModel):
    bounds: List[List[float]]
    resolution: int
    data: List[List[float]]


class PointQueryRequest(BaseModel):
    listener_x: float
    listener_y: float
    emitter_x: float
    emitter_y: float


class PointQueryResponse(BaseModel):
    loudness: float
    listener: List[float]
    emitter: List[float]


@router.get("/status")
async def naf_status():
    """Check NAF model status."""
    global _naf_model

    has_model = _naf_model is not None
    checkpoint_path = os.getenv("NAF_CHECKPOINT", "naf_checkpoints/best_model.pt")
    has_checkpoint = Path(checkpoint_path).exists()

    return {
        "loaded": has_model,
        "checkpoint_exists": has_checkpoint,
        "checkpoint_path": checkpoint_path,
        "device": DEVICE
    }


@router.post("/loudness-field", response_model=LoudnessResponse)
async def get_loudness_field(request: LoudnessRequest):
    """
    Generate loudness field for given emitter position.

    Returns a 2D grid of loudness values showing how sound
    propagates from the emitter through the space.
    """
    try:
        model = get_naf_model()

        result = generate_loudness_map_json(
            model=model,
            emitter_pos=(request.emitter_x, request.emitter_y),
            scene_bounds=((request.x_min, request.x_max), (request.y_min, request.y_max)),
            resolution=request.resolution,
            device=DEVICE
        )

        return LoudnessResponse(**result)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scene-structure", response_model=SceneStructureResponse)
async def get_scene_structure(
    x_min: float = -5.0,
    x_max: float = 5.0,
    y_min: float = -5.0,
    y_max: float = 5.0,
    resolution: int = 32
):
    """
    Infer scene structure from NAF latent features.

    Returns a 2D grid showing predicted structural features
    (e.g., proximity to walls/obstacles) decoded from the
    acoustic representations.
    """
    try:
        visualizer = get_naf_visualizer()

        structure = visualizer.extract_scene_structure(
            scene_bounds=((x_min, x_max), (y_min, y_max)),
            resolution=resolution
        )

        return SceneStructureResponse(
            bounds=[[x_min, x_max], [y_min, y_max]],
            resolution=resolution,
            data=structure.tolist()
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/query-point", response_model=PointQueryResponse)
async def query_loudness_at_point(request: PointQueryRequest):
    """
    Query loudness at a specific listener position given emitter.

    Returns the predicted acoustic energy at the listener position
    when sound is emitted from the emitter position.
    """
    try:
        model = get_naf_model()

        with torch.no_grad():
            listener = torch.tensor([[request.listener_x, request.listener_y]],
                                   dtype=torch.float32, device=DEVICE)
            emitter = torch.tensor([[request.emitter_x, request.emitter_y]],
                                  dtype=torch.float32, device=DEVICE)

            loudness = model.predict_loudness(listener, emitter)

            return PointQueryResponse(
                loudness=loudness.item(),
                listener=[request.listener_x, request.listener_y],
                emitter=[request.emitter_x, request.emitter_y]
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/load-checkpoint")
async def load_checkpoint(path: str):
    """Load NAF model from checkpoint file."""
    global _naf_model, _naf_visualizer

    if not Path(path).exists():
        raise HTTPException(status_code=404, detail=f"Checkpoint not found: {path}")

    try:
        _naf_model = create_naf_model(device=DEVICE)
        checkpoint = torch.load(path, map_location=DEVICE)
        _naf_model.load_state_dict(checkpoint['model_state_dict'])
        _naf_model.eval()
        _naf_visualizer = NAFVisualizer(_naf_model, device=DEVICE)

        return {
            "success": True,
            "path": path,
            "epoch": checkpoint.get('epoch', 'unknown')
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
