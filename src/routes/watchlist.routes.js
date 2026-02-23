import express from 'express';
import auth from '../middleware/auth.js';
import {
  getWatchlists,
  createWatchlist,
  deleteWatchlist,
  toggleSignal
} from '../controllers/watchlist.controller.js';

const router = express.Router();

router.use(auth()); // All routes private

router.route('/')
  .get(getWatchlists)
  .post(createWatchlist);

router.route('/:id')
  .delete(deleteWatchlist);

router.route('/:id/toggle')
  .patch(toggleSignal);

export default router;
