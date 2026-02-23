import catchAsync from '../utils/catchAsync.js';
import { economicService } from '../services/index.js';

const getCalendar = catchAsync(async (req, res) => {
  const { from, to } = req.query;
  // Default to today/this week if not specified? 
  // Let's just pass what we have; service handles undefined query well?
  // Actually let's set defaults if missing to avoid fetching entire DB
  const filter = {};
  if (from) filter.from = from;
  if (to) filter.to = to;

  const events = await economicService.getEvents(filter);
  res.send(events);
});

export default {
  getCalendar,
};
