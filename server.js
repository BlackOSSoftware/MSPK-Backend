import app from './src/app.js';
import config from './src/config/config.js';
import logger from './src/config/logger.js';
import connectDB from './src/config/database.js';
import { initWebSocket } from './src/services/websocket.service.js';
import { connectRedis } from './src/services/redis.service.js';
import strategyService from './src/services/strategy.service.js';
import signalMonitor from './src/services/signal.monitor.js';
import schedulerService from './src/services/scheduler.service.js';
import hybridStrategyService from './src/services/hybridStrategy.service.js';
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
    // 1. Connect to Database
    await connectDB();
    
    // 2. Connect to Redis
    await connectRedis();

    // 2.5 Initialize Firebase
    initializeFirebase();

    // 3. Start Express Server
    const server = app.listen(config.port, '0.0.0.0', () => {
      logger.info(`Server running in ${config.env} mode on port ${config.port}`);
    });

    // 4. Initialize Background Services
    marketDataService.init(); 
    initWebSocket(server);
    await strategyService.seedStrategies(); 
    strategyService.startEngine();
    hybridStrategyService.start();
    signalMonitor.start(); 
    
    // Initialize Economic Service with API key
    economicService.initialize(config.fmpApiKey);
    logger.info('Economic Service initialized with FMP API key');
    
    schedulerService.initScheduler();
    schedulerService.initScheduler();
    subscriptionCron.start(); // Start subscription expiry checker

    
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
 
 
