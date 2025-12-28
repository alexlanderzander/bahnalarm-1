/**
 * Production-safe logger utility
 *
 * - debug/info: Only logs in development mode
 * - warn/error: Always logs (important for crash reporting)
 */

// React Native provides __DEV__ global
declare const __DEV__: boolean;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
}

const noop = () => { };

/**
 * Creates a prefixed logger for a specific module
 * @param prefix - Module name prefix (e.g., 'API', 'AlarmKit', 'Dashboard')
 */
export const createLogger = (prefix: string): Logger => {
  const formatPrefix = `[${prefix}]`;

  return {
    debug: __DEV__
      ? (...args: any[]) => console.log(formatPrefix, ...args)
      : noop,
    info: __DEV__
      ? (...args: any[]) => console.log(formatPrefix, ...args)
      : noop,
    warn: (...args: any[]) => console.warn(formatPrefix, ...args),
    error: (...args: any[]) => console.error(formatPrefix, ...args),
    group: __DEV__
      ? (label: string) => console.log(`\n${'='.repeat(50)}\n${formatPrefix} ${label}\n${'='.repeat(50)}`)
      : noop,
    groupEnd: __DEV__
      ? () => console.log('='.repeat(50) + '\n')
      : noop,
  };
};

// Pre-configured loggers for common modules
export const logger = {
  api: createLogger('API'),
  dashboard: createLogger('Dashboard'),
  settings: createLogger('Settings'),
  alarmKit: createLogger('AlarmKit'),
  notification: createLogger('Notification'),
  journeySelection: createLogger('JourneySelection'),
  background: createLogger('Background'),
  app: createLogger('App'),
};

export default logger;
