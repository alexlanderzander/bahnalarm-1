/**
 * Mesh Sensing Service for ParkSmart
 *
 * Scans for nearby BLE devices to build parking availability data.
 * Part of the crowdsourced mesh sensing network.
 */

import { Platform, PermissionsAndroid, NativeEventEmitter, NativeModules } from 'react-native';
import BleManager from 'react-native-ble-manager';
import { logger } from '../utils/logger';
import { getCurrentLocation, UserLocation } from './LocationService';
import { submitScanReport } from '../api/MeshApiService';

const log = logger.app;

// Event emitter for BLE events - use the library's native module
const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

// Types
export interface DetectedDevice {
  id: string; // Hashed for privacy
  rssi: number;
  timestamp: number;
}

export interface ScanReport {
  timestamp: string;
  location: UserLocation | null;
  deviceCount: number;
  devices: DetectedDevice[];
  wifiNetworkCount: number;
}

// Storage for detected devices
let detectedDevices: Map<string, DetectedDevice> = new Map();
let isScanning = false;
let scanInterval: ReturnType<typeof setInterval> | null = null;
let uploadInterval: ReturnType<typeof setInterval> | null = null;
let isInitialized = false;
let discoverListener: any = null;
let stopListener: any = null;

/**
 * Simple hash function for device IDs (privacy)
 */
function hashDeviceId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `dev_${Math.abs(hash).toString(16)}`;
}

/**
 * Request Bluetooth permission (Android)
 */
export async function requestBluetoothPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      const allGranted = Object.values(granted).every(
        status => status === PermissionsAndroid.RESULTS.GRANTED
      );

      return allGranted;
    } catch (error) {
      log.error('Bluetooth permission error:', error);
      return false;
    }
  }
  // iOS permissions are requested automatically
  return true;
}

/**
 * Initialize BLE Manager
 */
export async function initializeBleManager(): Promise<boolean> {
  if (isInitialized) {
    return true;
  }

  try {
    // Start BLE manager without blocking alert
    await BleManager.start({ showAlert: false });

    // Check state - no artificial delay needed
    const state = await BleManager.checkState();
    log.debug(`Bluetooth State: ${state}`);

    isInitialized = true;
    log.debug('BLE Manager initialized');
    return true;
  } catch (error) {
    log.error('Failed to initialize BLE Manager:', error);
    return false;
  }
}

// Listener for raw device updates (for Debug UI)
type DeviceListener = (device: DetectedDevice) => void;
const deviceListeners: Set<DeviceListener> = new Set();

/**
 * Handle discovered peripheral
 */
function handleDiscoveredPeripheral(peripheral: {
  id: string;
  rssi: number;
  name?: string;
}) {
  const hashedId = hashDeviceId(peripheral.id);

  const device: DetectedDevice = {
    id: hashedId,
    rssi: peripheral.rssi,
    timestamp: Date.now(),
  };

  detectedDevices.set(hashedId, device);

  // Notify listeners
  deviceListeners.forEach(listener => listener(device));
}

/**
 * Subscribe to raw device updates
 */
export function addDeviceListener(listener: DeviceListener) {
  deviceListeners.add(listener);
}

export function removeDeviceListener(listener: DeviceListener) {
  deviceListeners.delete(listener);
}

/**
 * Handle scan stop
 */
function handleStopScan() {
  log.debug('BLE scan stopped');
}

/**
 * Upload current scan data to backend
 */
async function uploadScanData(): Promise<void> {
  if (detectedDevices.size === 0) {
    log.debug('No devices to upload');
    return;
  }

  try {
    const report = await generateScanReport();
    const success = await submitScanReport(report);

    if (success) {
      log.debug(`Uploaded scan with ${report.deviceCount} devices`);
    }
  } catch (error) {
    log.error('Failed to upload scan data:', error);
  }
}

/**
 * Start BLE scanning
 */
