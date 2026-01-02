/**
 * NafDataService.ts
 *
 * React Native service for collecting NAF training data
 * Interfaces with NafDataCollector native module
 * Includes RF (BLE RSSI) data for hybrid HNSF model
 */

import { NativeModules, Platform } from 'react-native';
import BleManager from 'react-native-ble-manager';
import { getRssiVector as getMeshRssiVector } from './MeshSensingService';

const { NafDataCollector } = NativeModules;

export interface NafSample {
  timestamp: number;
  listener_pos: [number, number, number];
  emitter_pos: [number, number, number];
  orientation: [number, number];
  channel: number;
  stft_mag: number[][];
  stft_phase: number[][];
  num_time_bins: number;
  num_freq_bins: number;
}

export interface RfBeaconData {
  device_id: string;
  rssi: number;
  name?: string;
}

export interface SensorState {
  position: [number, number, number];
  orientation: [number, number];
  isCollecting: boolean;
  samplesCollected: number;
}

// Store RF snapshots for each sample timestamp
const rfSnapshots: Map<number, RfBeaconData[]> = new Map();

class NafDataServiceClass {
  private isCollecting = false;
  private collectedSamples: NafSample[] = [];

  /**
   * Start collecting NAF training data
   */
  async startCollection(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      console.warn('[NafDataService] Only iOS is supported');
      return false;
    }

    if (!NafDataCollector) {
      console.error('[NafDataService] NafDataCollector native module not found');
      return false;
    }

