import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import BleManager from 'react-native-ble-manager';
import MeshSensingService from '../services/MeshSensingService';
import SonarService, { SonarReading } from '../services/SonarService';
import { checkHealth } from '../api/MeshApiService';
import { colors } from '../styles/styles';

const { width } = Dimensions.get('window');

type TabType = 'rf' | 'sonar';

interface SignalSample {
  timestamp: number;
  rssi: number;
}

interface DeviceSignalHistory {
  id: string;
  samples: SignalSample[];
  lastRssi: number;
  packets: number;
  name?: string;
}

function hashDeviceId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `dev_${Math.abs(hash).toString(16).slice(0, 8)}`;
}

export default function DebugSignalLoggerScreen() {
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<TabType>('rf');

  // Backend connection state
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [isCheckingBackend, setIsCheckingBackend] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  // RF State
  const [isScanning, setIsScanning] = useState(false);
  const [deviceHistory, setDeviceHistory] = useState<Map<string, DeviceSignalHistory>>(new Map());
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sonar State
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [sonarReadings, setSonarReadings] = useState<SonarReading[]>([]);
  const [lastSonarReading, setLastSonarReading] = useState<SonarReading | null>(null);
  const sonarPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check backend health on mount
  useEffect(() => {
    const checkBackend = async () => {
      setIsCheckingBackend(true);
      setBackendError(null);
      try {
        const health = await checkHealth();
        if (health) {
          setIsBackendConnected(true);
          console.log('[SignalLogger] Backend connected:', health);
        } else {
          setIsBackendConnected(false);
          setBackendError('Backend returned null health');
        }
      } catch (error: any) {
        console.log('[SignalLogger] Backend connection failed:', error);
        setIsBackendConnected(false);
        setBackendError(error.message || 'Connection failed');
      } finally {
        setIsCheckingBackend(false);
      }
    };

    checkBackend();

    // Retry every 10 seconds if not connected
    const retryInterval = setInterval(() => {
      if (!isBackendConnected) {
        checkBackend();
      }
    }, 10000);

    return () => clearInterval(retryInterval);
  }, [isBackendConnected]);

  // RF Polling
  const pollPeripherals = useCallback(async () => {
    try {
      const peripherals = await BleManager.getDiscoveredPeripherals();
      const now = Date.now();

      setDeviceHistory(prev => {
        const next = new Map(prev);
        peripherals.forEach((p: any) => {
          const hashedId = hashDeviceId(p.id);
          const existing = next.get(hashedId);
          if (existing) {
            if (existing.lastRssi !== p.rssi) {
              next.set(hashedId, {
                ...existing,
                lastRssi: p.rssi,
                packets: existing.packets + 1,
                samples: [...existing.samples, { timestamp: now, rssi: p.rssi }].slice(-50),
              });
            }
          } else {
            next.set(hashedId, {
              id: hashedId,
              lastRssi: p.rssi,
              packets: 1,
              samples: [{ timestamp: now, rssi: p.rssi }],
              name: p.name || undefined,
            });
          }
        });
        return next;
      });
      setPollCount(c => c + 1);
    } catch (e) {
      console.log('[RF Sonar] Poll error:', e);
    }
  }, []);

  // Sonar Polling
  const pollSonar = useCallback(async () => {
    try {
      const reading = await SonarService.getLastReading();
      if (reading && reading.isValid) {
        setLastSonarReading(reading);
        setSonarReadings(prev => [...prev, reading].slice(-50));
      }
    } catch (e) {
      console.log('[Sonar] Poll error:', e);
    }
  }, []);

  useEffect(() => {
    if (isScanning) {
      pollIntervalRef.current = setInterval(pollPeripherals, 500);
      pollPeripherals();
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isScanning, pollPeripherals]);

  useEffect(() => {
    if (isSonarActive) {
      sonarPollRef.current = setInterval(pollSonar, 300);
    } else {
      if (sonarPollRef.current) {
        clearInterval(sonarPollRef.current);
        sonarPollRef.current = null;
      }
    }
    return () => {
      if (sonarPollRef.current) clearInterval(sonarPollRef.current);
    };
  }, [isSonarActive, pollSonar]);

  const toggleRfScan = async () => {
    if (isScanning) {
      await MeshSensingService.stopScanning();
      setIsScanning(false);
    } else {
      setDeviceHistory(new Map());
      setPollCount(0);
      await MeshSensingService.startScanning();
      setIsScanning(true);
    }
  };

  const toggleSonar = async () => {
    if (isSonarActive) {
      await SonarService.stopSonar();
      setIsSonarActive(false);
    } else {
      try {
        setSonarReadings([]);
        await SonarService.startSonar(400); // Chirp every 400ms
        setIsSonarActive(true);
      } catch (e: any) {
        Alert.alert('Sonar Error', e.message || 'Failed to start sonar');
      }
    }
  };

  const renderRfGraph = (history: DeviceSignalHistory) => {
    const recent = history.samples.slice(-20);
    return (
      <View style={styles.graphContainer}>
        {recent.map((s, i) => {
          const height = Math.max(5, Math.min(60, (s.rssi + 100) * 1));
          const isStrong = s.rssi > -70;
          return (
            <View
              key={i}
              style={[styles.bar, { height, backgroundColor: isStrong ? colors.success : (s.rssi > -85 ? colors.accent : colors.textMuted) }]}
            />
          );
        })}
      </View>
    );
  };

  const renderSonarGraph = () => {
    const recent = sonarReadings.slice(-30);
    const maxDistance = 5; // 5 meters max
    return (
      <View style={styles.sonarGraphContainer}>
        {recent.map((r, i) => {
          const height = Math.min(100, (r.distance_m / maxDistance) * 100);
          const color = r.distance_m < 1 ? colors.error : r.distance_m < 2 ? colors.accent : colors.success;
          return (
            <View
              key={i}
              style={[styles.sonarBar, { height, backgroundColor: color }]}
            />
          );
        })}
      </View>
    );
  };

  const sortedDevices = Array.from(deviceHistory.values()).sort((a, b) => b.lastRssi - a.lastRssi);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.iconText}>❌</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Spatial Sensor 📡</Text>
        <TouchableOpacity onPress={() => { setDeviceHistory(new Map()); setSonarReadings([]); }}>
          <Text style={styles.iconText}>🗑️</Text>
        </TouchableOpacity>
      </View>

      {/* Backend Status Banner */}
      <View style={[
        styles.statusBanner,
        isBackendConnected ? styles.statusConnected :
          isCheckingBackend ? styles.statusChecking :
            styles.statusError
      ]}>
        {isCheckingBackend ? (
          <>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.statusText}>Connecting to backend...</Text>
          </>
        ) : isBackendConnected ? (
          <Text style={styles.statusText}>✅ Backend connected</Text>
        ) : (
          <Text style={styles.statusText}>⚠️ Backend offline - sensors disabled</Text>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'rf' && styles.activeTab]}
          onPress={() => setActiveTab('rf')}
        >
          <Text style={[styles.tabText, activeTab === 'rf' && styles.activeTabText]}>📶 RF Scan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'sonar' && styles.activeTab]}
          onPress={() => setActiveTab('sonar')}
        >
          <Text style={[styles.tabText, activeTab === 'sonar' && styles.activeTabText]}>🔊 Sonar</Text>
        </TouchableOpacity>
      </View>

      {/* RF Tab */}
      {activeTab === 'rf' && (
        <>
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.button, isScanning ? styles.stopButton : styles.startButton]}
              onPress={toggleRfScan}
            >
              <Text style={styles.buttonText}>{isScanning ? '⏹ STOP' : '▶️ START'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.stats}>
            <Text style={styles.statText}>📱 {deviceHistory.size} devices</Text>
            <Text style={styles.statText}>📦 {Array.from(deviceHistory.values()).reduce((acc, d) => acc + d.packets, 0)} packets</Text>
            <Text style={styles.statText}>🔄 {pollCount} polls</Text>
          </View>
          <FlatList
            data={sortedDevices}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.card, selectedDevice === item.id && styles.selectedCard]}
                onPress={() => setSelectedDevice(selectedDevice === item.id ? null : item.id)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.deviceId}>{item.id}</Text>
                  <Text style={[styles.rssiText, { color: item.lastRssi > -70 ? colors.success : colors.textMuted }]}>
                    {item.lastRssi} dBm
                  </Text>
                </View>
                {renderRfGraph(item)}
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>📡</Text>
                <Text style={styles.emptyText}>No RF Echoes.{'\n'}Tap START to begin.</Text>
              </View>
            }
          />
        </>
      )}

      {/* Sonar Tab */}
      {activeTab === 'sonar' && (
        <>
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.button, isSonarActive ? styles.stopButton : styles.startButton]}
              onPress={toggleSonar}
            >
              <Text style={styles.buttonText}>{isSonarActive ? '⏹ STOP SONAR' : '🔊 START SONAR'}</Text>
            </TouchableOpacity>
          </View>

          {/* Distance Display */}
          <View style={styles.sonarDisplay}>
            <Text style={styles.sonarLabel}>DISTANCE</Text>
            <Text style={styles.sonarValue}>
              {lastSonarReading?.isValid ? `${lastSonarReading.distance_m.toFixed(2)} m` : '-- m'}
            </Text>
            <Text style={styles.sonarAmplitude}>
              Amplitude: {lastSonarReading ? lastSonarReading.amplitude.toFixed(4) : '--'}
            </Text>
          </View>

          {/* Distance Graph */}
          <View style={styles.sonarGraphWrapper}>
            <Text style={styles.graphTitle}>Distance History (0-5m)</Text>
            {renderSonarGraph()}
            <View style={styles.graphLabels}>
              <Text style={styles.graphLabel}>5m</Text>
              <Text style={styles.graphLabel}>0m</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.stats}>
            <Text style={styles.statText}>📊 {sonarReadings.length} readings</Text>
            <Text style={styles.statText}>
              {isSonarActive ? '🟢 Active' : '⚪ Idle'}
            </Text>
          </View>

          {!SonarService.isAvailable() && (
            <View style={styles.warningContainer}>
              <Text style={styles.warningText}>⚠️ Sonar not available on this platform</Text>
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  tabContainer: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.panel },
  activeTab: { backgroundColor: colors.background, borderBottomWidth: 2, borderBottomColor: colors.accent },
  tabText: { color: colors.textMuted, fontWeight: '600', fontSize: 15 },
  activeTabText: { color: colors.accent },
  controls: { padding: 12, flexDirection: 'row', gap: 8 },
  button: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, flex: 1, alignItems: 'center' },
  startButton: { backgroundColor: colors.success },
  stopButton: { backgroundColor: colors.error },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  stats: {
    flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.panel,
  },
  statText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  listContent: { padding: 12 },
  card: {
    backgroundColor: colors.panel, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, marginBottom: 10,
  },
  selectedCard: { borderColor: colors.accent, borderWidth: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  deviceId: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: colors.text },
  rssiText: { fontWeight: 'bold', fontSize: 16 },
  graphContainer: { height: 50, flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6, paddingHorizontal: 4 },
  bar: { flex: 1, borderRadius: 2, maxWidth: 12 },
  emptyContainer: { padding: 60, alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: colors.textMuted, textAlign: 'center', lineHeight: 22, fontSize: 15 },
  iconText: { fontSize: 24 },
  // Sonar styles
  sonarDisplay: { alignItems: 'center', paddingVertical: 30, backgroundColor: colors.panel, margin: 12, borderRadius: 16 },
  sonarLabel: { fontSize: 14, color: colors.textMuted, letterSpacing: 2 },
  sonarValue: { fontSize: 56, fontWeight: 'bold', color: colors.text, marginVertical: 8 },
  sonarAmplitude: { fontSize: 14, color: colors.textMuted },
  sonarGraphWrapper: { margin: 12, backgroundColor: colors.panel, borderRadius: 12, padding: 16 },
  graphTitle: { fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  sonarGraphContainer: { height: 100, flexDirection: 'row', alignItems: 'flex-end', gap: 2, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 4 },
  sonarBar: { flex: 1, borderRadius: 2, maxWidth: 8 },
  graphLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  graphLabel: { fontSize: 10, color: colors.textMuted },
  warningContainer: { margin: 12, padding: 16, backgroundColor: '#332200', borderRadius: 8 },
  warningText: { color: '#ffaa00', textAlign: 'center' },
  // Backend status styles
  statusBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, gap: 8 },
  statusConnected: { backgroundColor: '#1a3a1a' },
  statusChecking: { backgroundColor: '#333300' },
  statusError: { backgroundColor: '#3a1a1a' },
  statusText: { color: colors.text, fontSize: 13 },
});
