
// Based on the v6.db.transport.rest API documentation

export interface Location {
  type: 'location' | 'stop' | 'station';
  id: string;
  name: string;
}

export interface Stop {
  type: 'stop' | 'location';
  id: string;
  name: string;
  location: {
    latitude: number;
    longitude: number;
  };
}

export interface Line {
  type: 'line';
  id: string;
  fahsName: string;
  name: string;
  mode: 'train' | string;
  product: 'regional' | 'suburban' | 'national' | string;
}

export interface Journey {
  type: 'journey';
  legs: Leg[];
}

export interface Leg {
  origin: Stop;
  destination: Stop;

  departure: string; // ISO 8601 date-time
  plannedDeparture: string; // ISO 8601 date-time
  departureDelay: number | null; // in seconds
  departurePlatform?: string;

  arrival: string; // ISO 8601 date-time
  plannedArrival: string; // ISO 8601 date-time
  arrivalDelay: number | null; // in seconds
  arrivalPlatform?: string;

  line?: Line;
  reachable: boolean;
  tripId: string;
}

// The API response for /journeys is an object with a 'journeys' array
export interface JourneysResponse {
  journeys: Journey[];
  realtimeDataUpdatedAt: number;
}
