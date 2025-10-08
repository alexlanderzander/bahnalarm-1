
import { set, isPast, addDays, formatISO } from 'date-fns';

/**
 * Calculates the next occurrence of a given commute time.
 * If the time is in the future today, it returns today's date with that time.
 * If the time is in the past today, it returns tomorrow's date with that time.
 * @param departureTimeString A string representing the time, e.g., "08:00"
 * @returns An ISO 8601 string of the next commute date and time.
 */
export const getNextArrivalDateTime = (arrivalTimeString: string): string => {
  const now = new Date();
  const [hours, minutes] = arrivalTimeString.split(':').map(Number);

  let nextCommuteDate = set(now, { hours, minutes, seconds: 0, milliseconds: 0 });

  // If the calculated time for today is already in the past, set it for tomorrow
  if (isPast(nextCommuteDate)) {
    nextCommuteDate = addDays(nextCommuteDate, 1);
  }

  return formatISO(nextCommuteDate);
};
