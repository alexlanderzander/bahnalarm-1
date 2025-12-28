
import BackgroundFetch from 'react-native-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subMinutes, parseISO, format, formatISO, isPast, addMinutes } from 'date-fns';
import notifee, { TimestampTrigger, TriggerType } from '@notifee/react-native';

import { findJourneyByArrival } from '../api/DbApiService';
import { findNextActiveCommute } from '../utils/timeHelper';
import { logger } from '../utils/logger';
import { COMMUTE_SETTINGS_KEY } from '../types/SettingsTypes';
import type { CommuteSettings } from '../types/SettingsTypes';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

const log = logger.notification;
const bgLog = logger.background;

const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';
const ALARM_NOTIFICATION_ID = 'bahn-alarm-trigger';

/**
 * Schedules an alarm notification for the given time.
 * Returns true if scheduled successfully, false if time is in the past.
 */
export const scheduleAlarmNotification = async (alarmTime: Date, leg: any): Promise<boolean> => {
  // CRITICAL FIX: Check if alarm time is in the past
  if (isPast(alarmTime)) {
    log.debug(`Alarm time ${format(alarmTime, 'HH:mm')} is in the past, skipping notification`);
    return false;
  }

  // Also skip if alarm is less than 1 minute away (too close to schedule)
  const oneMinuteFromNow = addMinutes(new Date(), 1);
  if (alarmTime < oneMinuteFromNow) {
    log.debug(`Alarm time ${format(alarmTime, 'HH:mm')} is too close, skipping notification`);
    return false;
  }

  try {
    // Cancel any existing notification
    await notifee.cancelNotification(ALARM_NOTIFICATION_ID);

    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: alarmTime.getTime(),
    };

    const delayInMinutes = leg?.departureDelay ? Math.round(leg.departureDelay / 60) : 0;
    const departureTime = leg?.departure ? format(parseISO(leg.departure), 'HH:mm') : 'N/A';
    const trainName = leg?.line?.name ?? 'Your train';

    log.debug(`Scheduling notification for ${format(alarmTime, 'HH:mm')}`);

    await notifee.createTriggerNotification(
      {
        id: ALARM_NOTIFICATION_ID,
        title: '⏰ Time to wake up!',
        body: `${trainName} is ${delayInMinutes > 0 ? `delayed by ${delayInMinutes} min` : 'on time'}. Departure: ${departureTime}`,
        android: {
          channelId: 'alarm',
          pressAction: { id: 'default' },
          sound: 'default',
        },
        ios: {
          sound: 'default',
          interruptionLevel: 'timeSensitive',
        },
      },
      trigger,
    );

    log.debug('Notification scheduled successfully');
    return true;
  } catch (error) {
    log.error('Failed to schedule notification:', error);
    return false;
  }
};

const backgroundTask = async (taskId: string) => {
  bgLog.debug('Background task starting');

  try {
    const settingsString = await AsyncStorage.getItem(COMMUTE_SETTINGS_KEY);
    if (!settingsString) {
      BackgroundFetch.finish(taskId);
      return;
    }

    const commutes: CommuteSettings = JSON.parse(settingsString);
    const nextCommute = findNextActiveCommute(commutes);

    if (!nextCommute) {
      BackgroundFetch.finish(taskId);
      return;
    }

    const { commuteDate, commute: settings } = nextCommute;
    const { startStation, destinationStation, preparationTime } = settings;

    if (!startStation || !destinationStation) {
      BackgroundFetch.finish(taskId);
      return;
    }

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

    // Skip if alarm time is in the past
    if (isPast(newAlarmTime)) {
      bgLog.debug('Calculated alarm time is in the past, skipping update');
      BackgroundFetch.finish(taskId);
      return;
    }

    const oldAlarmTimeString = await AsyncStorage.getItem(ALARM_TIME_KEY);

    if (oldAlarmTimeString !== formatISO(newAlarmTime)) {
      bgLog.debug('Alarm time changed, updating...');
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
        const trimmedHistory = history.slice(0, 10);
        await AsyncStorage.setItem(ADJUSTMENT_HISTORY_KEY, JSON.stringify(trimmedHistory));
      }
    }
  } catch (error) {
    bgLog.error('Background task error:', error);
  } finally {
    BackgroundFetch.finish(taskId);
  }
};

export const initBackgroundFetch = async () => {
  try {
    const status = await BackgroundFetch.configure(
      {
        minimumFetchInterval: 15,
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
      },
      backgroundTask,
      (taskId) => {
        bgLog.warn('Background task timeout');
        BackgroundFetch.finish(taskId);
      }
    );
    bgLog.debug('BackgroundFetch configured, status:', status);
  } catch (error) {
    bgLog.error('Failed to configure BackgroundFetch:', error);
  }
};

// HeadlessTask wrapper for Android
const headlessTask = async ({ taskId }: { taskId: string }) => {
  await backgroundTask(taskId);
};

BackgroundFetch.registerHeadlessTask(headlessTask);
