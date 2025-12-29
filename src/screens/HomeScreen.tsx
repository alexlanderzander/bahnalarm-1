/**
 * Home Screen Template
 *
 * Main dashboard with loading, error, empty, and content states.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../styles/styles';
import { logger } from '../utils/logger';
import { EmptyState } from '../components/EmptyState';
import ErrorBoundary from '../components/ErrorBoundary';

const log = logger.dashboard;

// TODO: Import and define your data types
interface DataItem {
  id: string;
  title: string;
  subtitle?: string;
}

export default function HomeScreen(): React.JSX.Element {
  const [data, setData] = useState<DataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);

      // TODO: Replace with your data fetching logic
      // const response = await api.get<DataItem[]>('/items');
      // setData(response);

      // Placeholder data
      setData([
        { id: '1', title: 'Item 1', subtitle: 'Description' },
        { id: '2', title: 'Item 2', subtitle: 'Description' },
      ]);

      log.debug('Data loaded successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      log.error('Failed to load data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>⚠️ {error}</Text>
        <Text style={styles.retryText} onPress={loadData}>
          Tap to retry
        </Text>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        emoji="📱"
        title="No Data Yet"
        message="Add your first item to get started"
        actionLabel="Add Item"
        onAction={() => {
          // TODO: Navigate to add screen
        }}
      />
    );
  }

  return (
    <ErrorBoundary>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {data.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            {item.subtitle && (
              <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: 16,
  },
  errorText: {
    color: colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryText: {
    color: colors.accent,
    fontSize: 14,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
});
