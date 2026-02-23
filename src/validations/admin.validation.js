import Joi from 'joi';

const objectId = (value, helpers) => {
  if (!value.match(/^[0-9a-fA-F]{24}$/)) {
    return helpers.message('"{{#label}}" must be a valid mongo id');
  }
  return value;
};

const createUser = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().min(6),
    name: Joi.string().required(),
    phone: Joi.string().optional().allow(''),
    role: Joi.string().required().valid('user', 'admin', 'sub-broker'),
    
    // Trading / Admin Fields
    clientId: Joi.string().optional().allow(''),
    equity: Joi.number().optional().min(0),
    walletBalance: Joi.number().optional().min(0),
    subBrokerId: Joi.string().custom(objectId).optional().allow(null, ''),
    
    // Subscription
    planId: Joi.string().custom(objectId).optional().allow(null, ''),
    
    status: Joi.string().valid('Active', 'Inactive', 'Suspended').default('Active'),
  }),
};

const updateUser = {
  params: Joi.object().keys({
      userId: Joi.required().custom(objectId),
  }),
  body: Joi.object().keys({
      email: Joi.string().email(),
      password: Joi.string().min(6), // Optional update
      name: Joi.string(),
      phone: Joi.string().allow(''),
      role: Joi.string().valid('user', 'admin', 'sub-broker'),
      clientId: Joi.string().allow(''),
      equity: Joi.number().min(0),
      walletBalance: Joi.number().min(0),
      subBrokerId: Joi.string().custom(objectId).allow(null, ''),
      planId: Joi.string().custom(objectId).allow(null, ''), // Allow switching plan
      status: Joi.string().valid('Active', 'Inactive', 'Suspended', 'Blocked', 'Liquidated'), // Includes new statuses
  }).min(1), // Require at least 1 field to update
};

export default {
  createUser,
  updateUser
};
