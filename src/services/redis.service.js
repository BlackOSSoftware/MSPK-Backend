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
redisSubscriber.on('connect', () => logger.info('Redis Subscriber Connected'));

let connectPromise = null;

const waitForReady = (client, label) =>
  new Promise((resolve, reject) => {
    if (client.status === 'ready') {
      resolve();
      return;
    }

    const cleanup = () => {
      client.off('ready', handleReady);
      client.off('error', handleError);
      client.off('end', handleEnd);
      client.off('close', handleClose);
    };

    const handleReady = () => {
      cleanup();
      resolve();
    };

    const handleError = (error) => {
      cleanup();
      reject(error);
    };

    const handleEnd = () => {
      cleanup();
      reject(new Error(`${label} connection ended before ready`));
    };

    const handleClose = () => {
      if (client.status === 'ready') {
        cleanup();
        resolve();
      }
    };

    client.once('ready', handleReady);
    client.once('error', handleError);
    client.once('end', handleEnd);
    client.once('close', handleClose);

    if (client.status === 'ready') {
      handleReady();
    }
  });

const ensureRedisConnection = async (client, label) => {
  if (client.status === 'ready') {
    return;
  }

  if (client.status === 'wait') {
    await client.connect();
    return;
  }

  if (['connecting', 'connect', 'reconnecting'].includes(client.status)) {
    await waitForReady(client, label);
    return;
  }

  if (['close', 'end'].includes(client.status)) {
    await client.connect();
    return;
  }
};

const connectRedis = async () => {
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      await Promise.all([
        ensureRedisConnection(redisClient, 'Redis Client'),
        ensureRedisConnection(redisSubscriber, 'Redis Subscriber'),
      ]);
      return true;
    } catch (err) {
      logger.error('Redis Initial Connection Error', err);
      return false;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
};

export {
  redisClient,
  redisSubscriber,
  connectRedis
};
