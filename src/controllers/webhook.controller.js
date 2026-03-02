import httpStatus from 'http-status';
import mongoose from 'mongoose';
import Signal from '../models/Signal.js';
import catchAsync from '../utils/catchAsync.js';
import { signalService } from '../services/index.js';
import config from '../config/config.js';

const normalizeSymbol = (symbol) => String(symbol || '').trim().toUpperCase();

const stripDerivativeSuffix = (symbol) => normalizeSymbol(symbol).replace(/(\.P|PERP)$/i, '');

const isCryptoLikeSymbol = (symbol) => {
  const sym = stripDerivativeSuffix(symbol);
  if (!sym) return false;

  // Common stable/crypto quotes
  if (sym.includes('USDT') || sym.includes('USDC') || sym.includes('BUSD')) return true;

  // Heuristic: <BASE>USD where BASE is not a fiat/commodity code
  if (sym.endsWith('USD') && sym.length > 3) {
    const base = sym.slice(0, -3);
    const fiatBases = new Set([
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'AUD',
      'CAD',
      'CHF',
      'NZD',
      'INR',
      'SGD',
      'HKD',
      'CNY',
      'CNH',
      'SEK',
      'NOK',
      'DKK',
      'ZAR',
      'RUB',
      'TRY',
      'MXN',
      'BRL',
      'KRW',
      'PLN',
      'THB',
      'IDR',
      'MYR',
      'PHP',
      'VND',
      'TWD',
      'SAR',
      'AED',
      'QAR',
      'KWD',
      'BHD',
      'OMR',
      'ILS',
    ]);
    const nonCryptoCommodities = new Set(['XAU', 'XAG', 'XTI', 'XBR']);

    if (fiatBases.has(base) || nonCryptoCommodities.has(base)) return false;
    return base.length >= 2 && base.length <= 10;
  }

  return false;
};

const normalizeSegment = (segment) => {
  if (!segment) return segment;
  const seg = String(segment).trim().toUpperCase();

  // Keep exchange codes as-is (NSE/NFO/MCX/CDS/BCD/BINANCE etc).
  // Only normalize a few common aliases to their canonical exchange code.
  if (['FO', 'FNO', 'NSEFO', 'NSE_FO', 'NSE-FNO', 'NSE-F&O'].includes(seg)) return 'NFO';
  if (seg === 'CM') return 'NSE';
  if (seg === 'CUR') return 'CURRENCY';

  return seg;
};

const normalizeTimeframe = (timeframe) => {
  if (timeframe === null || timeframe === undefined) return timeframe;
  const tf = String(timeframe).trim();
  if (!tf) return tf;
  // If sender sends "1" / "5" etc, interpret as minutes.
  if (/^\d+$/.test(tf)) return `${tf}m`;
  return tf;
};

const parseBoolean = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value !== 'string') return undefined;

  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return undefined;
};

const buildEntryUniqueId = ({ webhookId, symbol, tradeType, timeframe, entryPrice, signalTime }) => {
  const idParts = [
    'ENTRY',
    webhookId ? String(webhookId).trim() : '',
    normalizeSymbol(symbol),
    String(tradeType || '').trim().toUpperCase(),
    String(timeframe || '').trim(),
    entryPrice !== undefined && entryPrice !== null ? String(entryPrice) : '',
    String(signalTime || '').trim(),
  ];

  return idParts.join('|');
};

