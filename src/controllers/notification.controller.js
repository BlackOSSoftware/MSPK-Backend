import httpStatus from 'http-status';
import crypto from 'crypto';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import Notification from '../models/Notification.js';
import FCMToken from '../models/FCMToken.js';
import Setting from '../models/Setting.js';
import User from '../models/User.js';
import telegramService from '../services/channels/telegram.service.js';
import whatsappChannelService from '../services/channels/whatsapp.service.js';
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
  req.user.telegramChatId = undefined;
  req.user.telegramUsername = undefined;
  req.user.telegramConnectedAt = undefined;
  req.user.telegramLinkToken = undefined;
  req.user.telegramLinkTokenExpiresAt = undefined;
  await req.user.save();

  res.send({
    message: 'Telegram disconnected',
    telegram: buildTelegramConnectionPayload(req.user),
  });
});

const sendWhatsAppTestMessage = catchAsync(async (req, res) => {
  const phone = String(req.user.phoneNumber || req.user.phone || '').trim();
  if (!phone) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is missing in your profile. Update it first.');
  }

  const waSetting = await Setting.findOne({ key: 'whatsapp_config' }).lean();
  const waConfig = waSetting?.value || null;

  if (!whatsappChannelService.isConfigured(waConfig)) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'WhatsApp channel is not configured on the server.');
  }

  const now = new Date();
  const defaultMessage = [
    'MSPK Trade Solutions',
    'WhatsApp test message',
    `User: ${req.user.name || req.user.email || 'Trader'}`,
    `Time: ${now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
    'If you received this message, your WhatsApp alert delivery is working.',
  ].join('\n');

  const message = String(req.body?.message || '').trim() || defaultMessage;
  const result = await whatsappChannelService.sendText(waConfig, {
    to: phone,
    text: message,
  });

  logger.info(`WhatsApp test message sent for user ${req.user._id} via ${result.provider}`);

  res.send({
    message: 'WhatsApp test message sent successfully',
    provider: result.provider,
    to: result.to,
    queued: result.queued || false,
    externalMessageId: result.messageId || null,
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
      $unset: {
        telegramChatId: 1,
        telegramUsername: 1,
        telegramConnectedAt: 1,
        telegramLinkToken: 1,
        telegramLinkTokenExpiresAt: 1,
      },
    }
  );

  user.telegramChatId = chatId;
  user.telegramUsername = username;
  user.telegramConnectedAt = now;
  user.telegramLinkToken = undefined;
  user.telegramLinkTokenExpiresAt = undefined;
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
  sendWhatsAppTestMessage,
  handleTelegramWebhook,
};
