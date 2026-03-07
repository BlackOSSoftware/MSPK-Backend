import httpStatus from 'http-status';
import crypto from 'crypto';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import Notification from '../models/Notification.js';
import FCMToken from '../models/FCMToken.js';
import User from '../models/User.js';
import telegramService from '../services/channels/telegram.service.js';
import logger from '../config/log.js';

const buildTelegramConnectionPayload = (user) => ({
  connected: Boolean(user?.telegramChatId),
  chatId: user?.telegramChatId || null,
  username: user?.telegramUsername || null,
  connectedAt: user?.telegramConnectedAt || null,
  botUsername: telegramService.getTelegramConfig().botUsername || null,
});

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

const getTelegramConnectLink = catchAsync(async (req, res) => {
  const linkToken = crypto.randomBytes(18).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  req.user.telegramLinkToken = linkToken;
  req.user.telegramLinkTokenExpiresAt = expiresAt;
  await req.user.save();

  const connectUrl = telegramService.buildTelegramConnectUrl(linkToken);
  if (!connectUrl) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Telegram bot username is not configured');
  }

  res.send({
    connectUrl,
    expiresAt,
    telegram: buildTelegramConnectionPayload(req.user),
  });
});

const disconnectTelegram = catchAsync(async (req, res) => {
  req.user.telegramChatId = null;
  req.user.telegramUsername = null;
  req.user.telegramConnectedAt = null;
  req.user.telegramLinkToken = null;
  req.user.telegramLinkTokenExpiresAt = null;
  await req.user.save();

  res.send({
    message: 'Telegram disconnected',
    telegram: buildTelegramConnectionPayload(req.user),
  });
});

const handleTelegramWebhook = catchAsync(async (req, res) => {
  const expectedSecret = telegramService.getTelegramConfig().webhookSecret;
  if (!expectedSecret || req.params.secret !== expectedSecret) {
    return res.status(httpStatus.FORBIDDEN).send({ message: 'Invalid Telegram webhook secret' });
  }

  const message = req.body?.message;
  const text = String(message?.text || '').trim();
  const chatId = message?.chat?.id ? String(message.chat.id) : null;
  const username = message?.from?.username || message?.chat?.username || null;

  if (!chatId || !text.startsWith('/start')) {
    return res.status(httpStatus.OK).send({ ok: true });
  }

  const payload = text.replace(/^\/start\s*/i, '').trim();
  if (!payload.startsWith('tg_')) {
    await telegramService.sendTelegramMessage({}, 'Signal alerts connect karne ke liye app se naya Telegram link use karo.', {
      chatId,
    });
    return res.status(httpStatus.OK).send({ ok: true });
  }

  const linkToken = payload.slice(3).trim();
  if (!linkToken) {
    return res.status(httpStatus.OK).send({ ok: true });
  }

  const now = new Date();
  const user = await User.findOne({
    telegramLinkToken: linkToken,
    telegramLinkTokenExpiresAt: { $gt: now },
  });

  if (!user) {
    await telegramService.sendTelegramMessage({}, 'Yeh Telegram link expire ho chuka hai. App me jaake dobara Connect Telegram karo.', {
      chatId,
    });
    return res.status(httpStatus.OK).send({ ok: true });
  }

  await User.updateMany(
    {
      _id: { $ne: user._id },
      telegramChatId: chatId,
    },
    {
      $set: {
        telegramChatId: null,
        telegramUsername: null,
        telegramConnectedAt: null,
        telegramLinkToken: null,
        telegramLinkTokenExpiresAt: null,
      },
    }
  );

  user.telegramChatId = chatId;
  user.telegramUsername = username;
  user.telegramConnectedAt = now;
  user.telegramLinkToken = null;
  user.telegramLinkTokenExpiresAt = null;
  await user.save();

  await telegramService.sendTelegramMessage({}, `Telegram alerts connected for ${user.name}. Ab paid/demo signals direct yahin milenge.`, {
    chatId,
  });

  logger.info(`Telegram connected for user ${user._id}`);
  return res.status(httpStatus.OK).send({ ok: true });
});

export default {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  registerFCMToken,
  unregisterFCMToken,
  getNotification,
  deleteNotification,
  disconnectTelegram,
  getTelegramConnectLink,
  handleTelegramWebhook,
};
