import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

export default {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
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
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
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
};
