// A single commute setting
export interface Commute {
  id: string;
  name: string;
  enabled: boolean;
  startStation: { id: string; name: string } | null;
  destinationStation: { id: string; name: string } | null;
  arrivalTime: string; // "HH:mm"
  preparationTime: number; // in minutes
  safetyBuffer: number; // in minutes - extra buffer for train delays (default 10)

  // Recurring settings
  isRecurring: boolean; // true = repeats weekly, false = one-time commute
  oneTimeDate?: string; // ISO date string for one-time commutes (e.g., "2025-12-29")
}

// Legacy type for backwards compatibility
export interface DaySetting {
  enabled: boolean;
  startStation: { id: string; name: string } | null;
  destinationStation: { id: string; name: string } | null;
  arrivalTime: string; // "HH:mm"
  preparationTime: number; // in minutes
}

// An object containing an array of commutes for each day of the week
// The key is the day index, where Sunday is 0, Monday is 1, etc.
export type WeekSettings = {
  [day in 0 | 1 | 2 | 3 | 4 | 5 | 6]: Commute[];
};
