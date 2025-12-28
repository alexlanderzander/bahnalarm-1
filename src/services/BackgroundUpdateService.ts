
import BackgroundFetch from 'react-native-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subMinutes, parseISO, format, formatISO } from 'date-fns';
import notifee, { TimestampTrigger, TriggerType } from '@notifee/react-native';

import { findJourneyByArrival } from '../api/DbApiService';
import { findNextActiveCommute } from '../utils/timeHelper';
import type { WeekSettings, Commute } from '../types/SettingsTypes';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';
const WEEK_SETTINGS_KEY = '@BahnAlarm:weekSettings';
const ALARM_NOTIFICATION_ID = 'bahn-alarm-trigger';

const scheduleAlarmNotification = async (alarmTime: Date, leg: any) => {
  await notifee.cancelNotification(ALARM_NOTIFICATION_ID);
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: alarmTime.getTime(),
  };
  const delayInMinutes = leg.departureDelay ? Math.round(leg.departureDelay / 60) : 0;
  await notifee.createTriggerNotification(
    {
      id: ALARM_NOTIFICATION_ID,
      title: 'Time to wake up!',
      body: `Your train ${leg.line?.name ?? ''} is ${delayInMinutes > 0 ? `delayed by ${delayInMinutes} min` : 'on time'}. Departure: ${format(parseISO(leg.departure), 'HH:mm')}`,
      android: { channelId: 'alarm', pressAction: { id: 'default' } },
    },
    trigger,
  );
};

const backgroundTask = async (taskId: string) => {
  console.log('[BackgroundUpdateService] Task starting:', taskId);
  try {
    const settingsString = await AsyncStorage.getItem(WEEK_SETTINGS_KEY);
    if (!settingsString) {
      console.log('[BackgroundUpdateService] No settings found.');
      BackgroundFetch.finish(taskId);
      return;
    }

    const weekSettings: WeekSettings = JSON.parse(settingsString);
    const nextCommute = findNextActiveCommute(weekSettings);

    if (!nextCommute) {
      console.log('[BackgroundUpdateService] No active commute found.');
      BackgroundFetch.finish(taskId);
      return;
    }

    const { commuteDate, settings } = nextCommute;
    const { startStation, destinationStation, preparationTime } = settings;

    // FIX: Add null checks for stations
    if (!startStation || !destinationStation) {
      console.log('[BackgroundUpdateService] Commute missing start or destination station.');
      BackgroundFetch.finish(taskId);
      return;
    }

    const journeyResponse = await findJourneyByArrival(startStation.id, destinationStation.id, formatISO(commuteDate));
    const leg = journeyResponse.journeys[0]?.legs[0];

    if (!leg) {
      console.log('[BackgroundUpdateService] No journey leg found.');
      BackgroundFetch.finish(taskId);
      return;
    }

    const plannedDeparture = parseISO(leg.plannedDeparture);
    const delaySeconds = leg.departureDelay ?? 0;
    const actualDeparture = new Date(plannedDeparture.getTime() + delaySeconds * 1000);
    const newAlarmTime = subMinutes(actualDeparture, preparationTime);

    const oldAlarmTimeString = await AsyncStorage.getItem(ALARM_TIME_KEY);

    if (oldAlarmTimeString !== formatISO(newAlarmTime)) {
      console.log('[BackgroundUpdateService] Alarm time changed, updating...');
      await AsyncStorage.setItem(ALARM_TIME_KEY, formatISO(newAlarmTime));
      await scheduleAlarmNotification(newAlarmTime, leg);

      // Log the adjustment to history
      if (oldAlarmTimeString) {
        const historyString = await AsyncStorage.getItem(ADJUSTMENT_HISTORY_KEY);
        const history: AlarmAdjustment[] = historyString ? JSON.parse(historyString) : [];
        const delayInMinutes = Math.round(delaySeconds / 60);

        const adjustment: AlarmAdjustment = {
          id: `adj-${Date.now()}`,
          timestamp: formatISO(new Date()),
          oldAlarmTime: oldAlarmTimeString,
          newAlarmTime: formatISO(newAlarmTime),
          delayInMinutes,
        };

        history.unshift(adjustment);
        // Keep only the last 10 adjustments
        const trimmedHistory = history.slice(0, 10);
        await AsyncStorage.setItem(ADJUSTMENT_HISTORY_KEY, JSON.stringify(trimmedHistory));
        console.log('[BackgroundUpdateService] Adjustment logged:', adjustment);
      }
    } else {
      console.log('[BackgroundUpdateService] Alarm time unchanged.');
    }
  } catch (error) {
    console.error('[BackgroundUpdateService] Task error:', error);
  } finally {
    BackgroundFetch.finish(taskId);
  }
};

export const initBackgroundFetch = async () => {
  try {
    const status = await BackgroundFetch.configure(
      {
        minimumFetchInterval: 15, // Fetch every 15 minutes (minimum on iOS)
        stopOnTerminate: false,   // Continue running after app is terminated
        startOnBoot: true,        // Start on device boot (Android)
        enableHeadless: true,     // Enable headless mode (Android)
      },
      backgroundTask,
      (taskId) => {
        console.log('[BackgroundUpdateService] Task timeout:', taskId);
        BackgroundFetch.finish(taskId);
      }
    );
    console.log('[BackgroundUpdateService] Configured with status:', status);
  } catch (error) {
    console.error('[BackgroundUpdateService] Failed to configure:', error);
  }
};

// HeadlessTask wrapper for Android
const headlessTask = async ({ taskId }: { taskId: string }) => {
  await backgroundTask(taskId);
};

BackgroundFetch.registerHeadlessTask(headlessTask);
