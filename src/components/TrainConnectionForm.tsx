
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Switch } from 'react-native';
import { theme, colors } from '../styles/styles';
import { searchStations } from '../api/DbApiService';
import type { Location } from '../types/ApiTypes';
import type { Commute } from '../types/SettingsTypes';

interface CommuteFormProps {
  commute: Commute;
  onUpdate: (updatedCommute: Partial<Commute>) => void;
}

export const DaySettingForm: React.FC<CommuteFormProps> = ({ commute, onUpdate }) => {
  if (!commute) {
    console.error("DaySettingForm received undefined commute prop.");
    return null;
  }

  const [startQuery, setStartQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [startResults, setStartResults] = useState<Location[]>([]);
  const [destResults, setDestResults] = useState<Location[]>([]);
  const [loadingStart, setLoadingStart] = useState(false);
  const [loadingDest, setLoadingDest] = useState(false);
  const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);

  const isEnabled = commute.enabled;

  const search = async (query: string, setResults: (res: Location[]) => void, setLoading: (l: boolean) => void) => {
    if (query.length < 2) { setResults([]); setSearchError(null); return; }
    setLoading(true);
    setSearchError(null);
    try {
      const results = await searchStations(query);
      setResults(results);
      if (results.length === 0) {
        setSearchError('No stations found');
      }
    } catch (error) {
      console.error(error);
      setSearchError('Failed to search stations. Check your connection.');
    }
    finally { setLoading(false); }
  };

  const debouncedSearchStart = useCallback(debounce((q: string) => search(q, setStartResults, setLoadingStart), 300), []);
  const debouncedSearchDest = useCallback(debounce((q: string) => search(q, setDestResults, setLoadingDest), 300), []);

  useEffect(() => { if (activeInput === 'start') debouncedSearchStart(startQuery); }, [startQuery]);
  useEffect(() => { if (activeInput === 'dest') debouncedSearchDest(destQuery); }, [destQuery]);

  const renderStationSelector = (
    placeholder: string,
    selectedStation: { name: string } | null,
    query: string,
    setQuery: (q: string) => void,
    onSelectStation: (s: Location) => void,
    results: Location[],
    setResults: (r: Location[]) => void,
    loading: boolean,
    inputType: 'start' | 'dest'
  ) => (
    <View style={styles.inputGroup}>
      <Text style={theme.label}>{placeholder}</Text>
      <TextInput
        style={theme.input}
        placeholderTextColor={colors.textMuted}
        value={selectedStation ? selectedStation.name : query}
        onFocus={() => setActiveInput(inputType)}
        onChangeText={(text) => {
          onUpdate(inputType === 'start' ? { startStation: null } : { destinationStation: null });
          setQuery(text);
        }}
        editable={isEnabled}
      />
      {loading && <ActivityIndicator style={styles.loader} color={colors.text} />}
      {results.length > 0 && activeInput === inputType && (
        <View style={styles.resultsContainer}>
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.resultItem} onPress={() => {
                onSelectStation(item);
                setQuery('');
                setResults([]);
                setActiveInput(null);
              }}>
                <Text style={theme.body}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.formContainer}>
      <View style={styles.inputGroup}>
        <Text style={theme.label}>Commute Name</Text>
        <TextInput style={theme.input} value={commute.name} onChangeText={(val) => onUpdate({ name: val })} placeholder="e.g. To Work" />
      </View>

      <View style={styles.enableSwitchContainer}>
        <Text style={theme.label}>Enable This Commute</Text>
        <Switch
          trackColor={{ false: colors.border, true: colors.success }}
          thumbColor={colors.text}
          onValueChange={(value) => onUpdate({ enabled: value })}
          value={isEnabled}
        />
      </View>

      <View style={{ opacity: isEnabled ? 1 : 0.5 }}>
        {renderStationSelector('Start Station', commute.startStation, startQuery, setStartQuery, (s) => onUpdate({ startStation: s }), startResults, setStartResults, loadingStart, 'start')}
        {renderStationSelector('Destination Station', commute.destinationStation, destQuery, setDestQuery, (s) => onUpdate({ destinationStation: s }), destResults, setDestResults, loadingDest, 'dest')}

        <View style={styles.inputGroup}>
          <Text style={theme.label}>Required Arrival Time</Text>
          <TextInput
            style={[theme.input, timeError ? styles.inputError : null]}
            value={commute.arrivalTime}
            onChangeText={(val) => {
              // Validate HH:mm format
              const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
              if (val.length > 0 && !timeRegex.test(val) && val.length === 5) {
                setTimeError('Use HH:mm format (e.g., 09:00)');
              } else {
                setTimeError(null);
              }
              onUpdate({ arrivalTime: val });
            }}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            editable={isEnabled}
          />
          {timeError && <Text style={styles.errorText}>{timeError}</Text>}
        </View>
        <View style={styles.inputGroup}>
          <Text style={theme.label}>Preparation Time (minutes)</Text>
          <TextInput style={theme.input} value={String(commute.preparationTime)} onChangeText={(val) => onUpdate({ preparationTime: parseInt(val) || 0 })} keyboardType="numeric" editable={isEnabled} />
          <Text style={styles.helperText}>Time you need to get ready before leaving home</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={theme.label}>Safety Buffer (minutes)</Text>
          <View style={styles.bufferPresets}>
            <TouchableOpacity
              style={[styles.presetButton, commute.safetyBuffer === 15 && styles.presetButtonActive]}
              onPress={() => onUpdate({ safetyBuffer: 15 })}
              disabled={!isEnabled}
            >
              <Text style={[styles.presetText, commute.safetyBuffer === 15 && styles.presetTextActive]}>Safe (15)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.presetButton, commute.safetyBuffer === 10 && styles.presetButtonActive]}
              onPress={() => onUpdate({ safetyBuffer: 10 })}
              disabled={!isEnabled}
            >
              <Text style={[styles.presetText, commute.safetyBuffer === 10 && styles.presetTextActive]}>Balanced (10)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.presetButton, commute.safetyBuffer === 5 && styles.presetButtonActive]}
              onPress={() => onUpdate({ safetyBuffer: 5 })}
              disabled={!isEnabled}
            >
              <Text style={[styles.presetText, commute.safetyBuffer === 5 && styles.presetTextActive]}>Risky (5)</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={theme.input}
            value={String(commute.safetyBuffer ?? 10)}
            onChangeText={(val) => onUpdate({ safetyBuffer: parseInt(val) || 0 })}
            keyboardType="numeric"
            editable={isEnabled}
            placeholder="10"
          />
          <Text style={styles.helperText}>Extra buffer for train delays (picks latest safe train)</Text>
        </View>
      </View>
    </View>
  );
};

const debounce = <F extends (...args: any[]) => any>(func: F, delay: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => { func(...args); }, delay);
  };
};

const styles = StyleSheet.create({
  formContainer: { padding: 10 },
  enableSwitchContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  inputGroup: { marginBottom: 15 },
  resultsContainer: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 10, marginTop: 5, maxHeight: 150 },
  resultItem: { padding: 15, borderBottomColor: colors.border, borderBottomWidth: 1 },
  loader: { position: 'absolute', right: 15, top: 45 },
  inputError: { borderColor: colors.error, borderWidth: 1 },
  errorText: { color: colors.error, fontSize: 12, marginTop: 5 },
  helperText: { color: colors.textMuted, fontSize: 12, marginTop: 5, fontStyle: 'italic' },
  bufferPresets: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, gap: 8 },
  presetButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
  },
  presetButtonActive: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  presetText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  presetTextActive: {
    color: colors.background,
    fontWeight: '700',
  },
});
