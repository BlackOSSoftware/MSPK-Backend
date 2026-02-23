
import express from 'express';
import auth from '../middleware/auth.js';
import searchController from '../controllers/search.controller.js';

const router = express.Router();

router.get('/', auth(), searchController.globalSearch);

export default router;
