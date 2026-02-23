import Joi from 'joi';

const createStrategy = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    symbol: Joi.string().required(),
    timeframe: Joi.string().required().valid('1m', '5m', '15m', '1h', '4h', '1d'),
    action: Joi.string().valid('BUY', 'SELL', 'ALERT').required(),
    logic: Joi.object().keys({
      condition: Joi.string().valid('AND', 'OR').default('AND'),
      rules: Joi.array().items(
        Joi.object().keys({
          indicator: Joi.string().required(), // e.g., RSI
          params: Joi.object().required(), // e.g., { period: 14 }
          operator: Joi.string().valid('>', '<', '>=', '<=', '==', 'CROSS_ABOVE', 'CROSS_BELOW').required(),
          comparisonType: Joi.string().valid('VALUE', 'INDICATOR').default('VALUE'),
          value: Joi.alternatives().try(Joi.number(), Joi.object()).required() 
        })
      ).min(1).required()
    }).required()
  }),
};

const getStrategies = {
  query: Joi.object().keys({
    name: Joi.string(),
    symbol: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getStrategy = {
  params: Joi.object().keys({
    strategyId: Joi.string().required(), // Validate ObjectId format if needed
  }),
};

export default {
  createStrategy,
  getStrategies,
  getStrategy,
};
