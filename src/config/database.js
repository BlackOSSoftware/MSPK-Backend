import mongoose from 'mongoose';
import config from './config.js';
import logger from './log.js';

const connectDB = async () => {
  const conn = await mongoose.connect(config.mongoose.url);
  logger.info(`MongoDB Connected: ${conn.connection.host}`);
  return conn;
};

export default connectDB;
