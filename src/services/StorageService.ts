/**
 * Storage Service Template
 * Type-safe wrapper around AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

const log = logger.settings;

// TODO: Define your storage keys here
export const STORAGE_KEYS = {
  SETTINGS: '@app/settings',
  USER_DATA: '@app/userData',
  ONBOARDING_COMPLETE: '@app/onboardingComplete',
} as const;

type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

export const storage = {
  async get<T>(key: StorageKey): Promise<T | null> {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      log.error(`Storage get error for key ${key}:`, error);
      return null;
    }
  },

  async set<T>(key: StorageKey, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      log.debug(`Stored value for key: ${key}`);
    } catch (error) {
      log.error(`Storage set error for key ${key}:`, error);
      throw error;
    }
  },

  async remove(key: StorageKey): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
      log.debug(`Removed value for key: ${key}`);
    } catch (error) {
      log.error(`Storage remove error for key ${key}:`, error);
      throw error;
    }
  },

  async clear(): Promise<void> {
    try {
      const keys = Object.values(STORAGE_KEYS);
      await AsyncStorage.multiRemove(keys);
      log.debug('Cleared all storage');
    } catch (error) {
      log.error('Storage clear error:', error);
      throw error;
    }
  },
};

export default storage;