    try {
      await NafDataCollector.startCollection();
      this.isCollecting = true;
      this.collectedSamples = [];
      console.log('[NafDataService] Collection started');
      return true;
    } catch (error) {
      console.error('[NafDataService] Failed to start collection:', error);
      return false;
    }
  }

  /**
   * Stop collecting and return all samples
   */
  async stopCollection(): Promise<NafSample[]> {
    if (!this.isCollecting) {
      return this.collectedSamples;
    }

    try {
      const samples = await NafDataCollector.stopCollection();
      this.isCollecting = false;
      this.collectedSamples = samples;
      console.log(`[NafDataService] Stopped: ${samples.length} samples collected`);
      return samples;
    } catch (error) {
      console.error('[NafDataService] Failed to stop collection:', error);
      return [];
    }
  }

  /**
   * Capture a single training sample
   */
  async captureSample(): Promise<NafSample | null> {
    if (!this.isCollecting) {
      console.warn('[NafDataService] Not currently collecting');
      return null;
    }

    try {
      const sample = await NafDataCollector.captureSample();
      this.collectedSamples.push(sample);
      return sample;
    } catch (error) {
      console.error('[NafDataService] Failed to capture sample:', error);
      return null;
    }
  }

  /**
   * Get current sensor state
   */
  async getSensorState(): Promise<SensorState | null> {
    if (!NafDataCollector) return null;

    try {
      return await NafDataCollector.getSensorState();
    } catch (error) {
      console.error('[NafDataService] Failed to get sensor state:', error);
      return null;
    }
  }

  /**
   * Upload collected samples to backend for training
   * Includes RF (BLE RSSI) data for hybrid HNSF model
   */
  async uploadSamples(
    samples: NafSample[],
    apiUrl: string = 'http://192.168.178.80/api/naf/training-data'
  ): Promise<boolean> {
    if (samples.length === 0) {
      console.warn('[NafDataService] No samples to upload');
      return false;
    }

    try {
      // Capture current RF (BLE) data for hybrid model
      let rfBeacons: RfBeaconData[] = [];
      try {
        const peripherals = await BleManager.getDiscoveredPeripherals();
        console.log(`[NafDataService] Raw peripherals from BLE:`, peripherals?.length || 0);

        if (peripherals && peripherals.length > 0) {
          rfBeacons = peripherals.map((p: any) => {
            const rssi = typeof p.rssi === 'number' ? p.rssi : -100;
            console.log(`[NafDataService] Device: ${p.name || p.id?.substring(0, 8)}, RSSI: ${rssi}`);
            return {
              device_id: p.id,
              rssi: rssi,
              name: p.name,
            };
          });
          // Sort by RSSI (strongest first)
          rfBeacons.sort((a, b) => b.rssi - a.rssi);
        }
        console.log(`[NafDataService] Captured ${rfBeacons.length} RF beacons`);
      } catch (bleError) {
        console.warn('[NafDataService] Could not get BLE data:', bleError);
      }

      // Prepare RSSI vector (pad/truncate to fixed size for model)
      const maxBeacons = 16; // Fixed size for model input
      const rssiVector = new Array(maxBeacons).fill(-100); // Default: no signal
      rfBeacons.slice(0, maxBeacons).forEach((b, i) => {
        rssiVector[i] = b.rssi;
      });

      // Compress STFT data for upload
      const compressedSamples = samples.map(sample => ({
        ...sample,
        // Flatten 2D arrays for JSON transfer
        stft_mag_flat: sample.stft_mag.flat(),
        stft_phase_flat: sample.stft_phase.flat(),
        // Add RF data to each sample
        rf_rssi: rssiVector,
        rf_beacon_count: Math.min(rfBeacons.length, maxBeacons),
      }));

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          samples: compressedSamples,
          device_id: 'iphone_naf_collector',
          session_id: Date.now().toString(),
          rf_beacons: rfBeacons.slice(0, maxBeacons), // Include beacon metadata
        }),
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[NafDataService] Uploaded ${samples.length} samples with ${rfBeacons.length} RF beacons:`, result);
      return true;
    } catch (error) {
      console.error('[NafDataService] Upload failed:', error);
      return false;
    }
  }

  /**
   * Export samples as JSON for local storage
   */
  exportAsJson(samples: NafSample[]): string {
    return JSON.stringify({
      format: 'naf_training_v1',
      created: new Date().toISOString(),
      sample_count: samples.length,
      samples: samples,
    }, null, 2);
  }

  /**
   * Check if collection is active
   */
  isActive(): boolean {
    return this.isCollecting;
  }

  /**
   * Get count of collected samples
   */
  getSampleCount(): number {
    return this.collectedSamples.length;
  }

  // ============================================
  // REAL-TIME WEBSOCKET STREAMING
  // ============================================

  private wsConnection: WebSocket | null = null;
  private isStreaming = false;
  private streamInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start real-time streaming to 3D viewer
   */
  async startStreaming(wsUrl: string = 'ws://192.168.178.80/api/spatial/stream'): Promise<boolean> {
    if (this.isStreaming) {
      console.log('[NafDataService] Already streaming');
      return true;
    }

    try {
      // Connect WebSocket with Promise-based wait
      await new Promise<void>((resolve, reject) => {
        this.wsConnection = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          this.wsConnection?.close();
          reject(new Error('Connection timeout'));
        }, 5000);

        this.wsConnection.onopen = () => {
          console.log('[NafDataService] WebSocket connected for streaming');
          clearTimeout(timeout);
          this.isStreaming = true;
          resolve();
        };

        this.wsConnection.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'ack') {
            console.log(`[NafDataService] Stream ack: ${data.points_generated} points generated`);
          }
        };

        this.wsConnection.onerror = (error) => {
          console.error('[NafDataService] WebSocket error:', error);
          clearTimeout(timeout);
          reject(error);
        };

        this.wsConnection.onclose = () => {
          console.log('[NafDataService] WebSocket closed');
          this.isStreaming = false;
          this.wsConnection = null;
        };
      });

      // Start streaming sensor data every 200ms for faster updates
      this.streamInterval = setInterval(() => this.streamSensorData(), 200);

      return true;
    } catch (error) {
      console.error('[NafDataService] Failed to start streaming:', error);
      return false;
    }
  }

  /**
   * Stop real-time streaming
   */
  stopStreaming(): void {
    if (this.streamInterval) {
      clearInterval(this.streamInterval);
      this.streamInterval = null;
    }

    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }

    this.isStreaming = false;
    console.log('[NafDataService] Streaming stopped');
  }

  /**
   * Send current sensor state over WebSocket
   */
  private async streamSensorData(): Promise<void> {
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      // Get current sensor state from native module
      const state = await this.getSensorState();

      // Get RF data from consolidated MeshSensingService
      const rfRssi = getMeshRssiVector();

      // Get acoustic STFT for model inference
      let stft = null;
      try {
        stft = await NafDataCollector.getLastSTFT();
      } catch (e) {
        // STFT not available yet - that's OK
      }

      // Send sensor data (use defaults if state is null)
      const position = state?.position ?? [0, 0, 0];
      const orientation = state?.orientation ?? [0, 0];

      const sensorData = {
        type: 'sensor_data',
        position,
        orientation,
        rf_rssi: rfRssi,
        timestamp: Date.now(),
        // Include acoustic STFT for full multi-modal inference
        stft: stft ? {
          magnitude: stft.magnitude,
          timeBins: stft.timeBins,
          freqBins: stft.freqBins,
        } : null,
      };

      this.wsConnection.send(JSON.stringify(sensorData));
    } catch (error) {
      console.error('[NafDataService] Stream error:', error);
    }
  }

  /**
   * Check if streaming is active
   */
  isStreamingActive(): boolean {
    return this.isStreaming;
  }
}

export const NafDataService = new NafDataServiceClass();
export default NafDataService;
