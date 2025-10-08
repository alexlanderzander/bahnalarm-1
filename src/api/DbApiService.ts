import type { JourneysResponse, Location } from '../types/ApiTypes';

const API_BASE_URL = 'https://v6.db.transport.rest';

/**
 * Searches for locations (stations) based on a query string.
 */
export const searchStations = async (query: string): Promise<Location[]> => {
  if (!query) return [];

  const url = new URL(`${API_BASE_URL}/locations`);
  url.searchParams.append('query', query);
  url.searchParams.append('results', '5');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data: Location[] = await response.json();
    return data.filter(item => item.type === 'stop' || item.type === 'station');
  } catch (error) {
    console.error('[DbApiService] Failed to search stations:', error);
    throw new Error('Failed to fetch station data.');
  }
};

/**
 * Finds journeys between two stations, arriving by a specific time.
 */
export const findJourneyByArrival = async (
  fromId: string,
  toId: string,
  arrival: string, // ISO 8601 string for desired arrival time
): Promise<JourneysResponse> => {
  const url = new URL(`${API_BASE_URL}/journeys`);
  url.searchParams.append('from', fromId);
  url.searchParams.append('to', toId);
  url.searchParams.append('arrival', arrival); // Use the arrival time
  url.searchParams.append('results', '1');     // Get the latest journey arriving at or before the time

  try {
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data: JourneysResponse = await response.json();
    return data;
  } catch (error) {
    console.error('[DbApiService] Failed to find journey:', error);
    throw new Error('Failed to fetch journey data.');
  }
};