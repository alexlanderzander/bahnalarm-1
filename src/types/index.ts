/**
 * App Types Template
 *
 * TODO: Define your app's data types here
 */

// ============================================
// TODO: Define your main data types
// ============================================

export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface AppSettings {
  notificationsEnabled: boolean;
  darkMode: boolean;
  // Add more settings as needed
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  totalPages: number;
  totalItems: number;
}

// ============================================
// Navigation Types
// ============================================

export type RootTabParamList = {
  Home: undefined;
  Settings: undefined;
  // Add more screens as needed
};

// ============================================
// Common Utility Types
// ============================================

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
