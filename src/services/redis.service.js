import Redis from 'ioredis';
import config from '../config/config.js';
import logger from '../config/logger.js';

const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  lazyConnect: true // Don't crash if Redis is not running immediately
});

const redisSubscriber = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  lazyConnect: true
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.on('connect', () => logger.info('Redis Client Connected'));
redisSubscriber.on('error', (err) => logger.error('Redis Subscriber Error', err));

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
