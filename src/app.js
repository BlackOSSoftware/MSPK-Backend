import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { metricsMiddleware } from './middleware/metrics.js';
import config from './config/config.js';
import routes from './routes/index.js';

const app = express();

// Middleware
app.use(cors({
  origin: true, // Reflects the request origin
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads')); // Serve uploaded files
// app.use(helmet()); // Temporarily disabled to debug 308 Redirects
// app.use(cors()); // Moved to top

// Logger
if (config.env === 'development') {
  app.use(morgan('dev'));
}

// Direct Route for Fyers Login Callback to match User's App Config (No /v1)
import marketController from './controllers/market.controller.js';
app.get('/market/login/fyers', marketController.handleLoginCallback);

app.use(metricsMiddleware);

// Routes
app.use('/v1', routes);

// Error handling
app.use((err, req, res, next) => {
  const { statusCode, message } = err;
  res.status(statusCode || 500).json({
    status: 'error',
    statusCode: statusCode || 500,
    message: message || 'Internal Server Error',
  });
});

export default app;
