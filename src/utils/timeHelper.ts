import { set, isPast, addDays, formatISO, getDay } from 'date-fns';
import type { WeekSettings, DaySetting } from './SettingsTypes';

interface NextCommute {
  commuteDate: Date;
  settings: DaySetting;
}

/**
 * Finds the very next active commute from a set of weekly settings.
 * @param weekSettings The object containing settings for all days.
 * @returns An object with the next commute's date and settings, or null if none are found.
 */
export const findNextActiveCommute = (weekSettings: WeekSettings): NextCommute | null => {
  const now = new Date();
  const currentDayIndex = getDay(now); // 0=Sun, 1=Mon, ...

  // Check the next 7 days starting from today
  for (let i = 0; i < 7; i++) {
    const dayToCheckIndex = (currentDayIndex + i) % 7;
    const daySetting = weekSettings[dayToCheckIndex];

    if (daySetting && daySetting.enabled) {
      const [hours, minutes] = daySetting.arrivalTime.split(':').map(Number);
      
      // Calculate the potential commute date
      const potentialCommuteDate = set(addDays(now, i), {
        hours,
        minutes,
        seconds: 0,
        milliseconds: 0,
      });

      // If we are checking today (i=0), we must ensure the time has not already passed.
      // For any future day (i>0), the time is always valid.
      if (i === 0 && isPast(potentialCommuteDate)) {
        continue; // This commute time for today has already passed, check the next day.
      }

      // We found the next valid, enabled commute.
      return {
        commuteDate: potentialCommuteDate,
        settings: daySetting,
      };
    }
  }

  // No enabled commute found in the next 7 days
  return null;
};