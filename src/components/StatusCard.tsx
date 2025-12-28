import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { format, parseISO } from 'date-fns';
import { theme, colors } from '../styles/styles';
import type { Journey } from '../types/ApiTypes';

interface StatusCardProps {
  journey: Journey | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export const StatusCard: React.FC<StatusCardProps> = ({ journey, isLoading, onRefresh }) => {
  const leg = journey?.legs[0];
  const lastLeg = journey?.legs[journey.legs.length - 1];
  const delayInMinutes = leg?.departureDelay ? Math.round(leg.departureDelay / 60) : 0;
  const transferCount = journey?.legs ? journey.legs.length - 1 : 0;

  // Calculate journey duration in minutes
  const getDuration = () => {
    if (!leg || !lastLeg) return null;
    const departure = parseISO(leg.plannedDeparture);
    const arrival = parseISO(lastLeg.plannedArrival);
    const durationMs = arrival.getTime() - departure.getTime();
    return Math.round(durationMs / 60000);
  };

  const durationMinutes = getDuration();

  const renderContent = () => {
    if (isLoading) {
      return <ActivityIndicator size="large" color={colors.text} />;
    }

    if (!leg) {
      return <Text style={theme.subtitle}>No train data available.</Text>;
    }

    return (
      <View style={styles.contentContainer}>
        <View style={styles.leftColumn}>
          <Text style={theme.label}>Train</Text>
          <Text style={styles.trainName}>{leg.line?.name ?? 'N/A'}</Text>
          <Text style={theme.label}>Platform</Text>
          <Text style={styles.platform}>{leg.departurePlatform ?? '-'}</Text>
          {transferCount > 0 && (
            <>
              <Text style={theme.label}>Transfers</Text>
              <Text style={styles.platform}>{transferCount}</Text>
            </>
          )}
        </View>
        <View style={styles.rightColumn}>
          <Text style={theme.label}>Departure</Text>
          <Text style={styles.departureTime}>
            {format(parseISO(leg.plannedDeparture), 'HH:mm')}
          </Text>
          <Text style={[styles.delay, delayInMinutes > 0 ? styles.delayed : styles.onTime]}>
            {delayInMinutes > 0 ? `+${delayInMinutes} min` : 'On Time'}
          </Text>
          {lastLeg && (
            <>
              <Text style={[theme.label, { marginTop: 10 }]}>Arrival</Text>
              <Text style={styles.arrivalTime}>
                {format(parseISO(lastLeg.plannedArrival), 'HH:mm')}
              </Text>
            </>
          )}
          {durationMinutes && (
            <Text style={styles.durationText}>
              {Math.floor(durationMinutes / 60)}h {durationMinutes % 60}min
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={theme.panel}>
      <View style={styles.header}>
        <Text style={theme.subtitle}>Current Status</Text>
        <TouchableOpacity onPress={onRefresh} disabled={isLoading}>
          <Text style={styles.refreshText}>{isLoading ? 'Checking...' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>
      {renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  refreshText: {
    color: colors.accent, // Now white
    fontSize: 16,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  leftColumn: {
    alignItems: 'flex-start',
  },
  rightColumn: {
    alignItems: 'flex-end',
  },
  trainName: {
    ...theme.body,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  platform: {
    ...theme.body,
    fontSize: 20,
    fontWeight: 'bold',
  },
  departureTime: {
    ...theme.body,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  delay: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  delayed: {
    color: colors.error, // Use system red for errors
  },
  onTime: {
    color: colors.success, // Use system green for success
  },
  arrivalTime: {
    ...theme.body,
    fontSize: 20,
    fontWeight: 'bold',
  },
  durationText: {
    ...theme.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 5,
  },
});
