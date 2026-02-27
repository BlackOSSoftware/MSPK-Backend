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

const changePassword = {
  body: Joi.object().keys({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().required().min(6),
    confirmNewPassword: Joi.string().required().valid(Joi.ref('newPassword')),
  }),
};

const updateProfile = {
    body: Joi.object().keys({
        name: Joi.string(),
        phone: Joi.string(),
        profile: Joi.object().keys({
            avatar: Joi.string().uri(),
            address: Joi.string(),
            city: Joi.string(),
            state: Joi.string()
        })
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
  changePassword,
  updateProfile,
  sendOtp,
  verifyOtp
};