const receiveSignal = catchAsync(async (req, res) => {
  const event = String(req.body.event || '').trim().toUpperCase();
  const webhookId = req.body.uniq_id || req.body.unique_id || req.body.uniqueId || req.body.uniqe_id;
  const symbol = normalizeSymbol(req.body.symbol);
  const incomingSegment = normalizeSegment(req.body.segment);
  const segment = isCryptoLikeSymbol(symbol) ? 'BINANCE' : incomingSegment;
  const isFreeFromPayload = parseBoolean(req.body.is_free ?? req.body.isFree ?? req.body.free);
  const isFree = isFreeFromPayload ?? config.env === 'development';

  const findSignalByWebhookId = async (webhookId) => {
    if (!webhookId) return null;
    const id = String(webhookId).trim();

    // 1) If webhook sends our MongoDB _id
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byId = await Signal.findById(id);
      if (byId) return byId;
    }

    // 2) Find latest non-closed signal for this webhookId+symbol
    if (symbol) {
      const byWebhook = await Signal.findOne({
        webhookId: id,
        symbol,
        status: { $nin: ['Closed', 'Target Hit', 'Stoploss Hit'] },
      }).sort({ createdAt: -1 });
      if (byWebhook) return byWebhook;

      // 3) If already closed (idempotent EXIT), match on exit_time
      if (req.body.exit_time) {
        const byClosed = await Signal.findOne({
          webhookId: id,
          symbol,
          exitTime: new Date(req.body.exit_time),
        }).sort({ createdAt: -1 });
        if (byClosed) return byClosed;
      }
    }

    return null;
  };

  const mapExitReasonToStatus = (reason) => {
    const r = String(reason || '').trim().toUpperCase();
    if (r.includes('TARGET')) return 'Target Hit';
    if (r.includes('STOP') || r.includes('SL')) return 'Stoploss Hit';
    return 'Closed';
  };

  if (event === 'EXIT') {
    const existing = await findSignalByWebhookId(webhookId);
    if (!existing) {
      return res.status(httpStatus.OK).send({ status: 'not_found', uniq_id: webhookId, symbol });
    }

    const desiredStatus = mapExitReasonToStatus(req.body.exit_reason);
    const incomingExitTime = new Date(req.body.exit_time);
    const isNumberClose = (a, b, eps = 1e-6) => {
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      return Math.abs(a - b) <= eps;
    };

    const alreadyApplied =
      existing.exitTime &&
      existing.status === desiredStatus &&
      existing.exitReason === req.body.exit_reason &&
      isNumberClose(existing.exitPrice, req.body.exit_price) &&
      isNumberClose(existing.totalPoints, req.body.total_points) &&
      new Date(existing.exitTime).getTime() === incomingExitTime.getTime();

    if (alreadyApplied) {
      return res.status(httpStatus.OK).send({ status: 'ok', signal: existing });
    }

    const updateBody = {
      exitPrice: req.body.exit_price,
      totalPoints: req.body.total_points,
      exitReason: req.body.exit_reason,
      exitTime: req.body.exit_time,
      status: desiredStatus,
    };

    const updated = await signalService.updateSignalById(existing.id, updateBody);
    return res.status(httpStatus.OK).send({ status: 'ok', signal: updated });
  }

  const signalBody = {
    uniqueId: buildEntryUniqueId({
      webhookId,
      symbol,
      tradeType: req.body.trade_type,
      timeframe: normalizeTimeframe(req.body.timeframe),
      entryPrice: req.body.entry_price,
      signalTime: req.body.signal_time,
    }),
    webhookId,
    symbol,
    segment,
    type: req.body.trade_type,
    timeframe: normalizeTimeframe(req.body.timeframe),
    entryPrice: req.body.entry_price,
    stopLoss: req.body.stop_loss,
    targets: {
      target1: req.body.targets?.t1,
      target2: req.body.targets?.t2,
      target3: req.body.targets?.t3,
    },
    signalTime: req.body.signal_time,
    isFree,
    status: 'Active',
  };

  // Upsert behavior for ENTRY webhooks: if the same `uniqueId` arrives again with updated fields,
  // update the existing signal instead of returning stale data.
  const existingByUniqueId = await Signal.findOne({ uniqueId: signalBody.uniqueId }).sort({ createdAt: -1 });
  if (existingByUniqueId) {
    const updateBody = {
      webhookId: signalBody.webhookId,
      symbol: signalBody.symbol,
      segment: signalBody.segment,
      type: signalBody.type,
      timeframe: signalBody.timeframe,
      entryPrice: signalBody.entryPrice,
      stopLoss: signalBody.stopLoss,
      targets: signalBody.targets,
      signalTime: signalBody.signalTime,
      isFree: signalBody.isFree,
    };

    const updated = await signalService.updateSignalById(existingByUniqueId.id, updateBody);
    return res.status(httpStatus.OK).send({ status: 'ok', signal: updated, updatedExisting: true });
  }

  const created = await signalService.createSignal(signalBody, null);

  // signalService has an in-memory 5m dedup guard that can return null.
  if (!created) {
    const afterGuard = await Signal.findOne({ uniqueId: signalBody.uniqueId });
    return res.status(httpStatus.OK).send({ status: 'duplicate_blocked', signal: afterGuard || null });
  }

  return res.status(httpStatus.OK).send({ status: 'ok', signal: created });
});

export default {
  receiveSignal,
};
