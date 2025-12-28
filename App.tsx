import React, { useEffect } from 'react';
import { StatusBar, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { initBackgroundFetch } from './src/services/BackgroundUpdateService';
import { requestAlarmPermission, isAlarmKitAvailable } from './src/services/AlarmKitService';
import ErrorBoundary from './src/components/ErrorBoundary';
import { logger } from './src/utils/logger';

const log = logger.app;

const App = () => {
  useEffect(() => {
    const bootstrapApp = async () => {
      log.debug('Starting app initialization...');

      // 1. Request notification permissions
      await notifee.requestPermission({
        sound: true,
        alert: true,
        badge: true,
        criticalAlert: true,
      });

      // 2. Create notification channel (Android)
      await notifee.createChannel({
        id: 'alarm',
        name: 'Alarms',
        sound: 'default',
        importance: AndroidImportance.HIGH,
        vibration: true,
      });

      // 3. Request AlarmKit permission (iOS 26+)
      if (Platform.OS === 'ios') {
        const alarmKitAvailable = await isAlarmKitAvailable();
        if (alarmKitAvailable) {
          await requestAlarmPermission();
        }
      }

      // 4. Initialize background fetch
      initBackgroundFetch();

      log.debug('App initialization complete');
    };

    bootstrapApp();
  }, []);

  return (
    <ErrorBoundary>
      <NavigationContainer>
        <StatusBar barStyle="light-content" />
        <AppNavigator />
      </NavigationContainer>
    </ErrorBoundary>
  );
};

export default App;
