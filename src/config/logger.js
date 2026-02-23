import winston from 'winston';
import config from './config.js';
import { EventEmitter } from 'events';

export const logEmitter = new EventEmitter();

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.stack });
  }
  return info;
});

class EmitterTransport extends winston.Transport {
  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const cleanLevel = info.level.replace(/\x1B\[\d+m/g, '');
    if (['info', 'warn', 'error'].includes(cleanLevel)) {
        logEmitter.emit('log', {
          level: cleanLevel,
          message: info.message,
          timestamp: new Date().toISOString()
        });
    }
    callback();
  }
}

const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    enumerateErrorFormat(),
    config.env === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.splat(),
    winston.format.printf(({ level, message }) => `${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
    new winston.transports.File({ filename: 'logs/debug.log' }),
    new EmitterTransport()
  ],
});

export default logger;
