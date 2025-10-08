
import React, { useEffect } from 'react';
import { StatusBar, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { initBackgroundFetch } from './src/services/BackgroundUpdateService';

const App = () => {
  useEffect(() => {
    // This function runs once on app startup
    const bootstrapApp = async () => {
      // --- 1. Request permissions (required for iOS)
      await notifee.requestPermission();

      // --- 2. Create a channel (required for Android)
      const channelId = await notifee.createChannel({
        id: 'alarm',
        name: 'Alarms',
        sound: 'default', // Optional: specify a sound
        importance: AndroidImportance.HIGH, // Make sure notifications are delivered promptly
      });
      console.log('Notification channel created:', channelId);

      // --- 3. Initialize the background fetch service
      initBackgroundFetch();
    };

    bootstrapApp();
  }, []);

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" />
      <AppNavigator />
    </NavigationContainer>
  );
};

export default App;
