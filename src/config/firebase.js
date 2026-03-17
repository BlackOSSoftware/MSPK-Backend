import admin from 'firebase-admin';
import logger from './log.js';
import fs from 'fs';
import path from 'path';

let missingConfigWarningShown = false;

const resolveFirebaseServiceAccountPath = () => {
  const configuredPath = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  ).trim();

  const candidatePaths = configuredPath
    ? [
        path.isAbsolute(configuredPath)
          ? configuredPath
          : path.resolve(process.cwd(), configuredPath),
      ]
    : [];

  candidatePaths.push(path.resolve(process.cwd(), 'firebase-service-account.json'));

  return candidatePaths.find((candidate) => fs.existsSync(candidate)) || '';
};

const hasFirebaseEnvCredentials = () => {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').trim();
  return Boolean(projectId && clientEmail && privateKey);
};

const isFirebaseAvailable = () =>
  Boolean((admin.apps && admin.apps.length > 0) || resolveFirebaseServiceAccountPath() || hasFirebaseEnvCredentials());

const logMissingFirebaseConfig = () => {
  if (missingConfigWarningShown) return;
  missingConfigWarningShown = true;
  logger.warn(
    'Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_* env vars. Push notifications will stay disabled.'
  );
};

const initializeFirebase = () => {
  try {
    if (admin.apps && admin.apps.length > 0) {
      return;
    }

    const serviceAccountPath = resolveFirebaseServiceAccountPath();
    
    if (serviceAccountPath) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      logger.info('Firebase Admin initialized via service account file');
    } else {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

      if (projectId && clientEmail && privateKey) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          })
        });
        logger.info('Firebase Admin initialized via environment variables');
      } else {
        logMissingFirebaseConfig();
      }
    }
  } catch (error) {
    logger.error('Firebase initialization error:', error);
  }
};

export { admin, initializeFirebase, isFirebaseAvailable };
