import httpStatus from 'http-status';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';

const getUserById = async (id) => {
  return User.findById(id);
};

const updateUserById = async (userId, updateBody) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  
  if (updateBody.email && (await User.isEmailTaken(updateBody.email, userId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  
  Object.assign(user, updateBody);
  await user.save();
  return user;
};

const queryUsers = async (filter, options) => {
    const users = await User.paginate(filter, options);
    return users;
};

const deleteUserById = async (userId) => {
    const user = await getUserById(userId);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    await user.remove();
    return user;
};

const blockUserById = async (userId) => {
    const user = await getUserById(userId);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    // Toggle block status
    user.isBlocked = !user.isBlocked;
    user.status = user.isBlocked ? 'Blocked' : 'Active';
    
    await user.save();
    return user;
};

const liquidateUserById = async (userId) => {
    const user = await getUserById(userId);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    // Reset equity and set status to Liquidated
    user.equity = 0;
    user.status = 'Liquidated';
    // Add logic to close all open positions here if transaction service is available
    
    await user.save();
    return user;
};

export default {
  getUserById,
  updateUserById,
  queryUsers,
  deleteUserById,
  blockUserById,
  liquidateUserById
};
