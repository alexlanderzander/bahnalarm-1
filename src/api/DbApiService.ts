
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
  url.searchParams.append('arrival', arrival);
  url.searchParams.append('results', '1');

  // --- START DEBUG LOGGING ---
  console.log("----------------------------------------");
  console.log("[API DEBUG] Calling findJourneyByArrival with:");
  console.log("[API DEBUG]   fromId:", fromId);
  console.log("[API DEBUG]   toId:", toId);
  console.log("[API DEBUG]   arrival:", arrival);
  console.log("[API DEBUG]   Full URL:", url.toString());
  // --- END DEBUG LOGGING ---

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API DEBUG] API error response: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    const data: JourneysResponse = await response.json();
    // --- START DEBUG LOGGING ---
    console.log("[API DEBUG] API response data:", JSON.stringify(data, null, 2));
    console.log("----------------------------------------");
    // --- END DEBUG LOGGING ---
    return data;
  } catch (error) {
    console.error('[DbApiService] Failed to find journey:', error);
    throw new Error('Failed to fetch journey data.');
  }
};
