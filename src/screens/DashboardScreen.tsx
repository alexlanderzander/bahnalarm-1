import React, { useState, useCallback } from 'react';
import { ScrollView, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; // <-- FIX: Import from correct library
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, formatISO, parseISO, subMinutes } from 'date-fns';

import { theme, colors } from '../styles/styles';
import { AlarmDisplay } from '../components/AlarmDisplay';
import { StatusCard } from '../components/StatusCard';
import { AdjustmentHistory } from '../components/AdjustmentHistory';

import { findJourneyByArrival } from '../api/DbApiService';
import { findNextActiveCommute } from '../utils/timeHelper';
import type { Journey } from '../types/ApiTypes';
import type { WeekSettings } from '../types/SettingsTypes';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';
const WEEK_SETTINGS_KEY = '@BahnAlarm:weekSettings';

export const DashboardScreen = ({ navigation }) => {
  const [alarmTime, setAlarmTime] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [history, setHistory] = useState<AlarmAdjustment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [nextCommuteInfo, setNextCommuteInfo] = useState<{ name: string; day: string } | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setJourney(null);
    setNextCommuteInfo(null);

    console.log("----------------------------------------");
    console.log("[DASHBOARD DEBUG] loadData started.");

    try {
      const settingsString = await AsyncStorage.getItem(WEEK_SETTINGS_KEY);
      const alarmTimeString = await AsyncStorage.getItem(ALARM_TIME_KEY);
      const historyString = await AsyncStorage.getItem(ADJUSTMENT_HISTORY_KEY);

      setAlarmTime(alarmTimeString);
      setHistory(historyString ? JSON.parse(historyString) : []);

      if (settingsString) {
        const weekSettings: WeekSettings = JSON.parse(settingsString);
        const nextCommute = findNextActiveCommute(weekSettings);

        if (nextCommute) {
          console.log("[DASHBOARD DEBUG] nextCommute found:", nextCommute.settings.name, "on", format(nextCommute.commuteDate, 'eeee'));
          console.log("[DASHBOARD DEBUG]   startStation:", nextCommute.settings.startStation?.name);
          console.log("[DASHBOARD DEBUG]   destinationStation:", nextCommute.settings.destinationStation?.name);

          const { commuteDate, settings } = nextCommute;
          setNextCommuteInfo({ name: settings.name, day: format(commuteDate, 'eeee') });

          if (settings.startStation && settings.destinationStation) {
            console.log("[DASHBOARD DEBUG] Calling findJourneyByArrival...");
            const journeyData = await findJourneyByArrival(settings.startStation.id, settings.destinationStation.id, formatISO(commuteDate));
            const firstJourney = journeyData.journeys[0] ?? null;
            setJourney(firstJourney);

            // FIX: Update alarm time from live journey data
            if (firstJourney && firstJourney.legs[0]) {
              const leg = firstJourney.legs[0];
              const plannedDeparture = parseISO(leg.plannedDeparture);
              const delaySeconds = leg.departureDelay ?? 0;
              const actualDeparture = new Date(plannedDeparture.getTime() + delaySeconds * 1000);
              const newAlarmTime = subMinutes(actualDeparture, settings.preparationTime);
              setAlarmTime(formatISO(newAlarmTime));
              // Also persist the updated alarm time
              await AsyncStorage.setItem(ALARM_TIME_KEY, formatISO(newAlarmTime));
            }
          } else {
            console.log("[DASHBOARD DEBUG] Skipping findJourneyByArrival: start/destination station missing.");
          }
        } else {
          console.log("[DASHBOARD DEBUG] No nextCommute found.");
        }
      } else {
        console.log("[DASHBOARD DEBUG] No weekSettings found in AsyncStorage.");
      }
    } catch (error) {
      console.error('[DashboardScreen] Error loading data:', error);
    } finally {
      setIsLoading(false);
      console.log("[DASHBOARD DEBUG] loadData finished.");
      console.log("----------------------------------------");
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  return (
    <SafeAreaView style={theme.container} edges={['top', 'bottom']}> {/* <-- FIX: Use edges prop */}
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContentContainer}
      >
        <AlarmDisplay alarmTime={alarmTime} commuteName={nextCommuteInfo?.name ?? null} commuteDay={nextCommuteInfo?.day ?? null} />
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
  scrollContainer: { flex: 1 },
  scrollContentContainer: { flexGrow: 1, justifyContent: 'center' },
  footer: { paddingVertical: 10, paddingHorizontal: 20, alignItems: 'center' },
  settingsButton: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 50, alignSelf: 'stretch', alignItems: 'center' },
  settingsButtonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
});
