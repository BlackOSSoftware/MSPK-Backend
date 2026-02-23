import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoose.url);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
