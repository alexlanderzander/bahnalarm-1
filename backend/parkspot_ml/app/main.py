"""
ParkSpot ML Service
FastAPI application for parking predictions with Redis PubSub listener
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Optional

import redis
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.routers import predictions

# Redis connection
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
# Parse redis URL for password support: redis://:password@host:port
if "@" in redis_url:
    auth_part = redis_url.split("@")[0].replace("redis://:", "")
    host_part = redis_url.split("@")[1]
    redis_host = host_part.split(":")[0]
    redis_port = int(host_part.split(":")[1]) if ":" in host_part else 6379
    redis_password = auth_part if auth_part else None
else:
    redis_host = redis_url.replace("redis://", "").split(":")[0]
    redis_port = 6379
    redis_password = None

redis_client = redis.Redis(
    host=redis_host,
    port=redis_port,
    password=redis_password,
    decode_responses=True
)

# API Key for authentication
API_KEY = os.getenv("API_KEY", "dev_api_key_change_in_prod")


async def redis_listener():
    """Listen for parkspot:new_data events from Elixir ingestion service"""
    pubsub = redis_client.pubsub()
    pubsub.subscribe("parkspot:new_data")

    print("[ML] Redis PubSub listener started - waiting for parkspot:new_data")

    while True:
        try:
            message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message["type"] == "message":
                data = json.loads(message["data"])
                await process_incoming_scan(data)
            await asyncio.sleep(0.1)  # Small delay to prevent busy loop
        except Exception as e:
            print(f"[ML] Redis listener error: {e}")
            await asyncio.sleep(5)  # Wait before retry


async def process_incoming_scan(data: dict):
    """Handle incoming scan data from Elixir service"""
    geohash = data.get("geohash", "unknown")
    device_count = data.get("device_count", 0)
    timestamp = data.get("timestamp")

    print(f"[ML] Received scan: geohash={geohash}, devices={device_count}")

    # TODO: Update ML model with new data point
    # TODO: Invalidate cached predictions for this geohash
    # TODO: Trigger model retraining if enough new data

    # For now, just cache the latest device count
    cache_key = f"latest_scan:{geohash}"
    redis_client.setex(cache_key, 300, json.dumps({
        "device_count": device_count,
        "timestamp": timestamp
    }))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle - start/stop background tasks"""
    # Start Redis listener on startup
    listener_task = asyncio.create_task(redis_listener())
    print("[ML] Background Redis listener started")

    yield

    # Cleanup on shutdown
    listener_task.cancel()
    try:
        await listener_task
    except asyncio.CancelledError:
        pass
    print("[ML] Background Redis listener stopped")


app = FastAPI(
    title="ParkSpot ML Service",
    description="Machine learning predictions for parking availability",
    version="0.2.0",
    lifespan=lifespan
)

# CORS - restrict in production
allowed_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_api_key(x_api_key: Optional[str] = Header(None)):
    """Dependency to verify API key"""
    if not x_api_key or x_api_key != API_KEY:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key"
        )
    return x_api_key


# Include routers
app.include_router(
    predictions.router,
    prefix="/predictions",
    tags=["predictions"]
)

# NAF (Neural Acoustic Fields) router
from app.routers import naf
app.include_router(
    naf.router,
    prefix="/naf",
    tags=["neural_acoustic_fields"]
)

# Training data collection router
from app.routers import training_data
app.include_router(
    training_data.router,
    prefix="/api/naf",
    tags=["training_data"]
)

# Spatial streaming for real-time 3D visualization
from app.routers import spatial_stream
app.include_router(
    spatial_stream.router,
    prefix="/api/spatial",
    tags=["spatial_streaming"]
)

# Serve static files (3D viewer)
from fastapi.staticfiles import StaticFiles
from pathlib import Path
static_path = Path(__file__).parent.parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")


@app.get("/health")
async def health():
    """Health check endpoint - no auth required"""
    try:
        redis_client.ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    return {
        "status": "healthy" if redis_ok else "degraded",
        "redis": redis_ok,
        "model_loaded": True,  # TODO: actual model check
        "pubsub_active": True,
        "naf_available": True
    }


@app.get("/")
async def root():
    return {
        "service": "ParkSpot ML",
        "version": "0.4.0",
        "features": ["predictions", "redis_pubsub", "neural_acoustic_fields", "training_data"]
    }
