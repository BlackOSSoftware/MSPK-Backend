import httpStatus from 'http-status';
import config from '../config/config.js';
import catchAsync from '../utils/catchAsync.js';
import { authService, tokenService, userService, msg91Service, emailService } from '../services/index.js';
import { redisClient } from '../services/redis.service.js'; // Direct client access for Email OTP
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import FCMToken from '../models/FCMToken.js';
import telegramService from '../services/channels/telegram.service.js';
import whatsappChannelService from '../services/channels/whatsapp.service.js';
import { isLoopbackClientIp, resolveClientIp } from '../utils/requestIp.js';

const buildTelegramPayload = (userObject) => ({
  connected: Boolean(userObject?.telegramChatId),
  chatId: userObject?.telegramChatId || null,
  username: userObject?.telegramUsername || null,
  displayName: userObject?.telegramDisplayName || userObject?.telegramUsername || null,
  connectedAt: userObject?.telegramConnectedAt || null,
  botUsername: telegramService.getTelegramConfig().botUsername || null,
});

const maskEmail = (email) => {
  const value = String(email || '').trim().toLowerCase();
  const at = value.indexOf('@');
  if (at <= 1) return value || '';
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  const first = name[0];
  const last = name[name.length - 1] || '';
  return `${first}***${last}@${domain}`;
};

const maskPhone = (phone) => {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) return raw || '';
  const last4 = digits.slice(-4);
  return `***${last4}`;
};

const OTP_TTL_SECONDS = 600;
const OTP_DAILY_LIMIT = 5;
const PREFER_WHATSAPP_OTP = String(process.env.AUTH_PREFER_WHATSAPP_OTP || 'true').trim().toLowerCase() !== 'false';

const normalizeEmailIdentifier = (value = '') => String(value || '').trim().toLowerCase();

const buildPhoneLookupCandidates = (value = '') => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return [];

  const candidates = new Set([digits]);

  if (digits.length === 10) {
    candidates.add(`91${digits}`);
  }

  if (digits.length === 12 && digits.startsWith('91')) {
    candidates.add(digits.slice(2));
  }

  return Array.from(candidates);
};

const normalizePhoneIdentifier = (value = '') => {
  const candidates = buildPhoneLookupCandidates(value);
  if (candidates.length === 0) return '';

  const withCountryCode = candidates.find((candidate) => candidate.length > 10);
  return withCountryCode || candidates[0];
};

const isEmailIdentifier = (value = '') => String(value || '').includes('@');

const getDailyOtpCount = async (dailyKey) => {
  const dailyCount = await redisClient.get(dailyKey);
  return dailyCount ? Number.parseInt(dailyCount, 10) : 0;
};

const incrementDailyOtpCount = async (dailyKey) => {
  const newCount = await redisClient.incr(dailyKey);
  if (newCount === 1) {
    await redisClient.expire(dailyKey, 86400);
  }
  return newCount;
};

const createStatusError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const updateOtpAudit = async (query, channel, target) => {
  if (!query) return;

  await User.updateOne(
    query,
    {
      $set: {
        lastOtpSentAt: new Date(),
        lastOtpChannel: channel,
        lastOtpTarget: target,
      },
    }
  );
};

const resolvePhoneUserQuery = (phone) => {
  const phoneCandidates = buildPhoneLookupCandidates(phone);
  if (phoneCandidates.length === 0) return null;
  return { phone: { $in: phoneCandidates } };
};

const resolveWhatsappOtpContext = async (identifier) => {
  const rawIdentifier = String(identifier || '').trim();
  if (!rawIdentifier) {
    throw createStatusError(httpStatus.BAD_REQUEST, 'Identifier is required');
  }

  if (isEmailIdentifier(rawIdentifier)) {
    const email = normalizeEmailIdentifier(rawIdentifier);
    const user = await User.findOne({ email }).select('_id email phone').lean();

    if (!user) {
      throw createStatusError(httpStatus.NOT_FOUND, 'No account found for this email address.');
    }

    const recipientPhone = normalizePhoneIdentifier(user.phone);
    if (!recipientPhone) {
      throw createStatusError(
        httpStatus.BAD_REQUEST,
        'This account does not have a WhatsApp number linked. Please contact support.'
      );
    }

    return {
      normalizedIdentifier: email,
      user,
      email,
      recipientPhone,
      userQuery: { _id: user._id },
      maskedTarget: maskPhone(recipientPhone),
    };
  }

  const recipientPhone = normalizePhoneIdentifier(rawIdentifier);
  if (!recipientPhone) {
    throw createStatusError(httpStatus.BAD_REQUEST, 'Valid phone number is required');
  }

  const phoneQuery = resolvePhoneUserQuery(recipientPhone);
  const user = phoneQuery ? await User.findOne(phoneQuery).select('_id email phone').lean() : null;

  return {
    normalizedIdentifier: recipientPhone,
    user,
    email: user?.email ? normalizeEmailIdentifier(user.email) : '',
    recipientPhone,
    userQuery: user?._id ? { _id: user._id } : phoneQuery,
    maskedTarget: maskPhone(recipientPhone),
  };
};

