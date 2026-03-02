import Joi from 'joi';

const entrySignalSchema = Joi.object()
  .keys({
    event: Joi.string().valid('ENTRY').required(),
    unique_id: Joi.string().trim().min(1),
    uniqueId: Joi.string().trim().min(1),
    uniqe_id: Joi.string().trim().min(1),
    uniq_id: Joi.string().trim().min(1),
    symbol: Joi.string().trim().min(1).required(),
    segment: Joi.string().trim().min(1).required(),
    trade_type: Joi.string().valid('BUY', 'SELL').required(),
    timeframe: Joi.string().trim().min(1).required(),
    entry_price: Joi.number().required(),
    targets: Joi.object()
      .keys({
        t1: Joi.number().required(),
        t2: Joi.number(),
        t3: Joi.number(),
      })
      .required(),
    stop_loss: Joi.number().required(),
    signal_time: Joi.date().iso().required(),
  })
  .xor('unique_id', 'uniqueId', 'uniqe_id', 'uniq_id')
  .unknown(true);

const exitSignalSchema = Joi.object()
  .keys({
    event: Joi.string().valid('EXIT').required(),
    unique_id: Joi.string().trim().min(1),
    uniqueId: Joi.string().trim().min(1),
    uniqe_id: Joi.string().trim().min(1),
    uniq_id: Joi.string().trim().min(1),
    symbol: Joi.string().trim().min(1).required(),
    segment: Joi.string().trim().min(1).required(),
    exit_price: Joi.number().required(),
    total_points: Joi.number().required(),
    exit_reason: Joi.string().trim().min(1).required(),
    exit_time: Joi.date().iso().required(),
  })
  .xor('unique_id', 'uniqueId', 'uniqe_id', 'uniq_id')
  .unknown(true);

const receiveSignal = {
  body: Joi.alternatives().try(entrySignalSchema, exitSignalSchema),
};

export default {
  receiveSignal,
};
