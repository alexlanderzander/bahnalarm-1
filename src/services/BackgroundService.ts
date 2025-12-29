/**
 * Background Service Template
 */

import BackgroundFetch from 'react-native-background-fetch';
import notifee, { AndroidImportance, TriggerType } from '@notifee/react-native';
import { logger } from '../utils/logger';

const log = logger.background;

const NOTIFICATION_CHANNEL_ID = 'app-updates';
const NOTIFICATION_CHANNEL_NAME = 'App Updates';

async function initNotificationChannel(): Promise<void> {
  await notifee.createChannel({
    id: NOTIFICATION_CHANNEL_ID,
    name: NOTIFICATION_CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
  });
}

export async function showNotification(
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  await notifee.displayNotification({
    title,
    body,
    data,
    android: {
      channelId: NOTIFICATION_CHANNEL_ID,
      pressAction: { id: 'default' },
    },
  });
}

export async function scheduleNotification(
  title: string,
  body: string,
  triggerTime: Date,
  id?: string
): Promise<string> {
  const notificationId = await notifee.createTriggerNotification(
    {
      id,
      title,
      body,
      android: { channelId: NOTIFICATION_CHANNEL_ID },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: triggerTime.getTime(),
    }
  );

  log.debug(`Scheduled notification for ${triggerTime.toISOString()}`);
  return notificationId;
}

export async function cancelNotification(id: string): Promise<void> {
  await notifee.cancelNotification(id);
}

async function backgroundTask(): Promise<void> {
  log.debug('Background task started');

  try {
    // TODO: Add your background logic here
    log.debug('Background task completed');
  } catch (error) {
    log.error('Background task failed:', error);
  }
}

export async function initBackgroundService(): Promise<void> {
  await initNotificationChannel();

  const status = await BackgroundFetch.configure(
    {
      minimumFetchInterval: 15,
      stopOnTerminate: false,
      startOnBoot: true,
      enableHeadless: true,
    },
    async (taskId) => {
      log.debug(`Background fetch event: ${taskId}`);
      await backgroundTask();
      BackgroundFetch.finish(taskId);
    },
    (taskId) => {
      log.warn(`Background fetch timeout: ${taskId}`);
      BackgroundFetch.finish(taskId);
    }
  );

  log.debug(`BackgroundFetch configured with status: ${status}`);
}

export async function headlessBackgroundTask(event: { taskId: string }): Promise<void> {
  log.debug(`Headless background task: ${event.taskId}`);
  await backgroundTask();
  BackgroundFetch.finish(event.taskId);
}

export default {
  init: initBackgroundService,
  showNotification,
  scheduleNotification,
  cancelNotification,
};
