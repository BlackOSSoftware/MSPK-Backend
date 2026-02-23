import Joi from 'joi';

const register = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().min(6), // custom regex if needed
    name: Joi.string().required(),
    phone: Joi.string().optional(),
    referralCode: Joi.string().optional(),
  }),
};

const login = {
  body: Joi.object().keys({
    email: Joi.string().required(),
    password: Joi.string().required(),
    deviceId: Joi.string().optional(),
    ip: Joi.string().optional(),
    sessionId: Joi.string().optional(),
  }),
};

const updateProfile = {
    body: Joi.object().keys({
        name: Joi.string(),
        phone: Joi.string(),
        isWhatsAppEnabled: Joi.boolean(),
        isNotificationEnabled: Joi.boolean(),
        profile: Joi.object().keys({
            avatar: Joi.string().uri(),
            address: Joi.string(),
            city: Joi.string(),
            state: Joi.string()
        })
    }).min(1)
};

const updateKyc = {
    body: Joi.object().keys({
        panCard: Joi.string().uri(),
        aadhaarCard: Joi.string().uri()
    }).min(1)
};

const sendOtp = {
    body: Joi.object().keys({
        type: Joi.string().required().valid('phone', 'email'),
        identifier: Joi.string().required(),
    }),
};

const verifyOtp = {
    body: Joi.object().keys({
        type: Joi.string().required().valid('phone', 'email'),
        identifier: Joi.string().required(),
        otp: Joi.string().required().min(4).max(6),
    }),
};

export default {
  register,
  login,
  updateProfile,
  updateKyc,
  sendOtp,
  verifyOtp
};
