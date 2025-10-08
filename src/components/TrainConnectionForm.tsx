
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { theme, colors } from '../styles/styles';
import { searchStations } from '../api/DbApiService';
import type { Location } from '../types/ApiTypes';
import type { UserSettings } from '../types/SettingsTypes';

interface TrainConnectionFormProps {
  initialSettings?: UserSettings | null;
  onSave: (settings: UserSettings) => void;
}

export const TrainConnectionForm: React.FC<TrainConnectionFormProps> = ({ initialSettings, onSave }) => {
  const [startStation, setStartStation] = useState<{ id: string; name: string } | null>(initialSettings?.startStation ?? null);
  const [destinationStation, setDestinationStation] = useState<{ id: string; name: string } | null>(initialSettings?.destinationStation ?? null);
  const [arrivalTime, setArrivalTime] = useState(initialSettings?.arrivalTime ?? '09:00');
  const [preparationTime, setPreparationTime] = useState(initialSettings?.preparationTime?.toString() ?? '75');

  const [startQuery, setStartQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [startResults, setStartResults] = useState<Location[]>([]);
  const [destResults, setDestResults] = useState<Location[]>([]);
  const [loadingStart, setLoadingStart] = useState(false);
  const [loadingDest, setLoadingDest] = useState(false);
  const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);

  const handleSave = () => {
    if (startStation && destinationStation && arrivalTime && preparationTime) {
      onSave({
        startStation,
        destinationStation,
        arrivalTime,
        preparationTime: parseInt(preparationTime, 10),
      });
    } else {
      alert('Please fill out all fields.');
    }
  };

  const search = async (query: string, setResults: (res: Location[]) => void, setLoading: (l: boolean) => void) => {
    if (query.length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const results = await searchStations(query);
      setResults(results);
    } catch (error) {
      console.error(error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const debouncedSearchStart = useCallback(debounce((q: string) => search(q, setStartResults, setLoadingStart), 300), []);
  const debouncedSearchDest = useCallback(debounce((q: string) => search(q, setDestResults, setLoadingDest), 300), []);

  useEffect(() => { if (activeInput === 'start') debouncedSearchStart(startQuery); }, [startQuery]);
  useEffect(() => { if (activeInput === 'dest') debouncedSearchDest(destQuery); }, [destQuery]);

  const renderStationSelector = (
    query: string,
    setQuery: (q: string) => void,
    setStation: (s: Location) => void,
    selectedStation: { name: string } | null,
    placeholder: string,
    results: Location[],
    setResults: (r: Location[]) => void,
    loading: boolean,
    inputType: 'start' | 'dest'
  ) => (
    <View style={styles.inputGroup}>
      <Text style={theme.label}>{placeholder}</Text>
      <TextInput
        style={theme.input}
        placeholder={`e.g. Berlin Hbf`}
        placeholderTextColor={colors.textMuted}
        value={selectedStation ? selectedStation.name : query}
        onFocus={() => setActiveInput(inputType)}
        onChangeText={(text) => {
          if (selectedStation) setStation(null);
          setQuery(text);
        }}
      />
      {loading && <ActivityIndicator style={styles.loader} color={colors.text} />}
      {results.length > 0 && activeInput === inputType && (
        <View style={styles.resultsContainer}>
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.resultItem}
                onPress={() => {
                  setStation(item);
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
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={theme.panel}>
      <Text style={theme.subtitle}>Commute Settings</Text>
      {renderStationSelector(startQuery, setStartQuery, setStartStation, startStation, 'Start Station', startResults, setStartResults, loadingStart, 'start')}
      {renderStationSelector(destQuery, setDestQuery, setDestinationStation, destinationStation, 'Destination Station', destResults, setDestResults, loadingDest, 'dest')}
      
      <View style={styles.inputGroup}>
        <Text style={theme.label}>Required Arrival Time</Text>
        <TextInput style={theme.input} value={arrivalTime} onChangeText={setArrivalTime} placeholder="HH:MM (24h)" />
      </View>

      <View style={styles.inputGroup}>
        <Text style={theme.label}>Preparation Time (in minutes)</Text>
        <TextInput style={theme.input} value={preparationTime} onChangeText={setPreparationTime} placeholder="e.g. 75" keyboardType="numeric" />
      </View>

      <TouchableOpacity style={theme.button} onPress={handleSave}>
        <Text style={theme.buttonText}>Save Settings</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

const debounce = <F extends (...args: any[]) => any>(func: F, delay: number) => {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<F>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => { func(...args); }, delay);
  };
};

const styles = StyleSheet.create({
  inputGroup: {
    marginBottom: 15,
  },
  resultsContainer: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 5,
    maxHeight: 150,
  },
  resultItem: {
    padding: 15,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  loader: {
    position: 'absolute',
    right: 15,
    top: 45,
  },
});
