import jwt from 'jsonwebtoken';
import httpStatus from 'http-status';
import config from '../config/config.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';

const optionalAuth = () => async (req, res, next) => {
  try {
    // 1) Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return next(); // Guest user
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authorization header'));
    }

    // 2) Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      if (err?.name === 'TokenExpiredError') {
        return next(new ApiError(httpStatus.UNAUTHORIZED, 'Token expired'));
      }
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'Invalid token'));
    }

    const user = await User.findById(decoded.sub);
    if (!user) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'User not found'));
    }

    // Single session verification (tokenVersion)
    if (user.tokenVersion && decoded.v !== user.tokenVersion) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'Session expired. Please login again.'));
    }

    if (!user.isEmailVerified) {
      return next(new ApiError(httpStatus.FORBIDDEN, 'Email is not verified. Please verify your email to continue.'));
    }

    if (user.status !== 'Active') {
      return next(new ApiError(httpStatus.FORBIDDEN, `Your account is ${String(user.status || 'inactive').toLowerCase()}.`));
    }

    req.user = user;
    
    next();
  } catch (err) {
    next(err);
  }
};

export default optionalAuth;
