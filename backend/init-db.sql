-- ParkSpot Database Initialization
-- Runs on first container startup

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Scan reports table (hypertable for time-series)
CREATE TABLE scan_reports (
    id              BIGSERIAL,
    time            TIMESTAMPTZ NOT NULL,
    device_id       TEXT NOT NULL,      -- Hashed app instance ID
    geohash         TEXT NOT NULL,      -- 7-char precision (~150m)
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    ble_count       INTEGER DEFAULT 0,
    wifi_count      INTEGER DEFAULT 0,
    devices         JSONB DEFAULT '[]'::jsonb,
    PRIMARY KEY (id, time)
);

-- Convert to hypertable partitioned by time
SELECT create_hypertable('scan_reports', 'time');

-- Indexes for efficient querying
CREATE INDEX idx_scan_geohash_time ON scan_reports (geohash, time DESC);
CREATE INDEX idx_scan_device ON scan_reports (device_id, time DESC);

-- Aggregated parking data (continuous aggregate - auto-updated)
CREATE MATERIALIZED VIEW parking_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS hour,
    geohash,
    AVG(ble_count)::FLOAT as avg_devices,
    MAX(ble_count) as max_devices,
    MIN(ble_count) as min_devices,
    COUNT(*) as report_count,
    COUNT(DISTINCT device_id) as unique_reporters
FROM scan_reports
GROUP BY hour, geohash
WITH NO DATA;

-- Refresh policy: update every 30 minutes
SELECT add_continuous_aggregate_policy('parking_hourly',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '30 minutes',
    schedule_interval => INTERVAL '30 minutes'
);

-- Predictions cache table
CREATE TABLE predictions (
    geohash         TEXT PRIMARY KEY,
    probability     FLOAT NOT NULL,
    confidence      FLOAT DEFAULT 0.5,
    estimated_spots INTEGER DEFAULT 0,
    data_points     INTEGER DEFAULT 0,
    model_version   TEXT DEFAULT 'v1',
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_updated ON predictions (updated_at);

-- Retention policy: keep raw data for 90 days
SELECT add_retention_policy('scan_reports', INTERVAL '90 days');

-- Create read-only user for ML service
CREATE USER ml_reader WITH PASSWORD 'ml_reader_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ml_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ml_reader;

-- Grant write access for predictions
GRANT INSERT, UPDATE ON predictions TO ml_reader;
