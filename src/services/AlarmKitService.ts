/**
 * AlarmKitService - Uses custom AlarmKitBridge native module
 * Uses Apple's AlarmKit (iOS 26+) for native alarms that bypass silent mode
 */

import { NativeModules, Platform } from 'react-native';
import { format } from 'date-fns';
import { logger } from '../utils/logger';

const { AlarmKitBridge } = NativeModules;
const log = logger.alarmKit;

// Must be a valid UUID string since Swift AlarmManager.schedule expects UUID
const ALARM_ID = '12345678-1234-1234-1234-123456789abc';

/**
 * Check if AlarmKit is available on this device (iOS 26+)
 */
export const isAlarmKitAvailable = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios' || !AlarmKitBridge) {
    return false;
  }

  try {
    const available = await AlarmKitBridge.isAvailable();
    log.debug('AlarmKit available:', available);
    return available;
  } catch (error) {
    log.error('Error checking availability:', error);
    return false;
  }
};

/**
 * Request AlarmKit authorization from the user
 */
export const requestAlarmPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios' || !AlarmKitBridge) {
    return false;
  }

  try {
    log.debug('Requesting alarm permission...');
    const result = await AlarmKitBridge.requestAuthorization();
    log.debug('Authorization result:', result);
    return result;
  } catch (error) {
    log.error('Authorization error:', error);
    return false;
  }
};

/**
 * Schedule an alarm using AlarmKit
 * @param alarmTime - When the alarm should trigger
 * @param title - Alarm title (e.g., train name)
 * @param subtitle - Additional info (e.g., delay status)
 */
export const scheduleAlarm = async (
  alarmTime: Date,
  title: string,
  subtitle: string = '',
): Promise<boolean> => {
  if (Platform.OS !== 'ios' || !AlarmKitBridge) {
    return false;
  }

  try {
    log.debug(`Scheduling alarm for ${format(alarmTime, 'HH:mm')}: ${title}`);

    // Cancel existing alarm first (silently ignore errors)
    try {
      await AlarmKitBridge.cancelAlarm(ALARM_ID);
    } catch {
      // No existing alarm to cancel - that's fine
    }

    // Schedule new alarm
    const result = await AlarmKitBridge.scheduleAlarm(
      ALARM_ID,
      alarmTime.getTime(),
      title,
      subtitle
    );

    log.debug('Alarm scheduled:', result);
    return result;
  } catch (error) {
    log.error('Failed to schedule alarm:', error);
    return false;
  }
};

/**
 * Cancel the scheduled alarm
 */
export const cancelAlarm = async (): Promise<void> => {
  if (Platform.OS !== 'ios' || !AlarmKitBridge) {
    return;
  }

  try {
    await AlarmKitBridge.cancelAlarm(ALARM_ID);
    log.debug('Alarm cancelled');
  } catch {
    // Silently ignore - alarm may not exist
  }
};
