
export interface UserSettings {
  startStation: { id: string; name: string };
  destinationStation: { id: string; name: string };
  arrivalTime: string; // "HH:mm"
  preparationTime: number; // in minutes
}
