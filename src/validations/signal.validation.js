import Joi from 'joi';

const createSignal = {
  body: Joi.object().keys({
      symbol: Joi.string().required(),
      segment: Joi.string().valid('EQUITY', 'FNO', 'COMMODITY', 'CURRENCY').required(),
      type: Joi.string().valid('BUY', 'SELL').required(),
      entryPrice: Joi.number().required(), // Changed to number
      stopLoss: Joi.number().required(),
      targets: Joi.object().keys({
          target1: Joi.number().required(),
          target2: Joi.number(),
          target3: Joi.number()
      }).required(),
      isFree: Joi.boolean(),
      notes: Joi.string()
  })
};

const updateSignal = {
    params: Joi.object().keys({
        signalId: Joi.string().required()
    }),
    body: Joi.object().keys({
        status: Joi.string().valid('Active', 'Target Hit', 'Stoploss Hit', 'Closed'),
        notes: Joi.string()
    }).min(1)
};

const deleteSignal = {
    params: Joi.object().keys({
        signalId: Joi.string().required()
    })
};

export default {
  createSignal,
  updateSignal,
  deleteSignal
};
