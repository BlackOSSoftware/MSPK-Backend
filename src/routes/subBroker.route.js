import express from 'express';
import auth from '../middleware/auth.js';
import subBrokerController from '../controllers/subBroker.controller.js';
import upload from '../middleware/upload.js';

const router = express.Router();

router.use(auth());

// Admin Routes
router.post('/', auth(['admin']), subBrokerController.createSubBroker);
router.get('/', auth(['admin']), subBrokerController.getSubBrokers);
router.get('/:subBrokerId', auth(['admin']), subBrokerController.getSubBrokerDetails); // Details & Stats
router.patch('/:subBrokerId', auth(['admin']), subBrokerController.updateSubBroker);
router.delete('/:subBrokerId', auth(['admin']), subBrokerController.deleteSubBroker);
router.post('/:subBrokerId/payout', auth(['admin']), upload.single('screenshot'), subBrokerController.processPayout);

// Sub-Broker Routes (Self)
router.get('/clients', auth(['sub-broker']), subBrokerController.getMyClients);
router.get('/commissions', auth(['sub-broker']), subBrokerController.getMyCommissions);

export default router;
