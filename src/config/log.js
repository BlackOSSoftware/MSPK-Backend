import { EventEmitter } from 'events';
import config from './config.js';

export const logEmitter = new EventEmitter();

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = (process.env.LOG_LEVEL || '').toLowerCase();
const defaultLevel = config.env === 'development' ? 'debug' : 'info';
const activeLevel = Object.prototype.hasOwnProperty.call(LEVELS, envLevel) ? envLevel : defaultLevel;
const activeRank = LEVELS[activeLevel];

function safeToString(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatMessage(args) {
  return args.map(safeToString).join(' ');
}

function log(level, ...args) {
  if (LEVELS[level] > activeRank) return;

  const timestamp = new Date().toISOString();
  const consoleFn = console[level] || console.log;

  consoleFn(`[${timestamp}] ${level}:`, ...args);

  if (level === 'info' || level === 'warn' || level === 'error') {
    logEmitter.emit('log', {
      level,
      message: formatMessage(args),
      timestamp,
    });
  }
}

const logger = {
  error: (...args) => log('error', ...args),
  warn: (...args) => log('warn', ...args),
  info: (...args) => log('info', ...args),
  debug: (...args) => log('debug', ...args),
};

export default logger;
