"""
Prediction endpoints for parking availability
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import redis
import json
import os

router = APIRouter()

# Redis client
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_host = redis_url.replace("redis://", "").split(":")[0]
redis_client = redis.Redis(host=redis_host, port=6379, decode_responses=True)

CACHE_TTL = 300  # 5 minutes


class PredictionResponse(BaseModel):
    geohash: str
    probability: float
    confidence: float
    estimated_spots: int
    last_updated: str
    data_points: int


class BulkPredictionRequest(BaseModel):
    geohashes: list[str]


@router.get("/{geohash}", response_model=PredictionResponse)
async def get_prediction(geohash: str):
    """
    Get parking availability prediction for a geohash.

    The geohash should be 7 characters (~150m precision).
    """
    if len(geohash) < 5 or len(geohash) > 9:
        raise HTTPException(
            status_code=400,
            detail="Geohash must be 5-9 characters"
        )

    # Check cache first
    cache_key = f"pred:{geohash}"
    cached = redis_client.get(cache_key)

    if cached:
        return json.loads(cached)

    # Generate prediction (mock for now)
    prediction = generate_mock_prediction(geohash)

    # Cache result
    redis_client.setex(cache_key, CACHE_TTL, json.dumps(prediction))

    return prediction


@router.post("/bulk")
async def get_bulk_predictions(request: BulkPredictionRequest):
    """
    Get predictions for multiple geohashes.
    """
    if len(request.geohashes) > 50:
        raise HTTPException(
            status_code=400,
            detail="Maximum 50 geohashes per request"
        )

    predictions = {}
    for geohash in request.geohashes:
        try:
            pred = await get_prediction(geohash)
            predictions[geohash] = pred
        except:
            predictions[geohash] = None

    return {"predictions": predictions}


def generate_mock_prediction(geohash: str) -> dict:
    """
    Generate a mock prediction.
    Replace with actual ML model later.
    """
    import hashlib
    from datetime import datetime

    # Deterministic "randomness" based on geohash
    hash_val = int(hashlib.md5(geohash.encode()).hexdigest()[:8], 16)
    probability = (hash_val % 100) / 100

    return {
        "geohash": geohash,
        "probability": round(probability, 2),
        "confidence": 0.5,  # Low confidence until we have real data
        "estimated_spots": int(probability * 10),
        "last_updated": datetime.utcnow().isoformat() + "Z",
        "data_points": 0  # No real data yet
    }
