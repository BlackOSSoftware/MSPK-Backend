
import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import Notification from '../models/Notification.js';

const getMyNotifications = catchAsync(async (req, res) => {
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
  const { token } = req.body;
  console.log('NotifController: Registering FCM Token:', token, 'for User:', req.user._id);
  if (!token) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Token is required' });
  }

  // Update user with unique token (avoid duplicates)
  await req.user.updateOne({
    $addToSet: { fcmTokens: token }
  });

  res.status(httpStatus.OK).send({ message: 'Token registered successfully' });
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
  getNotification,
  deleteNotification
};
