import admin from 'firebase-admin';
import logger from './logger.js';
import fs from 'fs';
import path from 'path';

const initializeFirebase = () => {
  try {
    const serviceAccountPath = path.resolve(process.cwd(), 'firebase-service-account.json');
    
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      logger.info('Firebase Admin initialized via service account file');
    } else {
      logger.warn('Firebase service account file not found. Push notifications will be disabled or limited.');
      // You can also initialize with env variables if preferred:
      /*
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
      });
      */
    }
  } catch (error) {
    logger.error('Firebase initialization error:', error);
  }
};

export { admin, initializeFirebase };
