import { set, isPast, addDays, getDay } from 'date-fns';
import type { WeekSettings, Commute } from '../types/SettingsTypes';

interface NextCommute {
  commuteDate: Date;
  settings: Commute;
}

/**
 * Finds the very next active commute from a set of weekly settings.
 * @param weekSettings The object containing arrays of commutes for all days.
 * @returns An object with the next commute's date and settings, or null if none are found.
 */
export const findNextActiveCommute = (weekSettings: WeekSettings): NextCommute | null => {
  const now = new Date();
  const currentDayIndex = getDay(now); // 0=Sun, 1=Mon, ...

  // Check the next 7 days starting from today
  for (let i = 0; i < 7; i++) {
    const dayToCheckIndex = (currentDayIndex + i) % 7 as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const dayCommutes = weekSettings[dayToCheckIndex] || [];

    // Iterate through all commutes for this day
    for (const commute of dayCommutes) {
      if (commute && commute.enabled) {
        const [hours, minutes] = commute.arrivalTime.split(':').map(Number);

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
          continue; // This commute time for today has already passed, check the next one.
        }

        // We found the next valid, enabled commute.
        return {
          commuteDate: potentialCommuteDate,
          settings: commute,
        };
      }
    }
  }

  // No enabled commute found in the next 7 days
  return null;
};
