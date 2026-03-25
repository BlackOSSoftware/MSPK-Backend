import Joi from 'joi';

const timeframeFieldSchema = Joi.alternatives().try(Joi.string().trim().min(1), Joi.number());
const timeframeFieldNames = ['timeframe', 'timeFrame', 'time_frame', 'interval', 'resolution', 'chart_interval', 'chartInterval'];
const webhookTimestampFieldSchema = Joi.date().iso().raw();

const entrySignalSchema = Joi.object()
  .keys({
    event: Joi.string().valid('ENTRY').required(),
    unique_id: Joi.string().trim().min(1),
    uniqueId: Joi.string().trim().min(1),
    uniqe_id: Joi.string().trim().min(1),
    uniq_id: Joi.string().trim().min(1),
    symbol: Joi.string().trim().min(1),
    symbolId: Joi.string().trim().min(1),
    symbol_id: Joi.string().trim().min(1),
    masterSymbolId: Joi.string().trim().min(1),
    master_symbol_id: Joi.string().trim().min(1),
    segment: Joi.string().trim().min(1),
    trade_type: Joi.string().valid('BUY', 'SELL').required(),
    timeframe: timeframeFieldSchema,
    timeFrame: timeframeFieldSchema,
    time_frame: timeframeFieldSchema,
    interval: timeframeFieldSchema,
    resolution: timeframeFieldSchema,
    chart_interval: timeframeFieldSchema,
    chartInterval: timeframeFieldSchema,
    entry_price: Joi.number().required(),
    targets: Joi.object()
      .keys({
        t1: Joi.number().required(),
        t2: Joi.number(),
        t3: Joi.number(),
      })
      .required(),
    stop_loss: Joi.number().required(),
    signal_time: webhookTimestampFieldSchema.required(),
  })
  .or('symbol', 'symbolId', 'symbol_id', 'masterSymbolId', 'master_symbol_id')
  .or(...timeframeFieldNames)
  .xor('unique_id', 'uniqueId', 'uniqe_id', 'uniq_id')
  .unknown(true);

const exitSignalSchema = Joi.object()
  .keys({
    event: Joi.string().valid('EXIT').required(),
    unique_id: Joi.string().trim().min(1),
    uniqueId: Joi.string().trim().min(1),
    uniqe_id: Joi.string().trim().min(1),
    uniq_id: Joi.string().trim().min(1),
    symbol: Joi.string().trim().min(1),
    symbolId: Joi.string().trim().min(1),
    symbol_id: Joi.string().trim().min(1),
    masterSymbolId: Joi.string().trim().min(1),
    master_symbol_id: Joi.string().trim().min(1),
    segment: Joi.string().trim().min(1),
    timeframe: timeframeFieldSchema,
    timeFrame: timeframeFieldSchema,
    time_frame: timeframeFieldSchema,
    interval: timeframeFieldSchema,
    resolution: timeframeFieldSchema,
    chart_interval: timeframeFieldSchema,
    chartInterval: timeframeFieldSchema,
    trade_type: Joi.string().valid('BUY', 'SELL', 'EXIT_BUY', 'EXIT_SELL'),
    exit_price: Joi.number().required(),
    total_points: Joi.number().required(),
    exit_reason: Joi.string().trim().min(1).required(),
    exit_time: webhookTimestampFieldSchema.required(),
  })
  .or('symbol', 'symbolId', 'symbol_id', 'masterSymbolId', 'master_symbol_id')
  .xor('unique_id', 'uniqueId', 'uniqe_id', 'uniq_id')
  .unknown(true);

const infoSignalSchema = Joi.object()
  .keys({
    event: Joi.string().valid('INFO').required(),
    unique_id: Joi.string().trim().min(1),
    uniqueId: Joi.string().trim().min(1),
    uniqe_id: Joi.string().trim().min(1),
    uniq_id: Joi.string().trim().min(1),
    symbol: Joi.string().trim().min(1),
    symbolId: Joi.string().trim().min(1),
    symbol_id: Joi.string().trim().min(1),
    masterSymbolId: Joi.string().trim().min(1),
    master_symbol_id: Joi.string().trim().min(1),
    segment: Joi.string().trim().min(1),
    timeframe: timeframeFieldSchema,
    timeFrame: timeframeFieldSchema,
    time_frame: timeframeFieldSchema,
    interval: timeframeFieldSchema,
    resolution: timeframeFieldSchema,
    chart_interval: timeframeFieldSchema,
    chartInterval: timeframeFieldSchema,
    message: Joi.string().trim().min(1).required(),
    trade_type: Joi.string().valid('BUY', 'SELL').required(),
    price: Joi.number().required(),
    time: webhookTimestampFieldSchema.required(),
  })
  .or('symbol', 'symbolId', 'symbol_id', 'masterSymbolId', 'master_symbol_id')
  .xor('unique_id', 'uniqueId', 'uniqe_id', 'uniq_id')
  .unknown(true);

const receiveSignal = {
  body: Joi.alternatives().try(entrySignalSchema, infoSignalSchema, exitSignalSchema),
};

export default {
  receiveSignal,
};
