import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { format, parseISO } from 'date-fns';
import { theme, colors } from '../styles/styles';
import type { AlarmAdjustment } from '../types/AlarmAdjustment';

interface AdjustmentHistoryProps {
  history: AlarmAdjustment[];
}

const HistoryItem: React.FC<{ item: AlarmAdjustment }> = ({ item }) => (
  <View style={styles.itemContainer}>
    <View style={styles.timeChangeContainer}>
      <Text style={styles.timeText}>{format(parseISO(item.oldAlarmTime), 'HH:mm')}</Text>
      <Text style={styles.arrowText}> → </Text>
      <Text style={[styles.timeText, styles.newTime]}>{format(parseISO(item.newAlarmTime), 'HH:mm')}</Text>
    </View>
    <View style={styles.reasonContainer}>
      <Text style={styles.reasonText}>
        Triggered by a {item.delayInMinutes} min delay.
      </Text>
      <Text style={styles.timestampText}>
        {format(parseISO(item.timestamp), 'MMM d, HH:mm')}
      </Text>
    </View>
  </View>
);

export const AdjustmentHistory: React.FC<AdjustmentHistoryProps> = ({ history }) => {
  return (
    <View style={[theme.panel, styles.container]}>
      <Text style={theme.subtitle}>Adjustment History</Text>
      {history.length > 0 ? (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <HistoryItem item={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <Text style={styles.emptyText}>No adjustments have been made yet.</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 20,
  },
  itemContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  timeChangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    ...theme.body,
    fontSize: 18,
    color: colors.textMuted,
  },
  newTime: {
    color: colors.text,
    fontWeight: 'bold',
  },
  arrowText: {
    ...theme.body,
    fontSize: 18,
    color: colors.text,
    marginHorizontal: 5,
  },
  reasonContainer: {
    alignItems: 'flex-end',
  },
  reasonText: {
    ...theme.body,
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  timestampText: {
    ...theme.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  emptyText: {
    ...theme.body,
    textAlign: 'center',
    marginTop: 20,
    color: colors.textMuted,
  },
});