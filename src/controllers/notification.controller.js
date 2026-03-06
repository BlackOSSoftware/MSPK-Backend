
import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import Notification from '../models/Notification.js';
import FCMToken from '../models/FCMToken.js';
import User from '../models/User.js';

const getMyNotifications = catchAsync(async (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  const notifications = await Notification.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50);
  
  const unreadCount = await Notification.countDocuments({ user: req.user.id, isRead: false });

  res.send({ results: notifications, unreadCount });
});

const markAsRead = catchAsync(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, user: req.user.id },
    { isRead: true },
    { new: true }
  );
  if (!notification) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Notification not found' });
  }
  res.send(notification);
});

const markAllAsRead = catchAsync(async (req, res) => {
  await Notification.updateMany(
    { user: req.user.id, isRead: false },
    { isRead: true }
  );
  res.status(httpStatus.NO_CONTENT).send();
});

const registerFCMToken = catchAsync(async (req, res) => {
  const { token, platform } = req.body;
  console.log('NotifController: Registering FCM Token:', token, 'platform:', platform, 'for User:', req.user._id);
  if (!token || !platform) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Token and platform are required' });
  }

  const normalizedPlatform = String(platform).toLowerCase().trim();
  if (!['android', 'web', 'ios'].includes(normalizedPlatform)) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid platform. Use android, web, or ios' });
  }

  await FCMToken.findOneAndUpdate(
    { token },
    {
      $set: {
        user: req.user._id,
        platform: normalizedPlatform,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Keep only one token per user per platform (single-device per platform)
  await FCMToken.deleteMany({
    user: req.user._id,
    platform: normalizedPlatform,
    token: { $ne: token },
  });

  // Keep legacy user.fcmTokens in sync (if used by admin panels/debug)
  const userTokens = await FCMToken.find({ user: req.user._id }).select('token');
  await User.updateOne(
    { _id: req.user._id },
    { $set: { fcmTokens: userTokens.map((doc) => doc.token) } }
  );

  res.status(httpStatus.OK).send({ message: 'Token registered successfully' });
});

const unregisterFCMToken = catchAsync(async (req, res) => {
  const { token, platform } = req.body;
  if (!token && !platform) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Token or platform is required' });
  }

  if (token) {
    await FCMToken.deleteOne({ token, user: req.user._id });
  }

  if (platform) {
    const normalizedPlatform = String(platform).toLowerCase().trim();
    await FCMToken.deleteMany({ user: req.user._id, platform: normalizedPlatform });
  }

  const userTokens = await FCMToken.find({ user: req.user._id }).select('token');
  await User.updateOne(
    { _id: req.user._id },
    { $set: { fcmTokens: userTokens.map((doc) => doc.token) } }
  );

  res.status(httpStatus.NO_CONTENT).send();
});

const getNotification = catchAsync(async (req, res) => {
    const notification = await Notification.findOne({
        _id: req.params.notificationId,
        user: req.user.id
    });
    if (!notification) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Notification not found');
    }
    res.send(notification);
});

const deleteNotification = catchAsync(async (req, res) => {
    const notification = await Notification.findOneAndDelete({
        _id: req.params.notificationId,
        user: req.user.id
    });
    if (!notification) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Notification not found');
    }
    res.status(httpStatus.NO_CONTENT).send();
});

export default {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  registerFCMToken,
  unregisterFCMToken,
  getNotification,
  deleteNotification
};
