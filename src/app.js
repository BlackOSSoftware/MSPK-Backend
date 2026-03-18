import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import { metricsMiddleware } from './middleware/metrics.js';
import config from './config/config.js';
import routes from './routes/index.js';
import webhookRoute from './routes/webhook.route.js';
import marketController from './controllers/market.controller.js';

const app = express();
app.set('trust proxy', config.trustProxy);

const HTTP_LOG_NOISE_PATHS = [
  '/v1/health',
  '/v1/notifications',
  '/v1/auth/me',
  '/v1/market/symbols',
  '/v1/signals',
  '/v1/sub-brokers',
  '/v1/admin/users',
];

const shouldSkipHttpLog = (req, res) => {
  const statusCode = Number(res?.statusCode || 0);
  const url = String(req?.originalUrl || req?.url || '');
  const isPollingGet = req?.method === 'GET' && HTTP_LOG_NOISE_PATHS.some((prefix) => url.startsWith(prefix));

  if (!isPollingGet) return false;
  if (statusCode >= 400) return false;

  return true;
};

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://www.mspktradesolutions.com',
  'https://user.mspktradesolutions.com',
  'https://admin.mspktradesolutions.com'
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
  if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return true;
  return false;
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};

// Middleware
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(compression({
  level: 6,
  threshold: 1024
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  ['/webhook', '/webhooks', '/v1/webhook', '/v1/webhooks'],
  express.text({ type: ['text/plain', 'text/*'] })
);
app.use('/uploads', express.static('uploads', {
  maxAge: '6h',
  etag: true
})); // Serve uploaded files
// app.use(helmet()); // Temporarily disabled to debug 308 Redirects
// app.use(cors()); // Moved to top

// Logger
if (config.env === 'development') {
  app.use(
    morgan('dev', {
      skip: shouldSkipHttpLog,
    })
  );
}

// Direct Route for Fyers Login Callback to match User's App Config (No /v1)
app.get('/market/login/fyers', marketController.handleLoginCallback);
app.use('/webhook', webhookRoute);
app.use('/webhooks', webhookRoute);

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
