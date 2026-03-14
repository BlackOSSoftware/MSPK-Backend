import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const parseTrustProxy = (value, env) => {
  if (value === undefined || value === null || value === '') {
    return env === 'production' ? 1 : false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return 1;
  if (['false', '0', 'no'].includes(normalized)) return false;

  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;

  return value;
};

export default {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV || 'development'),
  mongoose: {
    url: process.env.MONGO_URI ,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    },
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '10d',
  },
  fmpApiKey: process.env.FMP_API_KEY,
  useMockBroker: process.env.USE_MOCK_BROKER === 'true', 
  fyers: {
    appId: process.env.FYERS_APP_ID,
    secretId: process.env.FYERS_SECRET_ID,
    redirectUri: process.env.FYERS_REDIRECT_URI || 'http://localhost:3000/market/login/fyers',
  },
  kite: {
    apiKey: process.env.KITE_API_KEY,
    apiSecret: process.env.KITE_API_SECRET,
  },
  upstox: {
    apiKey: process.env.UPSTOX_API_KEY,
    apiSecret: process.env.UPSTOX_API_SECRET,
    redirectUri: process.env.UPSTOX_REDIRECT_URI || 'http://localhost:3000/market/login/upstox',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
    channelId: process.env.TELEGRAM_CHANNEL_ID || '',
    webhookBaseUrl: process.env.TELEGRAM_WEBHOOK_BASE_URL || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  },
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || '',
    defaultCountryCode:
      process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ||
      process.env.ULTRAMSG_DEFAULT_COUNTRY_CODE ||
      '91',
    ultramsg: {
      baseUrl: process.env.ULTRAMSG_BASE_URL || 'https://api.ultramsg.com',
      instanceId: process.env.ULTRAMSG_INSTANCE_ID || '',
      token: process.env.ULTRAMSG_TOKEN || '',
      priority: process.env.ULTRAMSG_PRIORITY || 10,
    },
    meta: {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    },
  },
};
