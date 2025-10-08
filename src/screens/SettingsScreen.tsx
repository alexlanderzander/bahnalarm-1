
import React, { useState, useCallback } from 'react';
import { View, Alert, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subMinutes, parseISO, format, formatISO } from 'date-fns';

import { theme } from '../styles/styles';
import { TrainConnectionForm } from '../components/TrainConnectionForm';
import { findJourneyByArrival } from '../api/DbApiService'; // <-- Use new function
import { getNextArrivalDateTime } from '../utils/timeHelper'; // <-- Use new function
import type { UserSettings } from '../types/SettingsTypes';

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';
const USER_SETTINGS_KEY = '@BahnAlarm:userSettings';

export const SettingsScreen = ({ navigation }) => {
  const [initialSettings, setInitialSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    const settingsString = await AsyncStorage.getItem(USER_SETTINGS_KEY);
    if (settingsString) {
      setInitialSettings(JSON.parse(settingsString));
    }
    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [loadSettings])
  );

  const handleSave = async (settings: UserSettings) => {
    try {
      await AsyncStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(settings));

      // *** NEW "ARRIVE BY" LOGIC ***
      const nextArrivalDateTime = getNextArrivalDateTime(settings.arrivalTime);
      const journeyResponse = await findJourneyByArrival(settings.startStation.id, settings.destinationStation.id, nextArrivalDateTime);
      const leg = journeyResponse.journeys[0]?.legs[0];

      if (!leg) {
        Alert.alert('No Journey Found', 'Could not find a train that arrives by your specified time.');
        return;
      }

      // The alarm is based on the DEPARTURE time of the train that ARRIVES on time.
      const plannedDeparture = parseISO(leg.plannedDeparture);
      const initialAlarmTime = subMinutes(plannedDeparture, settings.preparationTime);

      await AsyncStorage.setItem(ALARM_TIME_KEY, formatISO(initialAlarmTime));
      await AsyncStorage.setItem(ADJUSTMENT_HISTORY_KEY, JSON.stringify([]));

      Alert.alert('Settings Saved', `To arrive by ${format(parseISO(leg.arrival), 'HH:mm')}, your alarm is set for ${format(initialAlarmTime, "HH:mm")}.`);
      navigation.goBack();

    } catch (error) {
      console.error('[SettingsScreen] Error saving settings:', error);
      Alert.alert('Error', 'Failed to save settings. The API might be offline.');
    }
  };

  return (
    <SafeAreaView style={theme.container}>
      {!isLoading && (
        <TrainConnectionForm onSave={handleSave} initialSettings={initialSettings} />
      )}
    </SafeAreaView>
  );
};
