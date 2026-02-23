import jwt from 'jsonwebtoken';
import httpStatus from 'http-status';
import config from '../config/config.js';
import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';

const auth = (requiredRoles = []) => async (req, res, next) => {
  try {
    // 1) Get token from header
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
    }

    // 2) Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // 3) Check if user exists
    const user = await User.findById(decoded.sub);
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'User not found');
    }

    // 4) Check Single Session (Token Version)
    // If the user has a tokenVersion set (meaning they logged in on the new system), 
    // the incoming token MUST match it. This invalidates old/legacy tokens immediately.
    if (user.tokenVersion && decoded.v !== user.tokenVersion) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Session expired. Logged in on another device.');
    }

    // 5) Check Email Verification
    if (!user.isEmailVerified) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Email is not verified. Please verify your email to continue.');
    }

    // 6) Check Subscription Status (Block if Inactive/Blocked)
    if (user.status === 'Inactive' || user.status === 'Blocked') {
        throw new ApiError(httpStatus.FORBIDDEN, 'Your account is disabled or blocked. Please contact support.');
    }

    // 6) Check role
    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
       throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
    }

    req.user = user;
    next();
  } catch (err) {
    next(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
  }
};

export default auth;
