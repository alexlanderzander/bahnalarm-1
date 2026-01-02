/**
 * Sonar Service for ParkSmart
 *
 * TypeScript wrapper for the native SonarModule
 * Provides acoustic spatial sensing using 20kHz ultrasonic chirps
 *
 * Integrated with NafDataCollector for automatic NAF training data collection
 */

import { NativeModules, Platform } from 'react-native';
import NafDataService from './NafDataService';

const { SonarModule, NafDataCollector } = NativeModules;

export interface SonarReading {
  timestamp: number;
  distance_m: number;
  amplitude: number;
  peakIndex: number;
  isValid: boolean;
}

export type PermissionStatus = 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unknown';

// NAF data collection state
let nafCollectionEnabled = true;
let nafCaptureInterval: ReturnType<typeof setInterval> | null = null;
let nafUploadInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Check if sonar is available (iOS only for now)
 */
export function isAvailable(): boolean {
  return Platform.OS === 'ios' && SonarModule != null;
}

/**
 * Check if NAF data collector is available
 */
export function isNafAvailable(): boolean {
  return Platform.OS === 'ios' && NafDataCollector != null;
}

/**
 * Enable or disable NAF data collection
 */
export function setNafCollectionEnabled(enabled: boolean): void {
  nafCollectionEnabled = enabled;
  console.log(`[SonarService] NAF collection ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Check microphone permission status
 */
export async function checkPermission(): Promise<PermissionStatus> {
  if (!isAvailable()) {
    throw new Error('SonarModule not available on this platform');
  }
  return SonarModule.checkPermission();
}

/**
 * Request microphone permission
 */
export async function requestPermission(): Promise<boolean> {
  if (!isAvailable()) {
    throw new Error('SonarModule not available on this platform');
  }
  return SonarModule.requestPermission();
}

/**
 * Start the sonar system with automatic NAF data collection
 * @param intervalMs - Time between chirps in milliseconds (default: 500ms)
 */
export async function startSonar(intervalMs: number = 500): Promise<boolean> {
  if (!isAvailable()) {
    throw new Error('SonarModule not available on this platform');
  }

  // Check/request permission first
  const permission = await checkPermission();
  if (permission === 'notDetermined') {
    const granted = await requestPermission();
    if (!granted) {
      throw new Error('Microphone permission denied');
    }
  } else if (permission !== 'authorized') {
    throw new Error(`Microphone permission: ${permission}`);
  }

  // Start the sonar
  const started = await SonarModule.startSonar(intervalMs);

  // Start NAF data collection if enabled and available
  if (started && nafCollectionEnabled && isNafAvailable()) {
    try {
      await startNafCollection();
      console.log('[SonarService] NAF data collection started');
    } catch (e) {
      console.warn('[SonarService] Failed to start NAF collection:', e);
    }
  }

  return started;
}

/**
 * Stop the sonar system and NAF data collection
 */
export async function stopSonar(): Promise<boolean> {
  if (!isAvailable()) {
    throw new Error('SonarModule not available on this platform');
  }

  // Stop NAF collection first
  if (isNafAvailable()) {
    try {
      await stopNafCollection();
    } catch (e) {
      console.warn('[SonarService] Failed to stop NAF collection:', e);
    }
  }

  return SonarModule.stopSonar();
}

/**
 * Get the last sonar reading
 */
export async function getLastReading(): Promise<SonarReading | null> {
  if (!isAvailable()) {
    return null;
  }

  const reading = await SonarModule.getLastReading();
  if (!reading || Object.keys(reading).length === 0) {
    return null;
  }

  return reading as SonarReading;
}

/**
 * Check if sonar is currently active
 */
export async function isActive(): Promise<boolean> {
  if (!isAvailable()) {
    return false;
  }
  return SonarModule.isActive();
}

/**
 * Start NAF data collection - captures STFT samples every 2 seconds
 * Also starts WebSocket streaming to 3D viewer
 */
async function startNafCollection(): Promise<void> {
  // Start the native collector
  await NafDataCollector.startCollection();

  // Start real-time streaming to 3D viewer
  try {
    await NafDataService.startStreaming();
    console.log('[SonarService] 3D viewer streaming started');
  } catch (e) {
    console.warn('[SonarService] Failed to start 3D streaming:', e);
  }

  // Capture samples periodically (every 2 seconds)
  nafCaptureInterval = setInterval(async () => {
    try {
      await NafDataCollector.captureSample();
    } catch (e) {
      console.warn('[SonarService] NAF capture error:', e);
    }
  }, 2000);

  // Upload samples periodically (every 30 seconds)
  nafUploadInterval = setInterval(async () => {
    try {
      const state = await NafDataCollector.getSensorState();
      if (state && state.samplesCollected > 10) {
        // Get samples and upload
        const samples = await NafDataCollector.stopCollection();
        if (samples && samples.length > 0) {
          console.log(`[SonarService] Uploading ${samples.length} NAF samples`);
          await NafDataService.uploadSamples(samples);
        }
        // Restart collection
        await NafDataCollector.startCollection();
      }
    } catch (e) {
      console.warn('[SonarService] NAF upload error:', e);
    }
  }, 30000);
}

/**
 * Stop NAF data collection and upload remaining samples
 */
async function stopNafCollection(): Promise<void> {
  // Stop 3D viewer streaming
  NafDataService.stopStreaming();
  console.log('[SonarService] 3D viewer streaming stopped');

  // Clear intervals
  if (nafCaptureInterval) {
    clearInterval(nafCaptureInterval);
    nafCaptureInterval = null;
  }
  if (nafUploadInterval) {
    clearInterval(nafUploadInterval);
    nafUploadInterval = null;
  }

  // Stop collection and upload remaining
  try {
    const samples = await NafDataCollector.stopCollection();
    if (samples && samples.length > 0) {
      console.log(`[SonarService] Uploading final ${samples.length} NAF samples`);
      await NafDataService.uploadSamples(samples);
    }
  } catch (e) {
    console.warn('[SonarService] NAF stop error:', e);
  }
}

/**
 * Convenience function to start polling for readings
 * @param callback - Function to call with each reading
 * @param pollIntervalMs - How often to poll for readings (default: 200ms)
 * @returns Cleanup function to stop polling
 */
export function startPolling(
  callback: (reading: SonarReading | null) => void,
  pollIntervalMs: number = 200
): () => void {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    try {
      const reading = await getLastReading();
      callback(reading);
    } catch (e) {
      console.log('[SonarService] Poll error:', e);
    }
  };

  intervalId = setInterval(poll, pollIntervalMs);

  // Return cleanup function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  };
}

/**
 * Get NAF collection status
 */
export async function getNafStatus(): Promise<{ collecting: boolean; samplesCollected: number } | null> {
  if (!isNafAvailable()) return null;

  try {
    const state = await NafDataCollector.getSensorState();
    return {
      collecting: state?.isCollecting || false,
      samplesCollected: state?.samplesCollected || 0,
    };
  } catch {
    return null;
  }
}

export default {
  isAvailable,
  isNafAvailable,
  setNafCollectionEnabled,
  checkPermission,
  requestPermission,
  startSonar,
  stopSonar,
  getLastReading,
  isActive,
  startPolling,
  getNafStatus,
};
