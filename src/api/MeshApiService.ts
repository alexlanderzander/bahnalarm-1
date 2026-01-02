/**
 * Mesh Sensing API Service
 *
 * Handles communication with the ParkSpot backend for:
 * - Submitting BLE scan reports
 * - Fetching parking predictions
 *
 * SECURITY: All authenticated endpoints require X-Api-Key header
 */

import { logger } from '../utils/logger';
import { ScanReport } from '../services/MeshSensingService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const log = logger.app;

// Backend URL - configure for different environments
// TODO: Replace with actual production URL when deployed
const API_BASE_URL = 'http://192.168.178.80';

// API Key for authentication - should match backend config
// In production, this should be fetched securely or configured via env
const API_KEY = 'dev_api_key_change_in_prod';

// Types
export interface PredictionResponse {
  geohash: string;
  probability: number;
  confidence: number;
  estimated_spots: number;
  last_updated: string;
  data_points: number;
}

export interface HealthResponse {
  status: string;
  database: boolean;
  redis: boolean;
}

/**
 * Get common headers for authenticated API calls
 */
function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': API_KEY,
  };
}

/**
 * Submit a scan report to the backend
 */
export async function submitScanReport(report: ScanReport): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();

    const response = await fetch(`${API_BASE_URL}/api/scans`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        device_id: deviceId,
        timestamp: report.timestamp,
        location: report.location ? {
          lat: report.location.latitude,
          lng: report.location.longitude,
        } : null,
        ble_count: report.deviceCount,
        wifi_count: report.wifiNetworkCount,
        devices: report.devices,
      }),
    });

    if (response.ok) {
      log.debug('Scan report submitted successfully');
      return true;
    } else if (response.status === 401) {
      log.error('API authentication failed - check API key');
      return false;
    } else {
      log.error('Failed to submit scan:', response.status);
      return false;
    }
  } catch (error) {
    log.error('Error submitting scan report:', error);
    return false;
  }
}

/**
 * Submit multiple scan reports in batch
 */
export async function submitScanReportBatch(reports: ScanReport[]): Promise<number> {
  try {
    const deviceId = await getDeviceId();

    const formattedReports = reports.map(report => ({
      device_id: deviceId,
      timestamp: report.timestamp,
      location: report.location ? {
        lat: report.location.latitude,
        lng: report.location.longitude,
      } : null,
      ble_count: report.deviceCount,
      wifi_count: report.wifiNetworkCount,
      devices: report.devices,
    }));

    const response = await fetch(`${API_BASE_URL}/api/scans/batch`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reports: formattedReports }),
    });

    if (response.ok) {
      const data = await response.json();
      log.debug(`Batch submitted: ${data.count} reports`);
      return data.count;
    } else if (response.status === 401) {
      log.error('API authentication failed - check API key');
      return 0;
    } else {
      log.error('Failed to submit batch:', response.status);
      return 0;
    }
  } catch (error) {
    log.error('Error submitting batch:', error);
    return 0;
  }
}

/**
 * Get parking prediction for a geohash
 */
export async function getPrediction(geohash: string): Promise<PredictionResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/predictions/${geohash}`, {
      headers: getAuthHeaders(),
    });

    if (response.ok) {
      return await response.json();
    } else {
      log.error('Failed to get prediction:', response.status);
      return null;
    }
  } catch (error) {
    log.error('Error getting prediction:', error);
    return null;
  }
}

/**
 * Get predictions for multiple geohashes
 */
export async function getBulkPredictions(
  geohashes: string[]
): Promise<Record<string, PredictionResponse | null>> {
  try {
    const response = await fetch(`${API_BASE_URL}/predictions/bulk`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ geohashes }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.predictions;
    } else {
      log.error('Failed to get bulk predictions:', response.status);
      return {};
    }
  } catch (error) {
    log.error('Error getting bulk predictions:', error);
    return {};
  }
}

/**
 * Check backend health (public endpoint - no auth required)
 * Returns health data even if status is 503 (unhealthy) - backend is still reachable
 */
export async function checkHealth(): Promise<HealthResponse | null> {
  const url = `${API_BASE_URL}/health`;
  console.log('[MeshAPI] Checking health at URL:', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    console.log('[MeshAPI] Health response status:', response.status);

    // Parse response body for both 200 (healthy) and 503 (unhealthy)
    // Backend is reachable if we get any JSON response
    if (response.status === 200 || response.status === 503) {
      const data = await response.json();
      console.log('[MeshAPI] Health data:', data);
      // Normalize status - if we can reach the server, consider it "reachable"
      return {
        ...data,
        status: data.database === true ? 'reachable' : data.status,
      };
    }
    console.log('[MeshAPI] Health check failed with status:', response.status);
    return null;
  } catch (error) {
    console.log('[MeshAPI] Health check ERROR:', error);
    log.error('Backend health check failed:', error);
    return null;
  }
}

// Device ID for tracking - persisted to AsyncStorage
const DEVICE_ID_KEY = '@parkspot_device_id';
let cachedDeviceId: string | null = null;

/**
 * Get or generate a persistent device ID
 */
async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    // Try to load from persistent storage
    const storedId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (storedId) {
      cachedDeviceId = storedId;
      return cachedDeviceId;
    }
  } catch (e) {
    log.debug('Could not load device ID from storage');
  }

  // Generate new device ID
  cachedDeviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  try {
    // Persist for future sessions
    await AsyncStorage.setItem(DEVICE_ID_KEY, cachedDeviceId);
  } catch (e) {
    log.debug('Could not save device ID to storage');
  }

  return cachedDeviceId;
}

export default {
  submitScan: submitScanReport,
  submitBatch: submitScanReportBatch,
  getPrediction,
  getBulkPredictions,
  checkHealth,
};