const sendWhatsappOtpCode = async (phone, otp) => {
  const message = [
    `Your MSPK Trade Solutions OTP is ${otp}.`,
    'It is valid for 10 minutes.',
    'If you did not request this, please ignore this message.',
  ].join('\n');

  const whatsappConfig = await Setting.findOne({ key: 'whatsapp_config' }).lean();

  try {
    await whatsappChannelService.sendText(whatsappConfig?.value || null, {
      to: phone,
      text: message,
    });
    return true;
  } catch {
    return false;
  }
};

const serializeUser = (user, planDetails = {}) => {
  const userObject = user?.toObject ? user.toObject() : { ...user };

  delete userObject.password;
  delete userObject.telegramLinkToken;
  delete userObject.telegramLinkTokenExpiresAt;

  const telegram = buildTelegramPayload(userObject);
  delete userObject.telegramChatId;
  delete userObject.telegramUsername;
  delete userObject.telegramDisplayName;
  delete userObject.telegramConnectedAt;

  return {
    ...userObject,
    telegram,
    signalEmailAlertsAvailable: config.notifications.signalEmailEnabled,
    ...planDetails,
  };
};

const register = catchAsync(async (req, res) => {
  // Check if phone/email is verified before creating account
  // Note: App should verify FIRST, then call register.
  // We can strictly enforce it here if we assume OTP flow is mandatory.
  if (req.body.phone && req.body.isPhoneVerified !== true) {
     // In a loose flow, we might trust the client or re-verify. 
     // For production strictness, we should check if the phone is marked verified in a temporary store or just trust the 'join' flow 
     // where the client claims it's verified. 
     // Better: The 'verifyOtp' endpoint should issue a temporary 'signup-token' or we trust the immediate register call.
     // For now, we'll assume the client sends the data and we rely on the OTP endpoints having been called.
     // A more robust way is to require a 'verificationId' from the verify step.
  }
  
  const user = await authService.createUser(req.body);
  res.status(201).send({
    user: serializeUser(user),
    message: 'Account created successfully. Verify your WhatsApp OTP to continue.',
  });
});

