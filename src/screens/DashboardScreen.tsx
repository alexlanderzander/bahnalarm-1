import React, { useState, useCallback } from 'react';
import { ScrollView, View, TouchableOpacity, Text, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, formatISO, isPast } from 'date-fns';

import { theme, colors } from '../styles/styles';
import { AlarmDisplay } from '../components/AlarmDisplay';
import { StatusCard } from '../components/StatusCard';
import { AdjustmentHistory } from '../components/AdjustmentHistory';
import { EmptyState } from '../components/EmptyState';

import { findJourneyByArrival } from '../api/DbApiService';
import { findNextActiveCommute } from '../utils/timeHelper';
import { selectOptimalJourney, getFirstLeg, DEFAULT_SAFETY_BUFFER } from '../utils/journeySelection';
import { scheduleAlarmNotification } from '../services/BackgroundUpdateService';
import { scheduleAlarm as scheduleNativeAlarm, isAlarmKitAvailable } from '../services/AlarmKitService';
import { logger } from '../utils/logger';
import { COMMUTE_SETTINGS_KEY } from '../types/SettingsTypes';
import type { CommuteSettings } from '../types/SettingsTypes';
import type { Journey } from '../types/ApiTypes';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

const log = logger.dashboard;

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';

interface Props {
  navigation: NativeStackNavigationProp<any>;
}

export const DashboardScreen = ({ navigation }: Props) => {
  const [alarmTime, setAlarmTime] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [history, setHistory] = useState<AlarmAdjustment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasCommutes, setHasCommutes] = useState(false);
  const [nextCommuteInfo, setNextCommuteInfo] = useState<{ name: string; day: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setJourney(null);
    setNextCommuteInfo(null);
    setError(null);

    try {
      const settingsString = await AsyncStorage.getItem(COMMUTE_SETTINGS_KEY);
      const alarmTimeString = await AsyncStorage.getItem(ALARM_TIME_KEY);
      const historyString = await AsyncStorage.getItem(ADJUSTMENT_HISTORY_KEY);

      setAlarmTime(alarmTimeString);
      setHistory(historyString ? JSON.parse(historyString) : []);

      if (settingsString) {
        const commutes: CommuteSettings = JSON.parse(settingsString);

        // Check if any commutes exist and are enabled
        const hasAnyCommutes = commutes.length > 0 && commutes.some(c => c.enabled);
        setHasCommutes(hasAnyCommutes);

        const nextCommute = findNextActiveCommute(commutes);

        if (nextCommute) {
          const { commuteDate, commute: settings } = nextCommute;
          setNextCommuteInfo({ name: settings.name, day: format(commuteDate, 'eeee') });

          if (settings.startStation && settings.destinationStation) {
            log.debug(`Loading journey for ${settings.name}`);
            const journeyData = await findJourneyByArrival(
              settings.startStation.id,
              settings.destinationStation.id,
              formatISO(commuteDate)
            );

            const safetyBuffer = settings.safetyBuffer ?? DEFAULT_SAFETY_BUFFER;
            const selection = selectOptimalJourney(
              journeyData.journeys,
              commuteDate,
              settings.preparationTime,
              safetyBuffer
            );

            setJourney(selection.journey);

            if (selection.journey && selection.alarmTime) {
              const leg = getFirstLeg(selection.journey);

              // Only schedule if alarm time is in the future
              if (!isPast(selection.alarmTime)) {
                log.debug(`Selected: ${selection.reasoning}`);
                setAlarmTime(formatISO(selection.alarmTime));
                await AsyncStorage.setItem(ALARM_TIME_KEY, formatISO(selection.alarmTime));

                if (leg) {
                  await scheduleAlarmNotification(selection.alarmTime, leg);

                  const alarmKitAvailable = await isAlarmKitAvailable();
                  if (alarmKitAvailable) {
                    const trainName = leg.line?.name ?? 'Your train';
                    const delaySeconds = leg.departureDelay ?? 0;
                    const delayInfo = delaySeconds > 0 ? `+${Math.round(delaySeconds / 60)}min delay` : 'On time';
                    await scheduleNativeAlarm(selection.alarmTime, `Time for ${trainName}`, delayInfo);
                  }
                }
              } else {
                // Alarm would be in the past, show next occurrence info
                setAlarmTime(null);
              }
            }
          }
        }
      } else {
        setHasCommutes(false);
      }
    } catch (err) {
      log.error('Error loading data:', err);
      setError('Failed to load journey data. Pull down to retry.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const goToSettings = () => navigation.navigate('Settings');

  // Show empty state if no commutes configured
  if (!isLoading && !hasCommutes) {
    return (
      <SafeAreaView style={theme.container} edges={['top', 'bottom']}>
        <EmptyState
          emoji="🚂"
          title="No alarms set up"
          message="Add your first alarm to get smart wake-up times based on live train schedules."
          actionLabel="Add Alarm"
          onAction={goToSettings}
        />
      </SafeAreaView>
    );
  }

  // Show error state with retry
  if (!isLoading && error) {
    return (
      <SafeAreaView style={theme.container} edges={['top', 'bottom']}>
        <EmptyState
          emoji="⚠️"
          title="Connection Error"
          message={error}
          actionLabel="Retry"
          onAction={loadData}
        />
        <View style={styles.footer}>
          <TouchableOpacity style={styles.settingsButton} onPress={goToSettings}>
            <Text style={styles.settingsButtonText}>Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={theme.container} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={loadData}
            tintColor={colors.text}
          />
        }
      >
        <AlarmDisplay alarmTime={alarmTime} commuteName={nextCommuteInfo?.name ?? null} commuteDay={nextCommuteInfo?.day ?? null} />
        <View style={{ height: 20 }} />
        <StatusCard journey={journey} isLoading={isLoading} onRefresh={loadData} />
        <AdjustmentHistory history={history} />
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={goToSettings}
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
