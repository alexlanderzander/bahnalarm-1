import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal,
  FlatList, KeyboardAvoidingView, Platform, ScrollView, Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme, colors } from '../styles/styles';
import { DaySettingForm } from '../components/TrainConnectionForm';
import { formatNextOccurrence, wouldBeNextWeek } from '../utils/timeHelper';
import { logger } from '../utils/logger';
import {
  createDefaultCommute, migrateFromLegacy, formatDays,
  COMMUTE_SETTINGS_KEY, DEFAULT_SAFETY_BUFFER
} from '../types/SettingsTypes';
import type { Commute, CommuteSettings, LegacyWeekSettings } from '../types/SettingsTypes';

const log = logger.settings;

// Legacy key for migration
const LEGACY_WEEK_SETTINGS_KEY = '@BahnAlarm:weekSettings';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Props {
  navigation: NativeStackNavigationProp<any>;
}

export const SettingsScreen = ({ navigation }: Props) => {
  const [commutes, setCommutes] = useState<CommuteSettings>([]);
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingCommute, setEditingCommute] = useState<Commute | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings (with migration from legacy format)
  useFocusEffect(useCallback(() => {
    const loadSettings = async () => {
      setIsLoading(true);

      try {
        // Try new format first
        const newSettingsStr = await AsyncStorage.getItem(COMMUTE_SETTINGS_KEY);
        if (newSettingsStr) {
          setCommutes(JSON.parse(newSettingsStr));
          setIsLoading(false);
          return;
        }

        // Try legacy format and migrate
        const legacyStr = await AsyncStorage.getItem(LEGACY_WEEK_SETTINGS_KEY);
        if (legacyStr) {
          const legacy: LegacyWeekSettings = JSON.parse(legacyStr);
          const migrated = migrateFromLegacy(legacy);
          setCommutes(migrated);
          // Save in new format
          await AsyncStorage.setItem(COMMUTE_SETTINGS_KEY, JSON.stringify(migrated));
          log.debug('Migrated legacy settings to new format');
        }
      } catch (e) {
        log.error('Failed to load settings:', e);
      }

      setIsLoading(false);
    };
    loadSettings();
  }, []));

  const handleAddNew = () => {
    setEditingCommute({
      ...createDefaultCommute(),
      id: uuidv4(),
    });
    setModalVisible(true);
  };

  const handleEdit = (commute: Commute) => {
    setEditingCommute({ ...commute });
    setModalVisible(true);
  };

  const handleToggleEnabled = async (commute: Commute) => {
    const updated = commutes.map(c =>
      c.id === commute.id ? { ...c, enabled: !c.enabled } : c
    );
    setCommutes(updated);
    await AsyncStorage.setItem(COMMUTE_SETTINGS_KEY, JSON.stringify(updated));
  };

  const handleToggleDay = (dayIndex: number) => {
    if (!editingCommute) return;

    const days = [...editingCommute.days];
    const idx = days.indexOf(dayIndex);
    if (idx >= 0) {
      days.splice(idx, 1);
    } else {
      days.push(dayIndex);
      days.sort((a, b) => a - b);
    }

    setEditingCommute({ ...editingCommute, days });
  };

  const handleSaveCommute = async () => {
    if (!editingCommute) return;

    // Validate
    if (!editingCommute.startStation || !editingCommute.destinationStation) {
      Alert.alert('Missing Info', 'Please select both start and destination stations.');
      return;
    }

    if (editingCommute.isRecurring && editingCommute.days.length === 0) {
      Alert.alert('No Days Selected', 'Please select at least one day for the alarm.');
      return;
    }

    // Check for "next week" warning
    if (editingCommute.isRecurring && wouldBeNextWeek(editingCommute.arrivalTime, editingCommute.days)) {
      Alert.alert(
        'Alarm Scheduled for Next Week',
        `Today's time (${editingCommute.arrivalTime}) has already passed. This alarm will first trigger next week.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'OK', onPress: () => saveAndClose() }
        ]
      );
      return;
    }

    saveAndClose();
  };

  const saveAndClose = async () => {
    if (!editingCommute) return;

    const existingIdx = commutes.findIndex(c => c.id === editingCommute.id);
    let updated: CommuteSettings;

    if (existingIdx >= 0) {
      updated = [...commutes];
      updated[existingIdx] = editingCommute;
    } else {
      updated = [...commutes, editingCommute];
    }

    setCommutes(updated);
    await AsyncStorage.setItem(COMMUTE_SETTINGS_KEY, JSON.stringify(updated));

    setModalVisible(false);
    setEditingCommute(null);
  };

  const handleDeleteCommute = async () => {
    if (!editingCommute) return;

    Alert.alert(
      'Delete Alarm',
      `Are you sure you want to delete "${editingCommute.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updated = commutes.filter(c => c.id !== editingCommute.id);
            setCommutes(updated);
            await AsyncStorage.setItem(COMMUTE_SETTINGS_KEY, JSON.stringify(updated));
            setModalVisible(false);
            setEditingCommute(null);
          }
        }
      ]
    );
  };

  const renderCommuteItem = ({ item }: { item: Commute }) => {
    const nextOccurrence = formatNextOccurrence(item);

    return (
      <TouchableOpacity
        style={[styles.commuteCard, !item.enabled && styles.commuteCardDisabled]}
        onPress={() => handleEdit(item)}
      >
        <View style={styles.commuteHeader}>
          <View style={styles.commuteInfo}>
            <Text style={[styles.commuteTime, !item.enabled && styles.textDisabled]}>
              {item.arrivalTime}
            </Text>
            <Text style={[styles.commuteName, !item.enabled && styles.textDisabled]}>
              {item.name}
            </Text>
          </View>
          <Switch
            value={item.enabled}
            onValueChange={() => handleToggleEnabled(item)}
            trackColor={{ false: colors.border, true: colors.success }}
          />
        </View>
        <Text style={styles.commuteDays}>
          {item.isRecurring ? formatDays(item.days) : `One-time`}
        </Text>
        <Text style={styles.commuteRoute}>
          {item.startStation?.name ?? '?'} → {item.destinationStation?.name ?? '?'}
        </Text>
        <Text style={styles.commuteNext}>{nextOccurrence}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={theme.container} edges={['top', 'bottom']}>
      <Text style={styles.screenTitle}>Alarms</Text>

      {isLoading ? (
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : commutes.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>⏰</Text>
          <Text style={styles.emptyTitle}>No Alarms</Text>
          <Text style={styles.emptyMessage}>
            Add an alarm to get smart wake-up times based on train schedules.
          </Text>
        </View>
      ) : (
        <FlatList
          data={commutes}
          keyExtractor={item => item.id}
          renderItem={renderCommuteItem}
          contentContainerStyle={styles.list}
        />
      )}

      <TouchableOpacity style={styles.addButton} onPress={handleAddNew}>
        <Text style={styles.addButtonText}>+ Add Alarm</Text>
      </TouchableOpacity>

      {/* Edit Modal */}
      <Modal visible={isModalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={theme.container} edges={['top', 'bottom']}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.modalTitle}>
                {editingCommute?.id && commutes.find(c => c.id === editingCommute.id) ? 'Edit Alarm' : 'New Alarm'}
              </Text>

              {/* Day Selector */}
              <Text style={styles.sectionLabel}>Repeat</Text>
              <View style={styles.daySelector}>
                {DAYS.map((day, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.dayButton,
                      editingCommute?.days.includes(idx) && styles.dayButtonSelected
                    ]}
                    onPress={() => handleToggleDay(idx)}
                  >
                    <Text style={[
                      styles.dayButtonText,
                      editingCommute?.days.includes(idx) && styles.dayButtonTextSelected
                    ]}>
                      {day}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Next week warning */}
              {editingCommute && wouldBeNextWeek(editingCommute.arrivalTime, editingCommute.days) && (
                <View style={styles.warningBanner}>
                  <Text style={styles.warningText}>
                    ⚠️ Today's time has passed. Alarm will trigger next week.
                  </Text>
                </View>
              )}

              {/* Train Connection Form */}
              {editingCommute && (
                <DaySettingForm
                  commute={editingCommute}
                  onUpdate={(updates) => setEditingCommute(prev => prev ? { ...prev, ...updates } : null)}
                />
              )}
            </ScrollView>

            {/* Actions - Fixed Layout */}
            <View style={styles.modalActions}>
              <View style={styles.actionsLeft}>
                {editingCommute && commutes.find(c => c.id === editingCommute.id) && (
                  <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteCommute}>
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.actionsRight}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={handleSaveCommute}>
                  <Text style={styles.saveButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screenTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 20,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  list: {
    paddingBottom: 20,
  },
  commuteCard: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commuteCardDisabled: {
    opacity: 0.5,
  },
  commuteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  commuteInfo: {
    flex: 1,
  },
  commuteTime: {
    fontSize: 42,
    fontWeight: '300',
    color: colors.text,
    marginBottom: 2,
  },
  commuteName: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  commuteDays: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 4,
  },
  commuteRoute: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 4,
  },
  commuteNext: {
    fontSize: 13,
    color: colors.success,
    fontWeight: '500',
  },
  textDisabled: {
    color: colors.textMuted,
  },
  addButton: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  addButtonText: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '600',
  },

  // Modal styles
  modalContent: {
    padding: 20,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 24,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  daySelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  dayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayButtonSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dayButtonText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '500',
  },
  dayButtonTextSelected: {
    color: colors.accentText,
  },
  warningBanner: {
    backgroundColor: '#FF9500',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  warningText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  deleteButton: {
    backgroundColor: colors.error,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  deleteButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  cancelText: {
    color: colors.accent,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  saveButtonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: '600',
  },
  actionsLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
