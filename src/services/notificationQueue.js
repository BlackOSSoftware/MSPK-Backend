import { Queue } from 'bullmq';
import config from '../config/config.js';

const connection = {
  host: config.redis.host,
  port: config.redis.port,
};

const notificationQueue = new Queue('notifications', { connection });

export { connection as notificationQueueConnection, notificationQueue };
export default notificationQueue;
