import React from 'react';
import { View, Text } from 'react-native';
import { parseISO, format } from 'date-fns';
import { theme } from '../styles/styles';

interface AlarmDisplayProps {
  alarmTime: string | null; // ISO 8601 string
}

export const AlarmDisplay: React.FC<AlarmDisplayProps> = ({ alarmTime }) => {
  const timeToShow = alarmTime ? parseISO(alarmTime) : null;

  return (
    <View style={theme.panel}>
      <View style={theme.centered}>
        <Text style={theme.label}>YOUR ALARM IS SET FOR</Text>
        <Text style={theme.title}>
          {timeToShow ? format(timeToShow, 'HH:mm') : '--:--'}
        </Text>
        <Text style={theme.subtitle}>
          {timeToShow ? format(timeToShow, 'eeee, MMMM do') : 'No alarm set'}
        </Text>
      </View>
    </View>
  );
};