import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Modal, FlatList, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme, colors } from '../styles/styles';
import { DaySettingForm } from '../components/TrainConnectionForm';
import { findNextActiveCommute } from '../utils/timeHelper';
import { selectOptimalJourney, getFirstLeg, DEFAULT_SAFETY_BUFFER } from '../utils/journeySelection';
import { findJourneyByArrival } from '../api/DbApiService';
import { scheduleAlarmNotification } from '../services/BackgroundUpdateService';
import { scheduleAlarm as scheduleNativeAlarm, isAlarmKitAvailable } from '../services/AlarmKitService';
import { logger } from '../utils/logger';
import type { WeekSettings, Commute } from '../types/SettingsTypes';

const log = logger.settings;

const WEEK_SETTINGS_KEY = '@BahnAlarm:weekSettings';
const ALARM_TIME_KEY = '@BahnAlarm:alarmTime';
const ADJUSTMENT_HISTORY_KEY = '@BahnAlarm:adjustmentHistory';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const defaultWeekSettings: WeekSettings = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

const defaultCommute: Commute = {
  id: '', name: 'New Commute', enabled: true,
  startStation: null, destinationStation: null,
  arrivalTime: '09:00', preparationTime: 75,
  safetyBuffer: DEFAULT_SAFETY_BUFFER,
  isRecurring: true, // Default to weekly recurring
};

type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface Props {
  navigation: NativeStackNavigationProp<any>;
}

