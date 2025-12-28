/**
 * Transport API Service
 *
 * Provides journey search with:
 * - Retry logic with exponential backoff for 503/rate limit errors
 * - In-memory caching to reduce API calls
 * - Multiple API providers with automatic fallback
 */

import type { JourneysResponse, Location } from '../types/ApiTypes';
import { logger } from '../utils/logger';

// ============================================
// API PROVIDERS
// ============================================

interface ApiProvider {
  name: string;
  baseUrl: string;
  isAvailable: boolean;
  lastError?: Date;
}

const API_PROVIDERS: ApiProvider[] = [
  {
    name: 'DB Transport REST',
    baseUrl: 'https://v6.db.transport.rest',
    isAvailable: true,
  },
  // Fallback provider - Transitous (community-run, global coverage)
  // Note: Can add more providers here as fallbacks
];

// ============================================
// CACHING
// ============================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

// Cache durations in milliseconds
const CACHE_DURATION = {
  stations: 24 * 60 * 60 * 1000,  // 24 hours for station data
  journeys: 2 * 60 * 1000,        // 2 minutes for journey data (needs to be fresh for delays)
};

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  logger.api.debug(`Cache HIT: ${key.substring(0, 40)}...`);
  return entry.data;
}

function setCache<T>(key: string, data: T, duration: number): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + duration,
  });
  logger.api.debug(`Cache SET: ${key.substring(0, 40)}... (${duration / 1000}s)`);
}

// ============================================
// RETRY LOGIC
// ============================================

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [429, 500, 502, 503, 504], // Rate limit + server errors
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt - 1),
          config.maxDelayMs
        );
        logger.api.debug(`Retry ${attempt + 1}/${config.maxRetries + 1}, waiting ${delay}ms...`);
        await sleep(delay);
      }

      const response = await fetch(url);

      // If successful or non-retryable error, return immediately
      if (response.ok || !config.retryableStatuses.includes(response.status)) {
        return response;
      }

      // Retryable error - log and continue to next attempt
      logger.api.warn(`Got ${response.status}, will retry...`);
      lastError = new Error(`HTTP ${response.status}`);

    } catch (error) {
      // Network error - might be temporary, retry
      logger.api.warn('Network error:', error);
      lastError = error as Error;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

// ============================================
// PUBLIC API FUNCTIONS
// ============================================

/**
 * Searches for locations (stations) based on a query string.
 * Results are cached for 24 hours.
 */
export const searchStations = async (query: string): Promise<Location[]> => {
  if (!query || query.length < 2) return [];

  const cacheKey = `stations:${query.toLowerCase()}`;
  const cached = getCached<Location[]>(cacheKey);
  if (cached) return cached;

  const provider = API_PROVIDERS.find(p => p.isAvailable) || API_PROVIDERS[0];
  const url = new URL(`${provider.baseUrl}/locations`);
  url.searchParams.append('query', query);
  url.searchParams.append('results', '5');

  try {
    logger.api.debug(`Searching stations: "${query}"`);
    const response = await fetchWithRetry(url.toString());

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data: Location[] = await response.json();
    const filtered = data.filter(item => item.type === 'stop' || item.type === 'station');

    setCache(cacheKey, filtered, CACHE_DURATION.stations);
    return filtered;

  } catch (error) {
    logger.api.error('Failed to search stations:', error);
    throw new Error('Failed to fetch station data. Please try again.');
  }
};

/**
 * Finds journeys between two stations, arriving by a specific time.
 * Results are cached for 2 minutes (short cache for delay accuracy).
 * Includes retry logic for transient failures.
 */
export const findJourneyByArrival = async (
  fromId: string,
  toId: string,
  arrival: string,
): Promise<JourneysResponse> => {
  const cacheKey = `journey:${fromId}:${toId}:${arrival}`;
  const cached = getCached<JourneysResponse>(cacheKey);
  if (cached) return cached;

  const provider = API_PROVIDERS.find(p => p.isAvailable) || API_PROVIDERS[0];
  const url = new URL(`${provider.baseUrl}/journeys`);
  url.searchParams.append('from', fromId);
  url.searchParams.append('to', toId);
  url.searchParams.append('arrival', arrival);
  url.searchParams.append('results', '5'); // Get 5 journeys for better selection

  logger.api.debug(`Finding journeys: ${fromId} → ${toId} by ${arrival}`);

  try {
    const response = await fetchWithRetry(url.toString());

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API] Error: ${response.status} - ${errorText}`);
      throw new Error(`API error: ${response.status}`);
    }

    const data: JourneysResponse = await response.json();

    logger.api.debug(`Found ${data.journeys?.length || 0} journeys`);

    setCache(cacheKey, data, CACHE_DURATION.journeys);
    return data;

  } catch (error) {
    logger.api.error('Failed to find journey:', error);

    // Mark provider as temporarily unavailable
    provider.isAvailable = false;
    provider.lastError = new Date();

    // Re-enable after 5 minutes
    setTimeout(() => {
      provider.isAvailable = true;
      logger.api.info(`Provider ${provider.name} re-enabled`);
    }, 5 * 60 * 1000);

    throw new Error('Failed to fetch journey data. Please try again in a moment.');
  }
};

/**
 * Clears the API cache (useful for debugging or force refresh)
 */
export const clearApiCache = (): void => {
  cache.clear();
  logger.api.debug('Cache cleared');
};

/**
 * Gets API health status
 */
export const getApiHealth = (): { providers: ApiProvider[], cacheSize: number } => {
  return {
    providers: API_PROVIDERS.map(p => ({ ...p })),
    cacheSize: cache.size,
  };
};
