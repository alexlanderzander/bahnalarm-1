/**
 * Generic API Service Template
 *
 * TODO: Customize this for your app's API
 */

import { logger } from '../utils/logger';

const log = logger.api;

// TODO: Replace with your API base URL
const API_BASE_URL = 'https://api.example.com';

// TODO: Add your API key if needed
const API_KEY = '';

interface ApiConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
}

const config: ApiConfig = {
  baseUrl: API_BASE_URL,
  timeout: 10000,
  retries: 2,
};

/**
 * Generic fetch with retry logic
 */
async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  retries = config.retries
): Promise<T> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (retries > 0) {
      log.warn(`Retrying request to ${url}, ${retries} attempts left`);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
      return fetchWithRetry<T>(url, options, retries - 1);
    }
    throw error;
  }
}

/**
 * API Service
 */
export const api = {
  async get<T>(endpoint: string): Promise<T> {
    const url = `${config.baseUrl}${endpoint}`;
    log.debug(`GET ${url}`);
    return fetchWithRetry<T>(url);
  },

  async post<T>(endpoint: string, data: unknown): Promise<T> {
    const url = `${config.baseUrl}${endpoint}`;
    log.debug(`POST ${url}`);
    return fetchWithRetry<T>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async put<T>(endpoint: string, data: unknown): Promise<T> {
    const url = `${config.baseUrl}${endpoint}`;
    log.debug(`PUT ${url}`);
    return fetchWithRetry<T>(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete<T>(endpoint: string): Promise<T> {
    const url = `${config.baseUrl}${endpoint}`;
    log.debug(`DELETE ${url}`);
    return fetchWithRetry<T>(url, {
      method: 'DELETE',
    });
  },
};

// Simple in-memory cache
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export const cachedApi = {
  async get<T>(endpoint: string, bypassCache = false): Promise<T> {
    const cached = cache.get(endpoint);

    if (!bypassCache && cached && Date.now() - cached.timestamp < CACHE_TTL) {
      log.debug(`Cache hit: ${endpoint}`);
      return cached.data as T;
    }

    const data = await api.get<T>(endpoint);
    cache.set(endpoint, { data, timestamp: Date.now() });
    return data;
  },

  clearCache(): void {
    cache.clear();
    log.debug('API cache cleared');
  },
};

export default api;