export const SettingsScreen = ({ navigation }: Props) => {
  const [weekSettings, setWeekSettings] = useState<WeekSettings>(defaultWeekSettings);
  const [selectedDay, setSelectedDay] = useState<DayIndex>(new Date().getDay() as DayIndex);
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingCommute, setEditingCommute] = useState<Commute | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    const loadSettings = async () => {
      setIsLoading(true);
      const settingsString = await AsyncStorage.getItem(WEEK_SETTINGS_KEY);
      let newWeekSettings = { ...defaultWeekSettings };
      if (settingsString) {
        try {
          const storedData = JSON.parse(settingsString);
          if (storedData && typeof storedData === 'object') {
            for (let i = 0; i < 7; i++) {
              const dayIndex = i as 0 | 1 | 2 | 3 | 4 | 5 | 6;
              const dayData = storedData[String(i)];
              if (dayData) {
                if (Array.isArray(dayData)) {
                  newWeekSettings[dayIndex] = dayData.map(item => ({ ...defaultCommute, ...item, id: item.id || uuidv4() }));
                } else if (typeof dayData === 'object') {
                  // Migrate old single-commute format
                  newWeekSettings[dayIndex] = [{ ...defaultCommute, ...dayData, id: dayData.id || uuidv4() }];
                }
              }
            }
          }
        } catch (e) { log.error('Failed to parse settings:', e); }
      }
      setWeekSettings(newWeekSettings);
      setIsLoading(false);
    };
    loadSettings();
  }, []));

  const handleAddNew = () => {
    const newCommute: Commute = { ...defaultCommute, id: uuidv4() };
    setEditingCommute(newCommute);
    setModalVisible(true);
  };

  const handleEdit = (commute: Commute) => {
    setEditingCommute({ ...defaultCommute, ...commute });
    setModalVisible(true);
  };

  const handleUpdateInModal = (updatedData: Partial<Commute>) => {
    setEditingCommute(prev => prev ? { ...prev, ...updatedData } : null);
  };

  const handleSaveFromModal = async () => {
    if (!editingCommute) return;

    setWeekSettings(prevWeekSettings => {
      const dayCommutes = [...(prevWeekSettings[selectedDay] || [])];
      const existingIndex = dayCommutes.findIndex(c => c.id === editingCommute.id);

      if (existingIndex > -1) {
        dayCommutes[existingIndex] = editingCommute;
      } else {
        dayCommutes.push(editingCommute);
      }

      const updatedWeekSettings = { ...prevWeekSettings, [selectedDay]: dayCommutes };
      AsyncStorage.setItem(WEEK_SETTINGS_KEY, JSON.stringify(updatedWeekSettings));
      return updatedWeekSettings;
    });

    setModalVisible(false);
    setEditingCommute(null);
  };

  const handleDeleteCommute = async () => {
    if (!editingCommute || !editingCommute.id) return;

    Alert.alert(
      "Delete Commute",
      `Are you sure you want to delete "${editingCommute.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            setWeekSettings(prevWeekSettings => {
              const updatedDayCommutes = (prevWeekSettings[selectedDay] || []).filter(
                c => c.id !== editingCommute.id
              );
              const updatedWeekSettings = { ...prevWeekSettings, [selectedDay]: updatedDayCommutes };
              AsyncStorage.setItem(WEEK_SETTINGS_KEY, JSON.stringify(updatedWeekSettings));
              return updatedWeekSettings;
            });
            setModalVisible(false);
            setEditingCommute(null);
          }
        }
      ]
    );
  };

  const handleSaveAll = async () => {
    try {
      await AsyncStorage.setItem(WEEK_SETTINGS_KEY, JSON.stringify(weekSettings));

      const nextCommute = findNextActiveCommute(weekSettings);
      if (nextCommute) {
        if (nextCommute.settings.startStation && nextCommute.settings.destinationStation) {
          log.debug(`Saving settings for ${nextCommute.settings.name}`);
          const journeyResponse = await findJourneyByArrival(
            nextCommute.settings.startStation.id,
            nextCommute.settings.destinationStation.id,
            formatISO(nextCommute.commuteDate)
          );

          const safetyBuffer = nextCommute.settings.safetyBuffer ?? DEFAULT_SAFETY_BUFFER;
          const selection = selectOptimalJourney(
            journeyResponse.journeys,
            nextCommute.commuteDate,
            nextCommute.settings.preparationTime,
            safetyBuffer
          );

          const leg = getFirstLeg(selection.journey);
          if (leg && selection.alarmTime) {
            log.debug(`Selected: ${selection.reasoning}`);
            await AsyncStorage.setItem(ALARM_TIME_KEY, formatISO(selection.alarmTime));

            await scheduleAlarmNotification(selection.alarmTime, leg);

            const alarmKitAvailable = await isAlarmKitAvailable();
            if (alarmKitAvailable) {
              const trainName = leg.line?.name ?? 'Your train';
              const delaySeconds = leg.departureDelay ?? 0;
              const delayInfo = delaySeconds > 0 ? `+${Math.round(delaySeconds / 60)}min delay` : 'On time';
              await scheduleNativeAlarm(selection.alarmTime, `Time for ${trainName}`, delayInfo);
            }
          }
        }
      }

      // FIX: Don't clear history on save - preserve adjustment history
      // await AsyncStorage.setItem(ADJUSTMENT_HISTORY_KEY, JSON.stringify([]));

      Alert.alert('Settings Saved', 'Your weekly commute settings have been saved.');
      navigation.goBack();

    } catch (error) {
      console.error('[SettingsScreen] Error saving settings:', error);
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      console.log("[SETTINGS DEBUG] handleSaveAll finished.");
      console.log("----------------------------------------");
    }
  };

  return (
    <SafeAreaView style={theme.container} edges={['top', 'bottom']}>
      <View style={styles.daySelectorContainer}>
        {DAYS.map((day, index) => (
          <TouchableOpacity key={index} style={[styles.dayButton, selectedDay === index && styles.dayButtonSelected]} onPress={() => setSelectedDay(index as DayIndex)}>
            <Text style={[styles.dayText, selectedDay === index && styles.dayTextSelected]}>{day}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!isLoading && (
        <FlatList
          data={weekSettings[selectedDay] || []}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.commuteItem} onPress={() => handleEdit(item)}>
              <Text style={styles.commuteName}>{item.name}</Text>
              <Text style={styles.commuteTime}>{item.arrivalTime}</Text>
            </TouchableOpacity>
          )}
          ListFooterComponent={() => (
            <TouchableOpacity style={styles.addButton} onPress={handleAddNew}>
              <Text style={styles.addButtonText}>+ Add New Commute for {DAYS[selectedDay]}</Text>
            </TouchableOpacity>
          )}
          style={{ flex: 1 }}
        />
      )}

      <Modal visible={isModalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={theme.container} edges={['top', 'bottom']}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
            <ScrollView>
              {editingCommute && <DaySettingForm commute={editingCommute} onUpdate={handleUpdateInModal} />}
            </ScrollView>
            <View style={styles.modalActions}>
              {editingCommute && editingCommute.id && (
                <TouchableOpacity style={[styles.deleteButton]} onPress={handleDeleteCommute}>
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[theme.button, styles.doneButton]} onPress={handleSaveFromModal}>
                <Text style={theme.buttonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <TouchableOpacity style={[theme.button, styles.saveButton]} onPress={handleSaveAll}>
        <Text style={theme.buttonText}>Save All Settings</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  daySelectorContainer: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20, paddingHorizontal: 10 },
  dayButton: { padding: 10, borderRadius: 8 },
  dayButtonSelected: { backgroundColor: colors.panel },
  dayText: { color: colors.textMuted, fontSize: 16 },
  dayTextSelected: { color: colors.text, fontWeight: 'bold' },
  commuteItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.panel, padding: 20, borderRadius: 10, marginBottom: 10 },
  commuteName: { color: colors.text, fontSize: 18, fontWeight: '600' },
  commuteTime: { color: colors.textMuted, fontSize: 18 },
  addButton: { backgroundColor: colors.panel, borderRadius: 10, padding: 20, alignItems: 'center', marginTop: 10 },
  addButtonText: { color: colors.success, fontSize: 18, fontWeight: '600' },
  saveButton: { marginHorizontal: 20, marginBottom: 10 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-around', margin: 20, alignItems: 'center' },
  doneButton: { flex: 1, marginLeft: 10 },
  cancelButton: { flex: 1, marginRight: 10, alignItems: 'center' },
  cancelText: { color: colors.textMuted, fontSize: 18, fontWeight: '600' },
  deleteButton: { flex: 1, marginRight: 10, alignItems: 'center' },
  deleteButtonText: { color: colors.error, fontSize: 18, fontWeight: '600' },
});
