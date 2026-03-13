import Joi from 'joi';

const segmentValue = Joi.string().trim().uppercase().min(1);

const createPlan = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    description: Joi.string(),
    segment: segmentValue.optional(),
    segments: Joi.array().items(segmentValue).min(1),
    permissions: Joi.array().items(Joi.string().trim().uppercase().min(1)),
    price: Joi.number().required(),
    durationDays: Joi.number().integer().required(),
    features: Joi.array().items(Joi.string()),
    isActive: Joi.boolean(),
    isDemo: Joi.boolean(),
    isCustom: Joi.boolean()
  }).or('segment', 'segments'),
};

const getPlans = {
  query: Joi.object().keys({
    role: Joi.string(), // To filter inactive if needed manually
    includeCustom: Joi.boolean(),
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
      segment: segmentValue,
      segments: Joi.array().items(segmentValue).min(1),
      permissions: Joi.array().items(Joi.string().trim().uppercase().min(1)),
      price: Joi.number(),
      durationDays: Joi.number().integer(),
      features: Joi.array().items(Joi.string()),
      isActive: Joi.boolean(),
      isDemo: Joi.boolean(),
      isCustom: Joi.boolean()
    })
    .min(1),
};

export default {
  createPlan,
  getPlans,
  getPlan,
  updatePlan,
};
