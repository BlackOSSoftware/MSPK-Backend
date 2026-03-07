import mongoose from 'mongoose';
import config from './config.js';
import logger from './log.js';

const connectDB = async () => {
  mongoose.set('bufferCommands', false);
  mongoose.connection.removeAllListeners('error');
  mongoose.connection.removeAllListeners('disconnected');
  mongoose.connection.removeAllListeners('reconnected');

  mongoose.connection.on('error', (error) => {
    logger.error(`MongoDB connection error: ${error.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  const conn = await mongoose.connect(config.mongoose.url, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 20000,
    maxPoolSize: 20,
    minPoolSize: 2,
    family: 4,
  });
  logger.info(`MongoDB Connected: ${conn.connection.host}`);
  return conn;
};

export default connectDB;