export async function startScanning(): Promise<boolean> {
  if (isScanning) {
    log.debug('Already scanning');
    return true;
  }

  // Initialize if needed
  const initialized = await initializeBleManager();
  if (!initialized) {
    return false;
  }

  // Request permissions
  const hasPermission = await requestBluetoothPermission();
  if (!hasPermission) {
    log.error('Bluetooth permission denied');
    return false;
  }

  try {
    // Set up listeners
    discoverListener = bleManagerEmitter.addListener(
      'BleManagerDiscoverPeripheral',
      handleDiscoveredPeripheral
    );
    stopListener = bleManagerEmitter.addListener(
      'BleManagerStopScan',
      handleStopScan
    );

    // Start scanning for all devices
    log.debug('Starting initial scan...');
    // increasing scan time to 20s and enabling duplicates for sonar effect
    await BleManager.scan({ serviceUUIDs: [], seconds: 20, allowDuplicates: true });
    isScanning = true;

    log.debug('BLE scanning started - Allow Duplicates: TRUE');

    // Set up periodic scanning (every 60 seconds)
    scanInterval = setInterval(async () => {
      if (isScanning) {
        // Backup: Check for discovered peripherals manually in case events are missed
        try {
          const peripherals = await BleManager.getDiscoveredPeripherals();
          log.debug(`Manual check found ${peripherals.length} peripherals`);
          peripherals.forEach(p => handleDiscoveredPeripheral(p));
        } catch (err) {
          log.debug('Failed to get discovered peripherals manually');
        }

        try {
          // Restart scan
          await BleManager.scan({ serviceUUIDs: [], seconds: 20, allowDuplicates: true });
        } catch (err) {
          log.error('Scan error:', err);
        }
      }
    }, 20000); // Increased frequency to 20s to match scan duration

    // Set up periodic upload (every 5 minutes)
    uploadInterval = setInterval(async () => {
      if (isScanning) {
        await uploadScanData();
      }
    }, 300000);

    return true;
  } catch (error) {
    log.error('Failed to start BLE scan:', error);
    return false;
  }
}

/**
 * Stop BLE scanning
 */
export async function stopScanning(): Promise<void> {
  if (!isScanning) return;

  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  if (uploadInterval) {
    clearInterval(uploadInterval);
    uploadInterval = null;
  }

  if (BleManager) {
    try {
      await BleManager.stopScan();
    } catch (error) {
      log.error('Failed to stop BLE scan:', error);
    }
  }

  if (bleManagerEmitter) {
    // Only remove internal listeners, kept external listeners clean separately if needed?
    // Actually we should remove the subscription, but we re-add on start
    if (discoverListener) {
      discoverListener.remove();
      discoverListener = null;
    }
    if (stopListener) {
      stopListener.remove();
      stopListener = null;
    }
  }

  isScanning = false;
  log.debug('BLE scanning stopped');
}

/**
 * Generate a scan report
 */
export async function generateScanReport(): Promise<ScanReport> {
  let location: UserLocation | null = null;

  try {
    location = await getCurrentLocation();
  } catch (error) {
    log.debug('Could not get location for scan report');
  }

  const devices = Array.from(detectedDevices.values());

  return {
    timestamp: new Date().toISOString(),
    location,
    deviceCount: devices.length,
    devices,
    wifiNetworkCount: 0, // TODO: Add WiFi network counting
  };
}

/**
 * Get current scan status
 */
export function getScanStatus(): { isScanning: boolean; deviceCount: number } {
  return {
    isScanning,
    deviceCount: detectedDevices.size,
  };
}

/**
 * Get RSSI vector for NAF/HNSF model
 * Returns array of 16 strongest RSSI values (sorted, padded with -100)
 */
export function getRssiVector(): number[] {
  const devices = Array.from(detectedDevices.values());

  // Sort by RSSI (strongest first)
  devices.sort((a, b) => b.rssi - a.rssi);

  // Take top 16 and pad with -100 (no signal)
  const rssiVector = new Array(16).fill(-100);
  devices.slice(0, 16).forEach((d, i) => {
    rssiVector[i] = d.rssi;
  });

  return rssiVector;
}

export default {
  requestPermission: requestBluetoothPermission,
  initialize: initializeBleManager,
  startScanning,
  stopScanning,
  generateReport: generateScanReport,
  getStatus: getScanStatus,
  addDeviceListener,
  removeDeviceListener,
  getRssiVector,
};
