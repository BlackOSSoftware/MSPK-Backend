import subscriptionService from '../services/subscription.service.js';
import httpStatus from 'http-status';

/**
 * Middleware to check segment access
 * usage: router.get('/some-route', auth(), requireSegment('EQUITY'), controller)
 */
const requireSegment = (segmentCode) => async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(httpStatus.UNAUTHORIZED).send({ message: 'Unauthorized' });
    }

    const hasAccess = await subscriptionService.checkAccess(userId, segmentCode.toUpperCase());

    if (!hasAccess) {
      return res.status(httpStatus.FORBIDDEN).send({ 
        message: `Access Denied. Active subscription for ${segmentCode} is required.` 
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

export default requireSegment;