const sendOtp = catchAsync(async (req, res) => {
    const { type, identifier } = req.body;

    if (type === 'phone') {
        const normalizedIdentifier = normalizePhoneIdentifier(identifier);
        if (!normalizedIdentifier) {
            return res.status(httpStatus.BAD_REQUEST).send({ message: 'Identifier is required' });
        }

        const templateId = process.env.MSG91_OTP_TEMPLATE_ID;
        if (!templateId || String(templateId).trim().toLowerCase().includes('your_')) {
            return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Server config missing OTP Template' });
        }

        const success = await msg91Service.sendOtp(normalizedIdentifier, templateId);
        if (success) {
            await updateOtpAudit(resolvePhoneUserQuery(normalizedIdentifier), 'phone', maskPhone(normalizedIdentifier));
            res.send({ message: 'OTP sent successfully to phone', target: maskPhone(normalizedIdentifier), channel: 'phone' });
        } else {
            res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Failed to send OTP' });
        }
        return;
    }

    if (type === 'email') {
        const normalizedIdentifier = normalizeEmailIdentifier(identifier);
        if (!normalizedIdentifier) {
            return res.status(httpStatus.BAD_REQUEST).send({ message: 'Identifier is required' });
        }

        if (PREFER_WHATSAPP_OTP) {
            try {
                const context = await resolveWhatsappOtpContext(normalizedIdentifier);
                const key = `whatsapp_otp:${context.normalizedIdentifier}`;
                const dailyKey = `whatsapp_daily_count:${context.normalizedIdentifier}`;
                const dailyCount = await getDailyOtpCount(dailyKey);

                if (dailyCount >= OTP_DAILY_LIMIT) {
                    return res.status(httpStatus.TOO_MANY_REQUESTS).send({
                        message: `Daily OTP limit exceeded (${OTP_DAILY_LIMIT}/day). Please try again tomorrow.`,
                        dailyLimit: true,
                    });
                }

                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                await redisClient.set(key, otp, 'EX', OTP_TTL_SECONDS);

                const sent = await sendWhatsappOtpCode(context.recipientPhone, otp);
                if (sent) {
                    const newCount = await incrementDailyOtpCount(dailyKey);
                    await updateOtpAudit(context.userQuery, 'whatsapp', context.maskedTarget);

                    return res.send({
                        message: 'OTP sent successfully on WhatsApp',
                        dailyRemaining: OTP_DAILY_LIMIT - newCount,
                        target: context.maskedTarget,
                        channel: 'whatsapp',
                    });
                }
            } catch (error) {
                // Fall back to email delivery when WhatsApp routing is not possible.
            }
        }

        const key = `email_otp:${normalizedIdentifier}`;
        const dailyKey = `email_daily_count:${normalizedIdentifier}`;
        const dailyCount = await getDailyOtpCount(dailyKey);

        if (dailyCount >= OTP_DAILY_LIMIT) {
             return res.status(httpStatus.TOO_MANY_REQUESTS).send({
                 message: `Daily OTP limit exceeded (${OTP_DAILY_LIMIT}/day). Please try again tomorrow.`,
                 dailyLimit: true
             });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await redisClient.set(key, otp, 'EX', OTP_TTL_SECONDS);

        const sent = await emailService.sendEmailOtp(normalizedIdentifier, otp);

        if (sent) {
            const newCount = await incrementDailyOtpCount(dailyKey);
            await updateOtpAudit({ email: normalizedIdentifier }, 'email', maskEmail(normalizedIdentifier));

            res.send({
                message: 'OTP sent successfully to email',
                dailyRemaining: OTP_DAILY_LIMIT - newCount,
                target: maskEmail(normalizedIdentifier),
                channel: 'email',
            });
        } else {
            res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Failed to send OTP email' });
        }
        return;
    }

    if (type === 'whatsapp') {
        let context;
        try {
            context = await resolveWhatsappOtpContext(identifier);
        } catch (error) {
            return res.status(error.statusCode || httpStatus.BAD_REQUEST).send({ message: error.message });
        }

        const key = `whatsapp_otp:${context.normalizedIdentifier}`;
        const dailyKey = `whatsapp_daily_count:${context.normalizedIdentifier}`;
        const dailyCount = await getDailyOtpCount(dailyKey);

        if (dailyCount >= OTP_DAILY_LIMIT) {
            return res.status(httpStatus.TOO_MANY_REQUESTS).send({
                message: `Daily OTP limit exceeded (${OTP_DAILY_LIMIT}/day). Please try again tomorrow.`,
                dailyLimit: true,
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await redisClient.set(key, otp, 'EX', OTP_TTL_SECONDS);

        const sent = await sendWhatsappOtpCode(context.recipientPhone, otp);
        if (!sent) {
            return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
                message: 'Failed to send WhatsApp OTP. Please try again in a moment.',
            });
        }

        const newCount = await incrementDailyOtpCount(dailyKey);
        await updateOtpAudit(context.userQuery, 'whatsapp', context.maskedTarget);

        return res.send({
            message: 'OTP sent successfully on WhatsApp',
            dailyRemaining: OTP_DAILY_LIMIT - newCount,
            target: context.maskedTarget,
            channel: 'whatsapp',
        });
    }

    res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid type. Use "phone", "email", or "whatsapp"' });
});

const verifyOtp = catchAsync(async (req, res) => {
    const { type, identifier, otp } = req.body;

    if (!identifier || !otp) {
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'Identifier and OTP are required' });
    }

    if (type === 'phone') {
        const normalizedIdentifier = normalizePhoneIdentifier(identifier);
        const isValid = await msg91Service.verifyOtp(normalizedIdentifier, otp);
        if (isValid) {
            await User.updateOne(resolvePhoneUserQuery(normalizedIdentifier), { $set: { isPhoneVerified: true } });
            res.send({ message: 'Phone verified successfully', verified: true });
        } else {
            res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid OTP', verified: false });
        }
        return;
    }

    if (type === 'email') {
        const normalizedIdentifier = normalizeEmailIdentifier(identifier);
        const storedOtp = await redisClient.get(`email_otp:${normalizedIdentifier}`);
        if (storedOtp === otp) {
            await redisClient.del(`email_otp:${normalizedIdentifier}`);

            await User.updateOne(
                { email: normalizedIdentifier },
                { $set: { isEmailVerified: true } }
            );

            const verificationToken = tokenService.generateToken(
                normalizedIdentifier,
                Math.floor(Date.now() / 1000) + 900,
                'EMAIL_VERIFICATION'
            );

            res.send({
                message: 'Email verified successfully',
                verified: true,
                verificationToken,
            });
        } else {
            const storedWhatsappOtp = await redisClient.get(`whatsapp_otp:${normalizedIdentifier}`);
            if (storedWhatsappOtp === otp) {
                await redisClient.del(`whatsapp_otp:${normalizedIdentifier}`);

                await User.updateOne(
                    { email: normalizedIdentifier },
                    { $set: { isEmailVerified: true, isPhoneVerified: true } }
                );

                const verificationToken = tokenService.generateToken(
                    normalizedIdentifier,
                    Math.floor(Date.now() / 1000) + 900,
                    'EMAIL_VERIFICATION'
                );

                res.send({
                    message: 'WhatsApp OTP verified successfully',
                    verified: true,
                    verificationToken,
                    channel: 'whatsapp',
                });
            } else {
                res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid or expired OTP', verified: false });
            }
        }
        return;
    }

    if (type === 'whatsapp') {
        let context;
        try {
            context = await resolveWhatsappOtpContext(identifier);
        } catch (error) {
            return res.status(error.statusCode || httpStatus.BAD_REQUEST).send({ message: error.message, verified: false });
        }

        const storedOtp = await redisClient.get(`whatsapp_otp:${context.normalizedIdentifier}`);
        if (storedOtp !== otp) {
            return res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid or expired OTP', verified: false });
        }

        await redisClient.del(`whatsapp_otp:${context.normalizedIdentifier}`);

        if (context.userQuery) {
            await User.updateOne(
                context.userQuery,
                { $set: { isPhoneVerified: true, isEmailVerified: true } }
            );
        }

        const verificationSubject = context.email || context.normalizedIdentifier;
        const verificationToken = tokenService.generateToken(
            verificationSubject,
            Math.floor(Date.now() / 1000) + 900,
            'EMAIL_VERIFICATION'
        );

        return res.send({
            message: 'WhatsApp OTP verified successfully',
            verified: true,
            verificationToken,
            target: context.maskedTarget,
            channel: 'whatsapp',
        });
    }

    res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid type', verified: false });
});

