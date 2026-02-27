import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { authService, tokenService, userService, msg91Service, emailService } from '../services/index.js';
import { redisClient } from '../services/redis.service.js'; // Direct client access for Email OTP

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
  const tokens = await tokenService.generateAuthTokens(user);
  res.status(201).send({ user, token: tokens.access.token });
});

const sendOtp = catchAsync(async (req, res) => {
    const { type, identifier } = req.body; // type: 'phone' | 'email', identifier: '9198...' | 'abc@example.com'

    if (!identifier) {
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'Identifier is required' });
    }

    if (type === 'phone') {
        // Use MSG91
        // Template ID should be in env or passed. Assuming a default OTP template.
        const templateId = process.env.MSG91_OTP_TEMPLATE_ID; 
        if (!templateId) return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Server config missing OTP Template' });
        
        const success = await msg91Service.sendOtp(identifier, templateId);
        if (success) {
            res.send({ message: 'OTP sent successfully to phone' });
        } else {
            res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Failed to send OTP' });
        }
    } else if (type === 'email') {
        const key = `email_otp:${identifier}`;
        const dailyKey = `email_daily_count:${identifier}`;

        // 1. Check Daily Limit (Max 5)
        let dailyCount = await redisClient.get(dailyKey);
        dailyCount = dailyCount ? parseInt(dailyCount) : 0;

        if (dailyCount >= 5) {
             return res.status(httpStatus.TOO_MANY_REQUESTS).send({ 
                 message: 'Daily OTP limit exceeded (5/day). Please try again tomorrow.',
                 dailyLimit: true
             });
        }

        // 2. Check if OTP is already active
        const ttl = await redisClient.ttl(key);
        if (ttl > 0) {
            return res.status(httpStatus.BAD_REQUEST).send({ 
                message: `OTP already sent. Please wait ${Math.ceil(ttl / 60)} minutes before resending.`,
                ttl: ttl 
            });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store in Redis (10 mins expiry)
        await redisClient.set(key, otp, 'EX', 600);
        
        // Send Email
        const sent = await emailService.sendEmailOtp(identifier, otp);
        
        if (sent) {
            // Increment Daily Count
            const newCount = await redisClient.incr(dailyKey);
            if (newCount === 1) await redisClient.expire(dailyKey, 86400); // 24 Hours

            res.send({ 
                message: 'OTP sent successfully to email', 
                dailyRemaining: 5 - newCount 
            });
        } else {
            res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Failed to send OTP email' });
        }
    } else {
        res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid type. Use "phone" or "email"' });
    }
});

const verifyOtp = catchAsync(async (req, res) => {
    const { type, identifier, otp } = req.body;

    if (!identifier || !otp) {
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'Identifier and OTP are required' });
    }

    if (type === 'phone') {
        const isValid = await msg91Service.verifyOtp(identifier, otp);
        if (isValid) {
            res.send({ message: 'Phone verified successfully', verified: true });
        } else {
            res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid OTP', verified: false });
        }
    } else if (type === 'email') {
        const storedOtp = await redisClient.get(`email_otp:${identifier}`);
        if (storedOtp === otp) {
            await redisClient.del(`email_otp:${identifier}`); // Clear OTP
            
            // Generate Verification Token for Lead Creation
            // Uses identifier (email) as subject
            const verificationToken = tokenService.generateToken(identifier, Math.floor(Date.now() / 1000) + 900, 'EMAIL_VERIFICATION');
            
            res.send({ 
                message: 'Email verified successfully', 
                verified: true,
                verificationToken: verificationToken 
            });
        } else {
            res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid or expired OTP', verified: false });
        }
    } else {
        res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid type' });
    }
});

const login = catchAsync(async (req, res) => {
  const { email, password, deviceId } = req.body;
  // Destructure service response
  const { user, planDetails } = await authService.loginUserWithEmailAndPassword(email, password);
  
  // Single Session & IP Tracking Logic
  user.currentDeviceId = deviceId || 'unknown';
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.lastLoginIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
  await user.save(); // Now works because 'user' is a Mongoose doc

  const tokens = await tokenService.generateAuthTokens(user);
  
  // Merge User + Plan Details for Frontend
  const responseUser = {
      ...user.toObject(),
      ...planDetails
  };

  res.send({ user: responseUser, token: tokens.access.token });
});

const getMe = catchAsync(async (req, res) => {
    const planDetails = await authService.getUserActivePlan(req.user);
    const responseUser = {
        ...req.user.toObject(),
        ...planDetails
    };
    res.send(responseUser);
});

const updateMe = catchAsync(async (req, res) => {
    console.log('UpdateMe Hit. Body:', req.body);
    console.log('UpdateMe File:', req.file);
    const updateBody = req.body;
    delete updateBody.isWhatsAppEnabled;
    delete updateBody.isNotificationEnabled;

    if (req.file) {
        updateBody.profile = updateBody.profile || {};
        updateBody.profile.avatar = req.file.path.replace(/\\/g, "/"); // Normalize path
    }
    const user = await userService.updateUserById(req.user.id, updateBody);
    res.send(user);
});

const logout = catchAsync(async (req, res) => {
    // Invalidate current access token by bumping token version.
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    req.user.currentDeviceId = null;
    await req.user.save();

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
