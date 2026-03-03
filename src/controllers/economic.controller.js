import catchAsync from '../utils/catchAsync.js';
import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { economicService } from '../services/index.js';

const ALLOWED_LIMITS = [10, 20];
const ALLOWED_IMPACTS = ['all', 'low', 'medium', 'high', 'important'];

const getTodayDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseDateParam = (value, paramName) => {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${paramName} date`);
  }
  return String(value);
};

const getCalendar = catchAsync(async (req, res) => {
  let from = parseDateParam(req.query.from, 'from');
  let to = parseDateParam(req.query.to, 'to');
  const page = parsePositiveInt(req.query.page, 1);
  const requestedLimit = parsePositiveInt(req.query.limit, 10);
  const limit = ALLOWED_LIMITS.includes(requestedLimit) ? requestedLimit : 10;
  const rawImpact = req.query.impact ? String(req.query.impact).toLowerCase() : 'all';
  const impact = ALLOWED_IMPACTS.includes(rawImpact) ? rawImpact : 'all';

  if (!from && !to) {
    const today = getTodayDateString();
    from = today;
    to = today;
  }

  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'from date must be before or equal to to date');
  }

  const filter = {};
  if (from) filter.from = from;
  if (to) filter.to = to;
  if (impact !== 'all') filter.impact = impact;

  const events = await economicService.getEvents(filter, { page, limit });

  res.send({
    results: events.results,
    pagination: {
      page: events.page,
      limit: events.limit,
      totalPages: events.totalPages,
      totalResults: events.totalResults,
      hasNextPage: events.page < events.totalPages,
      hasPrevPage: events.page > 1,
    },
  });
});

export default {
  getCalendar,
};