const login = catchAsync(async (req, res) => {
  const { email, password, deviceId, ip: clientReportedIp } = req.body;
  // Destructure service response
  const { user, planDetails } = await authService.loginUserWithEmailAndPassword(email, password);
  const resolvedClientIp = resolveClientIp(req);
  const normalizedClientReportedIp =
    typeof clientReportedIp === 'string' && clientReportedIp.trim() ? clientReportedIp.trim() : null;
  const effectiveLoginIp =
    resolvedClientIp && !isLoopbackClientIp(resolvedClientIp)
      ? resolvedClientIp
      : (normalizedClientReportedIp || resolvedClientIp);
  
  // Single Session & IP Tracking Logic
  user.currentDeviceId = deviceId || 'unknown';
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.lastLoginIp = effectiveLoginIp;
  await user.save(); // Now works because 'user' is a Mongoose doc

  const tokens = await tokenService.generateAuthTokens(user);
  
  // Merge User + Plan Details for Frontend
  const responseUser = serializeUser(user, planDetails);

  res.send({ user: responseUser, token: tokens.access.token, expiresIn: 864000 });
});

const getMe = catchAsync(async (req, res) => {
    const planDetails = await authService.getUserActivePlan(req.user);
    const responseUser = serializeUser(req.user, planDetails);
    res.send(responseUser);
});

const updateMe = catchAsync(async (req, res) => {
    console.log('UpdateMe Hit. Body:', req.body);
    console.log('UpdateMe File:', req.file);
    const updateBody = req.body;
    delete updateBody.isNotificationEnabled;

    if (req.file) {
        updateBody.profile = updateBody.profile || {};
        updateBody.profile.avatar = req.file.path.replace(/\\/g, "/"); // Normalize path
    }
    const user = await userService.updateUserById(req.user.id, updateBody);
    const planDetails = await authService.getUserActivePlan(user);
    res.send(serializeUser(user, planDetails));
});

const logout = catchAsync(async (req, res) => {
    // Invalidate current access token by bumping token version.
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    req.user.currentDeviceId = null;
    await req.user.save();

    if (req.body && req.body.fcmToken) {
        await FCMToken.deleteOne({ token: req.body.fcmToken });
    } else if (req.body && req.body.platform) {
        const normalizedPlatform = String(req.body.platform).toLowerCase().trim();
        await FCMToken.deleteMany({ user: req.user._id, platform: normalizedPlatform });
    }

    res.status(httpStatus.OK).send({ message: 'Logged out successfully.' });
});

const changePassword = catchAsync(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    const isOldPasswordValid = await req.user.matchPassword(oldPassword);
    if (!isOldPasswordValid) {
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'Old password is incorrect.' });
    }

    req.user.password = newPassword;
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    req.user.currentDeviceId = null;
    await req.user.save();

    res.status(httpStatus.OK).send({ message: 'Password changed successfully. Please log in again.' });
});

export default {
  register,
  login,
  getMe,
  updateMe,
  changePassword,
  logout,
  sendOtp,
  verifyOtp,
};
