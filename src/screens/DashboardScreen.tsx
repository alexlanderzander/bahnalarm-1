
import React, { useState, useCallback } from 'react';
import { ScrollView, View, TouchableOpacity, Text, StyleSheet, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { theme, colors } from '../styles/styles';
import { AlarmDisplay } from '../components/AlarmDisplay';
import { StatusCard } from '../components/StatusCard';
import { AdjustmentHistory } from '../components/AdjustmentHistory';

import { findJourneyByArrival } from '../api/DbApiService';
import { getNextArrivalDateTime } from '../utils/timeHelper';
import type { Journey } from '../types/ApiTypes';
import type { UserSettings } from '../types/SettingsTypes';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';
const USER_SETTINGS_KEY = '@BahnAlarm:userSettings';

export const DashboardScreen = ({ navigation }) => {
  const [alarmTime, setAlarmTime] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [history, setHistory] = useState<AlarmAdjustment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const settingsString = await AsyncStorage.getItem(USER_SETTINGS_KEY);
      const alarmTimeString = await AsyncStorage.getItem(ALARM_TIME_KEY);
      const historyString = await AsyncStorage.getItem(ADJUSTMENT_HISTORY_KEY);

      setAlarmTime(alarmTimeString);
      setHistory(historyString ? JSON.parse(historyString) : []);

      if (settingsString) {
        const settings: UserSettings = JSON.parse(settingsString);
        
        // *** NEW "ARRIVE BY" LOGIC FOR DASHBOARD ***
        const nextArrivalDateTime = getNextArrivalDateTime(settings.arrivalTime);
        const journeyData = await findJourneyByArrival(settings.startStation.id, settings.destinationStation.id, nextArrivalDateTime);
        
        setJourney(journeyData.journeys[0] ?? null);
      } else {
        setJourney(null);
      }
    } catch (error) {
      console.error('[DashboardScreen] Error loading data:', error);
      setJourney(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView style={theme.container}>
      <ScrollView 
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContentContainer}
      >
        <AlarmDisplay alarmTime={alarmTime} />
        <View style={{ height: 20 }} />
        <StatusCard journey={journey} isLoading={isLoading} onRefresh={loadData} />
        <AdjustmentHistory history={history} />
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.settingsButton}
          onPress={() => navigation.navigate('Settings')} 
        >
          <Text style={styles.settingsButtonText}>Settings</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
  },
  scrollContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  footer: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  settingsButton: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 50,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  settingsButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
