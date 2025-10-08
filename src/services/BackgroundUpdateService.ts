import BackgroundFetch from 'react-native-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subMinutes, parseISO, format, formatISO } from 'date-fns';
import notifee, { TimestampTrigger, TriggerType } from '@notifee/react-native';

import { findJourneyByArrival } from '../api/DbApiService'; // <-- Use new function
import { getNextArrivalDateTime } from '../utils/timeHelper'; // <-- Use new function
import type { UserSettings } from '../types/SettingsTypes';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';
const USER_SETTINGS_KEY = '@BahnAlarm:userSettings';
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
  console.log(`[NotificationService] Scheduled new notification for: ${formatISO(alarmTime)}`);
};

const backgroundTask = async (taskId: string) => {
  console.log('[BackgroundUpdateService] Task starting:', taskId);
  try {
    const settingsString = await AsyncStorage.getItem(USER_SETTINGS_KEY);
    if (!settingsString) {
      BackgroundFetch.finish(taskId);
      return;
    }

    const settings: UserSettings = JSON.parse(settingsString);
    const { startStation, destinationStation, preparationTime, arrivalTime } = settings;

    // *** NEW "ARRIVE BY" LOGIC FOR BACKGROUND SERVICE ***
    const nextArrivalDateTime = getNextArrivalDateTime(arrivalTime);
    const journeyResponse = await findJourneyByArrival(startStation.id, destinationStation.id, nextArrivalDateTime);
    const leg = journeyResponse.journeys[0]?.legs[0];

    if (!leg) {
      BackgroundFetch.finish(taskId);
      return;
    }

    // The alarm is based on the DEPARTURE time of the train that ARRIVES on time.
    const plannedDeparture = parseISO(leg.plannedDeparture);
    const delaySeconds = leg.departureDelay ?? 0;
    const actualDeparture = new Date(plannedDeparture.getTime() + delaySeconds * 1000);
    const newAlarmTime = subMinutes(actualDeparture, preparationTime);

    const oldAlarmTimeString = await AsyncStorage.getItem(ALARM_TIME_KEY);

    if (oldAlarmTimeString !== formatISO(newAlarmTime)) {
      console.log(`[BackgroundUpdateService] Alarm time updated. New time: ${formatISO(newAlarmTime)}`);
      await scheduleAlarmNotification(newAlarmTime, leg);

      const historyString = await AsyncStorage.getItem(ADJUSTMENT_HISTORY_KEY);
      const history: AlarmAdjustment[] = historyString ? JSON.parse(historyString) : [];
      const newAdjustment: AlarmAdjustment = {
        id: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        oldAlarmTime: oldAlarmTimeString ?? formatISO(newAlarmTime),
        newAlarmTime: formatISO(newAlarmTime),
        delayInMinutes: Math.round(delaySeconds / 60),
      };
      const updatedHistory = [newAdjustment, ...history].slice(0, 20);

      await AsyncStorage.setItem(ALARM_TIME_KEY, formatISO(newAlarmTime));
      await AsyncStorage.setItem(ADJUSTMENT_HISTORY_KEY, JSON.stringify(updatedHistory));
    }
  } catch (error) {
    console.error('[BackgroundUpdateService] Task error:', error);
  } finally {
    BackgroundFetch.finish(taskId);
  }
};

export const initBackgroundFetch = async () => {
  const status = await BackgroundFetch.configure(
    { minimumFetchInterval: 15, stopOnTerminate: false, startOnBoot: true, enableHeadless: true },
    backgroundTask,
    (taskId) => {
      console.error('[BackgroundUpdateService] Task timed out:', taskId);
      BackgroundFetch.finish(taskId);
    }
  );
  console.log('[BackgroundUpdateService] BackgroundFetch configured with status:', status);
};

BackgroundFetch.registerHeadlessTask(backgroundTask);