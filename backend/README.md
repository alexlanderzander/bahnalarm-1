# ParkSpot Backend

Hybrid Elixir + Python backend for parking availability prediction.

## Architecture

```
nginx (80) → Elixir (4000) → Redis → TimescaleDB
           → Python (8000) ←──────────────┘
```

## Quick Start

```bash
# Start all services
docker-compose up -d

# Check health
curl http://localhost/health

# Submit a scan report
curl -X POST http://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"device_id": "test123", "timestamp": "2025-01-15T14:30:00Z", "location": {"lat": 50.7374, "lng": 7.0982}, "ble_count": 5}'

# Get prediction
curl http://localhost/predictions/u1h4c7b
```

## Services

| Service | Port | Tech |
|---------|------|------|
| Elixir Ingestion | 4000 | Phoenix |
| Python ML | 8000 | FastAPI |
| TimescaleDB | 5432 | PostgreSQL |
| Redis | 6379 | Redis |

## Database

TimescaleDB with:
- `scan_reports` - Hypertable for time-series data
- `parking_hourly` - Continuous aggregate
- `predictions` - Cached predictions

## Development

```bash
# Elixir
cd parkspot_ingestion
mix deps.get
mix phx.server

# Python
cd parkspot_ml
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Deploy to Hetzner

```bash
# SSH to server
ssh root@your-server

# Clone and start
git clone <repo>
cd backend
docker-compose up -d
```
