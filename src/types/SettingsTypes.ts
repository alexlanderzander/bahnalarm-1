/**
 * Commute Settings Types - v2 (Apple Clock style)
 *
 * Commutes can now span multiple days and include "next week" awareness.
 */

// Station reference stored with commute
export interface Station {
  id: string;
  name: string;
}

// A single commute/alarm setting
export interface Commute {
  id: string;
  name: string;
  enabled: boolean;

  // Multi-day selection (0=Sun, 1=Mon, ..., 6=Sat)
  // Empty array means one-time commute using oneTimeDate
  days: number[];

  // Route
  startStation: Station | null;
  destinationStation: Station | null;

  // Timing
  arrivalTime: string; // "HH:mm"
  preparationTime: number; // minutes needed to get ready
  safetyBuffer: number; // extra buffer for delays (default 10)

  // One-time vs recurring
  isRecurring: boolean; // true = weekly on selected days, false = one-time
  oneTimeDate?: string; // ISO date for one-time commutes (e.g., "2025-12-30")
}

// New simplified storage: just an array of commutes
export type CommuteSettings = Commute[];

// Storage key
export const COMMUTE_SETTINGS_KEY = '@NeverBeLate:commutes';

// Legacy types for migration
export interface LegacyCommute {
  id: string;
  name: string;
  enabled: boolean;
  startStation: Station | null;
  destinationStation: Station | null;
  arrivalTime: string;
  preparationTime: number;
  safetyBuffer?: number;
  isRecurring?: boolean;
  oneTimeDate?: string;
}

export type LegacyWeekSettings = {
  [day in 0 | 1 | 2 | 3 | 4 | 5 | 6]: LegacyCommute[];
};

// Default values
export const DEFAULT_SAFETY_BUFFER = 10;
export const DEFAULT_PREP_TIME = 60;

export const createDefaultCommute = (): Commute => ({
  id: '',
  name: 'New Alarm',
  enabled: true,
  days: [1, 2, 3, 4, 5], // Mon-Fri by default
  startStation: null,
  destinationStation: null,
  arrivalTime: '09:00',
  preparationTime: DEFAULT_PREP_TIME,
  safetyBuffer: DEFAULT_SAFETY_BUFFER,
  isRecurring: true,
});

/**
 * Migrate legacy WeekSettings to new CommuteSettings format
 */
export const migrateFromLegacy = (weekSettings: LegacyWeekSettings): CommuteSettings => {
  const commutesMap = new Map<string, Commute>();

  // Process each day
  for (let day = 0; day < 7; day++) {
    const dayCommutes = weekSettings[day as 0 | 1 | 2 | 3 | 4 | 5 | 6] || [];

    for (const legacyCommute of dayCommutes) {
      if (!legacyCommute || !legacyCommute.id) continue;

      // Check if we've seen this commute (by name + stations + time)
      const key = `${legacyCommute.name}-${legacyCommute.startStation?.id}-${legacyCommute.destinationStation?.id}-${legacyCommute.arrivalTime}`;

      if (commutesMap.has(key)) {
        // Add this day to existing commute
        const existing = commutesMap.get(key)!;
        if (!existing.days.includes(day)) {
          existing.days.push(day);
        }
      } else {
        // Create new commute
        const newCommute: Commute = {
          id: legacyCommute.id,
          name: legacyCommute.name,
          enabled: legacyCommute.enabled,
          days: [day],
          startStation: legacyCommute.startStation,
          destinationStation: legacyCommute.destinationStation,
          arrivalTime: legacyCommute.arrivalTime,
          preparationTime: legacyCommute.preparationTime,
          safetyBuffer: legacyCommute.safetyBuffer ?? DEFAULT_SAFETY_BUFFER,
          isRecurring: true,
        };
        commutesMap.set(key, newCommute);
      }
    }
  }

  // Convert to array and sort days
  return Array.from(commutesMap.values()).map(c => ({
    ...c,
    days: c.days.sort((a, b) => a - b),
  }));
};

/**
 * Format days array for display (e.g., "Mon Tue Wed Thu Fri" or "Every day")
 */
export const formatDays = (days: number[]): string => {
  if (days.length === 0) return 'One-time';
  if (days.length === 7) return 'Every day';
  if (arraysEqual(days.sort(), [1, 2, 3, 4, 5])) return 'Weekdays';
  if (arraysEqual(days.sort(), [0, 6])) return 'Weekends';

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.sort((a, b) => a - b).map(d => dayNames[d]).join(' ');
};

const arraysEqual = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
};
