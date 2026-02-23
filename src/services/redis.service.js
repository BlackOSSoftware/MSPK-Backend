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
    // No await here, let it connect in background
    redisClient.connect().catch(err => logger.error('Redis Client Initial Connection Error', err));
    redisSubscriber.connect().catch(err => logger.error('Redis Subscriber Initial Connection Error', err));
}

export {
  redisClient,
  redisSubscriber,
  connectRedis
};
