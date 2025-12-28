
import React from 'react';
import { View, Text } from 'react-native';
import { parseISO, format } from 'date-fns';
import { theme } from '../styles/styles';

interface AlarmDisplayProps {
  alarmTime: string | null; // ISO 8601 string
  commuteName?: string | null; // e.g., "To Work"
  commuteDay: string | null; // e.g., "Monday"
}

export const AlarmDisplay: React.FC<AlarmDisplayProps> = ({ alarmTime, commuteName, commuteDay }) => {
  const timeToShow = alarmTime ? parseISO(alarmTime) : null;

  const titleText = commuteDay
    ? `${commuteDay.toUpperCase()}'S ALARM`
    : 'NO UPCOMING ALARM';

  // Show commute name or fallback to time-based subtitle
  const subtitleText = timeToShow
    ? (commuteName || format(timeToShow, 'eeee, MMMM do'))
    : 'No active commute set';

  return (
    <View style={theme.panel}>
      <View style={theme.centered}>
        <Text style={theme.label}>{titleText}</Text>
        <Text style={theme.title}>
          {timeToShow ? format(timeToShow, 'HH:mm') : '--:--'}
        </Text>
        <Text style={theme.subtitle}>
          {subtitleText}
        </Text>
      </View>
    </View>
  );
};
