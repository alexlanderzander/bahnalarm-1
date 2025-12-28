import { set, isPast, addDays, getDay, isToday, isTomorrow, format } from 'date-fns';
import type { Commute, CommuteSettings } from '../types/SettingsTypes';

interface NextCommute {
  commuteDate: Date;
  commute: Commute;
  isNextWeek: boolean; // True if alarm is for next occurrence of this day
}

/**
 * Finds the next active commute from the settings.
 * Returns null if no enabled commutes exist.
 */
export const findNextActiveCommute = (commutes: CommuteSettings): NextCommute | null => {
  if (!commutes || commutes.length === 0) return null;

  const now = new Date();
  const currentDayIndex = getDay(now); // 0=Sun, 1=Mon, ...

  let bestCandidate: NextCommute | null = null;

  for (const commute of commutes) {
    if (!commute.enabled) continue;

    // Handle one-time commutes
    if (!commute.isRecurring && commute.oneTimeDate) {
      const [hours, minutes] = commute.arrivalTime.split(':').map(Number);
      const oneTimeDate = new Date(commute.oneTimeDate);
      const commuteDate = set(oneTimeDate, { hours, minutes, seconds: 0, milliseconds: 0 });

      // Skip if already passed
      if (isPast(commuteDate)) continue;

      if (!bestCandidate || commuteDate < bestCandidate.commuteDate) {
        bestCandidate = { commuteDate, commute, isNextWeek: false };
      }
      continue;
    }

    // Handle recurring commutes
    if (commute.days.length === 0) continue;

    // Check each day up to 7 days ahead
    for (let i = 0; i < 7; i++) {
      const dayToCheck = (currentDayIndex + i) % 7;

      if (!commute.days.includes(dayToCheck)) continue;

      const [hours, minutes] = commute.arrivalTime.split(':').map(Number);
      const commuteDate = set(addDays(now, i), {
        hours,
        minutes,
        seconds: 0,
        milliseconds: 0,
      });

      // Skip if today and already passed
      if (i === 0 && isPast(commuteDate)) {
        // This day's time passed, but we might find it next week
        continue;
      }

      const isNextWeek = i >= 7; // Would be true if we had to wrap around

      if (!bestCandidate || commuteDate < bestCandidate.commuteDate) {
        bestCandidate = { commuteDate, commute, isNextWeek };
      }

      break; // Found earliest day for this commute
    }
  }

  return bestCandidate;
};

/**
 * Check if a commute's alarm time for today has already passed.
 * Returns info about when it will next trigger.
 */
export const getNextOccurrence = (commute: Commute): { date: Date; isNextWeek: boolean } | null => {
  if (!commute.enabled) return null;

  const now = new Date();
  const currentDayIndex = getDay(now);
  const [hours, minutes] = commute.arrivalTime.split(':').map(Number);

  // One-time commute
  if (!commute.isRecurring && commute.oneTimeDate) {
    const oneTimeDate = new Date(commute.oneTimeDate);
    const date = set(oneTimeDate, { hours, minutes, seconds: 0, milliseconds: 0 });
    return isPast(date) ? null : { date, isNextWeek: false };
  }

  // Recurring commute - find next occurrence
  for (let i = 0; i < 14; i++) { // Check up to 2 weeks
    const dayToCheck = (currentDayIndex + i) % 7;

    if (!commute.days.includes(dayToCheck)) continue;

    const date = set(addDays(now, i), { hours, minutes, seconds: 0, milliseconds: 0 });

    if (isPast(date)) continue;

    return { date, isNextWeek: i >= 7 };
  }

  return null;
};

/**
 * Format the next occurrence for display
 */
export const formatNextOccurrence = (commute: Commute): string => {
  const next = getNextOccurrence(commute);
  if (!next) return 'No upcoming alarm';

  if (isToday(next.date)) {
    return `Today at ${format(next.date, 'HH:mm')}`;
  }

  if (isTomorrow(next.date)) {
    return `Tomorrow at ${format(next.date, 'HH:mm')}`;
  }

  if (next.isNextWeek) {
    return `Next ${format(next.date, 'EEEE')} at ${format(next.date, 'HH:mm')}`;
  }

  return `${format(next.date, 'EEEE')} at ${format(next.date, 'HH:mm')}`;
};

/**
 * Check if creating a commute for today would result in a "next week" alarm
 */
export const wouldBeNextWeek = (arrivalTime: string, days: number[]): boolean => {
  const now = new Date();
  const currentDayIndex = getDay(now);
  const [hours, minutes] = arrivalTime.split(':').map(Number);

  // Check if today is in the selected days
  if (!days.includes(currentDayIndex)) return false;

  // Check if today's time has passed
  const todayCommute = set(now, { hours, minutes, seconds: 0, milliseconds: 0 });
  return isPast(todayCommute);
};
