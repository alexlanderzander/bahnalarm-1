
import BackgroundFetch from 'react-native-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subMinutes, parseISO, format, formatISO } from 'date-fns';
import notifee, { TimestampTrigger, TriggerType } from '@notifee/react-native';

import { findJourneyByArrival } from '../api/DbApiService';
import { findNextActiveCommute } from '../utils/timeHelper';
import type { WeekSettings, DaySetting } from '../types/SettingsTypes';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';
const WEEK_SETTINGS_KEY = '@BahnAlarm:weekSettings'; // <-- New Key
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

    const journeyResponse = await findJourneyByArrival(startStation.id, destinationStation.id, formatISO(commuteDate));
    const leg = journeyResponse.journeys[0]?.legs[0];

    if (!leg) {
      BackgroundFetch.finish(taskId);
      return;
    }

    const plannedDeparture = parseISO(leg.plannedDeparture);
    const delaySeconds = leg.departureDelay ?? 0;
    const actualDeparture = new Date(plannedDeparture.getTime() + delaySeconds * 1000);
    const newAlarmTime = subMinutes(actualDeparture, preparationTime);

    const oldAlarmTimeString = await AsyncStorage.getItem(ALARM_TIME_KEY);

    if (oldAlarmTimeString !== formatISO(newAlarmTime)) {
      await scheduleAlarmNotification(newAlarmTime, leg);
      // ... (rest of the history logging logic is the same)
    }
  } catch (error) {
    console.error('[BackgroundUpdateService] Task error:', error);
  } finally {
    BackgroundFetch.finish(taskId);
  }
};

export const initBackgroundFetch = async () => {
  // ... (configuration remains the same)
};

BackgroundFetch.registerHeadlessTask(backgroundTask);
