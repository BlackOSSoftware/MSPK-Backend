import mongoose from 'mongoose';
import config from './config.js';
import logger from './log.js';
import User from '../models/User.js';

const EXPECTED_TELEGRAM_PARTIAL_FILTERS = {
  telegramChatId_1: { telegramChatId: { $type: 'string' } },
  telegramLinkToken_1: { telegramLinkToken: { $type: 'string' } },
};

const normalizeIndexSpec = (value) => JSON.stringify(value || {});

const ensureUserTelegramIndexes = async () => {
  let indexes = [];

  try {
    indexes = await User.collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') {
      await User.createCollection();
      logger.info('Created users collection before repairing Telegram indexes');
    } else {
      throw error;
    }
  }

  for (const [indexName, partialFilterExpression] of Object.entries(EXPECTED_TELEGRAM_PARTIAL_FILTERS)) {
    const existingIndex = indexes.find((index) => index.name === indexName);
    const needsRepair =
      !existingIndex ||
      !existingIndex.unique ||
      normalizeIndexSpec(existingIndex.partialFilterExpression) !==
        normalizeIndexSpec(partialFilterExpression);

    if (!needsRepair) {
      continue;
    }

    if (existingIndex) {
      await User.collection.dropIndex(indexName);
      logger.warn(`Dropped outdated users index: ${indexName}`);
    }

    const key = indexName === 'telegramChatId_1' ? { telegramChatId: 1 } : { telegramLinkToken: 1 };

    await User.collection.createIndex(key, {
      unique: true,
      partialFilterExpression,
      name: indexName,
    });

    logger.info(`Ensured users index: ${indexName}`);
  }
};

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
  await ensureUserTelegramIndexes();
  logger.info(`MongoDB Connected: ${conn.connection.host}`);
  return conn;
};

export default connectDB;
