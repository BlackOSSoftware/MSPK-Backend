import Joi from 'joi';

const createPlan = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    description: Joi.string(),
    segment: Joi.string().required().valid('EQUITY', 'FNO', 'COMMODITY', 'CURRENCY'),
    price: Joi.number().required(),
    durationDays: Joi.number().integer().required(),
    features: Joi.array().items(Joi.string()),
    isActive: Joi.boolean(),
    isDemo: Joi.boolean()
  }),
};

const getPlans = {
  query: Joi.object().keys({
    role: Joi.string(), // To filter inactive if needed manually
  }),
};

const getPlan = {
  params: Joi.object().keys({
    planId: Joi.string().required(), // Check ObjectId regex if needed
  }),
};

const updatePlan = {
  params: Joi.object().keys({
    planId: Joi.string().required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      description: Joi.string(),
      segment: Joi.string().valid('EQUITY', 'FNO', 'COMMODITY', 'CURRENCY'),
      price: Joi.number(),
      durationDays: Joi.number().integer(),
      features: Joi.array().items(Joi.string()),
      isActive: Joi.boolean(),
      isDemo: Joi.boolean()
    })
    .min(1),
};

export default {
  createPlan,
  getPlans,
  getPlan,
  updatePlan,
};
