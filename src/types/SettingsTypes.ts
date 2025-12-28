// A setting for a single day
export interface DaySetting {
  enabled: boolean;
  startStation: { id: string; name: string } | null;
  destinationStation: { id: string; name: string } | null;
  arrivalTime: string; // "HH:mm"
  preparationTime: number; // in minutes
}

// An object containing settings for all 7 days of the week
// The key is the day index, where Sunday is 0, Monday is 1, etc.
export type WeekSettings = {
  [day in 0 | 1 | 2 | 3 | 4 | 5 | 6]?: DaySetting;
};