import app from './src/app.js';
import config from './src/config/config.js';
import logger from './src/config/log.js';
import connectDB from './src/config/database.js';
import { initWebSocket } from './src/services/websocket.service.js';
import { connectRedis } from './src/services/redis.service.js';
import schedulerService from './src/services/scheduler.service.js';
import { initializeFirebase } from './src/config/firebase.js';
import marketDataService from './src/services/marketData.service.js';
import subscriptionCron from './src/jobs/subscriptionCron.js';
import { economicService } from './src/services/economic.service.js';
import './src/workers/notification.worker.js'; // Start Notification Worker

// The 'kiteconnect' library aggressively calls process.exit(1) on connection failures.
// We intercept this to prevent the entire server from crashing due to a localized ticker error.
const originalExit = process.exit;
process.exit = (code) => {
    const stack = new Error().stack;
    if (stack && (stack.includes('kiteconnect') || stack.includes('ticker.js'))) {
        console.error(`[CRITICAL_GUARD] blocked process.exit(${code}) call from KiteTicker. Keeping server alive.`);
        return;
    }
    
    // Allow legitimate exits
    console.log(`[PROCESS_EXIT] Exiting with code: ${code}`);
    originalExit(code);
};

const startServer = async () => {
  try {
    let dbConnected = false;
    let redisConnected = false;

    // 1. Connect to Database
    try {
      await connectDB();
      dbConnected = true;
    } catch (error) {
      logger.error('MongoDB connection failed:', error.message);
      if (config.env === 'production') {
        throw error;
      }
      logger.warn('Running in degraded mode without MongoDB (development only).');
    }
    
    // 2. Connect to Redis
    redisConnected = await connectRedis();
    if (!redisConnected) {
      if (config.env === 'production') {
        throw new Error('Redis connection failed');
      }
      logger.warn('Running in degraded mode without Redis (development only).');
    }

    // 2.5 Initialize Firebase
    initializeFirebase();

    // 3. Start Express Server
    const server = app.listen(config.port, '0.0.0.0', () => {
      logger.info(`Server running in ${config.env} mode on port ${config.port}`);
    });

    // 4. Initialize Background Services
    marketDataService.init(); 
    initWebSocket(server);
    if (dbConnected) {
      schedulerService.initScheduler();
      subscriptionCron.start(); // Start subscription expiry checker
    } else {
      logger.warn('Skipped DB-dependent background services because MongoDB is unavailable.');
    }
    
    // Initialize Economic Service with API key
    economicService.initialize(config.fmpApiKey);
    logger.info('Economic Service initialized with FMP API key');

    if (!redisConnected) {
      logger.warn('Redis unavailable: pub/sub, queue workers, and cache-backed features may not work.');
    }

    
    // Handle signals for graceful shutdown
    const exitHandler = () => {
      if (server) {
        server.close(() => {
          logger.info('Server closed');
          process.exit(1);
        });
      } else {
        process.exit(1);
      }
    };

    const unexpectedErrorHandler = (error) => {
      logger.error('Unexpected Global Error:', error);
      if (error && error.stack) {
        logger.error(error.stack);
      }
      // Do not exit the process for these errors, just log them
      // exitHandler(); 
    };

    process.on('uncaughtException', unexpectedErrorHandler);
    process.on('unhandledRejection', unexpectedErrorHandler);

    

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received');
      if (server) {
        server.close();
      }
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
 
 
