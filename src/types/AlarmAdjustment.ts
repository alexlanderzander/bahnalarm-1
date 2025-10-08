
export interface AlarmAdjustment {
  id: string;
  timestamp: string; // ISO 8601 date-time
  oldAlarmTime: string; // ISO 8601 date-time
  newAlarmTime: string; // ISO 8601 date-time
  delayInMinutes: number;
}
