import Watchlist from '../models/Watchlist.js';
import catchAsync from '../utils/catchAsync.js';

// @desc    Get user watchlists
// @route   GET /api/watchlist
// @access  Private
const getWatchlists = catchAsync(async (req, res) => {
  let watchlists = await Watchlist.find({ user: req.user._id })
    .populate('signals')
    .sort({ createdAt: 1 });

  // Create default if none exist
  if (watchlists.length === 0) {
    const defaultList = await Watchlist.create({
      user: req.user._id,
      name: 'Watchlist 1',
      isDefault: true,
      signals: []
    });
    watchlists = [defaultList];
  }

  res.json(watchlists);
});

// @desc    Create new watchlist
// @route   POST /api/watchlist
// @access  Private
const createWatchlist = catchAsync(async (req, res) => {
  const { name } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Watchlist name is required');
  }

  const exists = await Watchlist.findOne({ user: req.user._id, name });
  if (exists) {
    res.status(400);
    throw new Error('Watchlist name already exists');
  }

  const watchlist = await Watchlist.create({
    user: req.user._id,
    name,
    signals: []
  });

  res.status(201).json(watchlist);
});

// @desc    Delete watchlist
// @route   DELETE /api/watchlist/:id
// @access  Private
const deleteWatchlist = catchAsync(async (req, res) => {
  const watchlist = await Watchlist.findOne({ _id: req.params.id, user: req.user._id });

  if (!watchlist) {
    res.status(404);
    throw new Error('Watchlist not found');
  }

  if (watchlist.isDefault) {
    res.status(400);
    throw new Error('Cannot delete default watchlist');
  }

  await watchlist.deleteOne();
  res.json({ message: 'Watchlist removed' });
});

// @desc    Toggle Signal in Watchlist
// @route   PATCH /api/watchlist/:id/toggle
// @access  Private
const toggleSignal = catchAsync(async (req, res) => {
  const { signalId } = req.body;
  const watchlist = await Watchlist.findOne({ _id: req.params.id, user: req.user._id });

  if (!watchlist) {
    res.status(404);
    throw new Error('Watchlist not found');
  }

  const index = watchlist.signals.indexOf(signalId);
  if (index === -1) {
    watchlist.signals.push(signalId);
  } else {
    watchlist.signals.splice(index, 1);
  }

  await watchlist.save();
  
  // Return populated signals for immediate UI update
  await watchlist.populate('signals');
  
  res.json(watchlist);
});

export {
  getWatchlists,
  createWatchlist,
  deleteWatchlist,
  toggleSignal
};
