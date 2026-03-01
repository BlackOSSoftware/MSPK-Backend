import Redis from 'ioredis';
import config from '../config/config.js';
import logger from '../config/log.js';

const createRateLimitedLogger = (label, intervalMs = 30000) => {
  let lastLog = 0;
  let suppressed = 0;
  return (err) => {
    const now = Date.now();
    if (now - lastLog >= intervalMs) {
      const message = err?.message || String(err);
      const suffix = suppressed > 0 ? ` (suppressed ${suppressed} repeats)` : '';
      logger.error(`${label}: ${message}${suffix}`);
      lastLog = now;
      suppressed = 0;
      return;
    }
    suppressed++;
  };
};

const redisRetryStrategy = (times) => {
  // In development, stop retrying after a few attempts to avoid log/CPU storms.
  if (config.env === 'development') {
    const maxAttempts = 5;
    if (times > maxAttempts) return null;
  }
  return Math.min(times * 2000, 15000);
};

const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  lazyConnect: true,
  retryStrategy: redisRetryStrategy,
  maxRetriesPerRequest: config.env === 'development' ? 1 : undefined
});

const redisSubscriber = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  lazyConnect: true,
  retryStrategy: redisRetryStrategy,
  maxRetriesPerRequest: config.env === 'development' ? 1 : undefined
});

const logRedisClientError = createRateLimitedLogger('Redis Client Error');
const logRedisSubscriberError = createRateLimitedLogger('Redis Subscriber Error');

redisClient.on('error', logRedisClientError);
redisClient.on('connect', () => logger.info('Redis Client Connected'));
redisSubscriber.on('error', logRedisSubscriberError);

const connectRedis = async () => {
  try {
    await Promise.all([redisClient.connect(), redisSubscriber.connect()]);
    return true;
  } catch (err) {
    logger.error('Redis Initial Connection Error', err);
    return false;
  }
};

export {
  redisClient,
  redisSubscriber,
  connectRedis
};
