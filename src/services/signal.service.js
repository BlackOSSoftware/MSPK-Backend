import Signal from '../models/Signal.js';
import announcementService from './announcement.service.js';
import logger from '../config/log.js';
import { broadcastToAll } from './websocket.service.js';

const mapSignalToCategory = (signalBody) => {
  const { symbol, segment } = signalBody;
  const sym = symbol ? symbol.toUpperCase() : '';
  const seg = segment ? segment.toUpperCase() : '';

  // 1. High Priority: Crypto Detection (USDT pairs)
  if (sym.includes('USDT') || sym.includes('USD') && (seg === 'CRYPTO' || seg === 'BINANCE')) return 'CRYPTO';

  if (sym.includes('NIFTY') && !sym.includes('BANK') && !sym.includes('FIN')) return 'NIFTY_OPT';
  if (sym.includes('BANKNIFTY')) return 'BANKNIFTY_OPT';
  if (sym.includes('FINNIFTY')) return 'FINNIFTY_OPT';
  if (seg === 'MCX' || seg === 'COMMODITY') return 'MCX_FUT';
  if (seg === 'CDS' || seg === 'CURRENCY') return 'CURRENCY';
  if (seg === 'CRYPTO') return 'CRYPTO';
  if (seg === 'EQ' || seg === 'EQUITY') return 'EQUITY_INTRA'; // Default to Intra
  
  return 'EQUITY_INTRA'; // Fallback
};

const signalCreationGuard = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  for (const [key, timestamp] of signalCreationGuard.entries()) {
    if (timestamp < fiveMinutesAgo) {
      signalCreationGuard.delete(key);
    }
  }
}, 5 * 60 * 1000);

const createSignal = async (signalBody, user) => {
  // Normalize symbol for consistent matching
  const normalizedSymbol = signalBody.symbol?.toUpperCase().trim();
  const normalizedPrice = Math.round(parseFloat(signalBody.entryPrice) * 100) / 100; // Round to 2 decimals
  
  // Global Deduplication Guard (Prevent identical signals in 5 minutes)
  const dedupKey = `${normalizedSymbol}_${signalBody.type}_${normalizedPrice}`;
  const now = Date.now();
  
  if (signalCreationGuard.has(dedupKey)) {
    const lastCreated = signalCreationGuard.get(dedupKey);
    const timeSinceLastSignal = now - lastCreated;
    
    // Block if created within last 5 minutes (300 seconds)
    if (timeSinceLastSignal < 300000) {
      logger.warn(`[SIGNAL_GUARD] Blocking duplicate signal for ${dedupKey} (${Math.round(timeSinceLastSignal/1000)}s ago)`);
      return null;
    }
  }
  
  signalCreationGuard.set(dedupKey, now);

  // Auto-map category if missing
  if (!signalBody.category) {
      signalBody.category = mapSignalToCategory(signalBody);
  }

  const signal = await Signal.create({ ...signalBody, createdBy: user.id });
  
  // Create Announcement for the Feed
  try {
      const tpDetails = [
          signal.targets?.target1 ? `TP1: ${signal.targets.target1}` : null,
          signal.targets?.target2 ? `TP2: ${signal.targets.target2}` : null,
          signal.targets?.target3 ? `TP3: ${signal.targets.target3}` : null
      ].filter(t => t).join(' | ');

      await announcementService.createAnnouncement({
          title: `🚀 New Signal: ${signal.symbol} ${signal.type}`,
          message: `Entry: ${signal.entryPrice}\n${tpDetails}\nSL: ${signal.stopLoss}`,
          type: 'SIGNAL',
          priority: 'NORMAL',
          targetAudience: { role: 'all', planValues: [] },
          isActive: true
      });
  } catch (e) {
      logger.error('Failed to create announcement for signal', e);
  }

  // Publish to Redis for Notification Service
  try {
      const { redisClient } = await import('./redis.service.js');
      // Payload for notification service
      const payload = JSON.stringify({ 
          ...signal.toJSON(), 
          user: user.id,
          subType: 'SIGNAL_NEW'  // Explicitly tell worker to use New Signal Template
      }); 
      await redisClient.publish('signals', payload);
      logger.info(`Published new signal ${signal.id} to Redis 'signals' channel`);
  } catch (e) {
      logger.error('Failed to publish signal to Redis', e);
  }
  
  return signal;
};

const querySignals = async (filter, options) => {
  const page = options.page ? parseInt(options.page) : 1;
  const limit = options.limit ? parseInt(options.limit) : 10;
  const skip = (page - 1) * limit;

  const [totalResults, results] = await Promise.all([
    Signal.countDocuments(filter),
    Signal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
  ]);

  const totalPages = Math.ceil(totalResults / limit);

  return {
    results,
    page,
    limit,
    totalPages,
    totalResults
  };
};

const getSignalStats = async () => {
  const stats = await Signal.aggregate([
    {
      $group: {
        _id: null,
        totalSignals: { $sum: 1 },
        activeSignals: {
          $sum: {
            $cond: [{ $in: ["$status", ["Open", "Active", "Paused"]] }, 1, 0]
          }
        },
        closedSignals: {
          $sum: {
            $cond: [{ $eq: ["$status", "Closed"] }, 1, 0]
          }
        },
        targetHit: {
          $sum: {
            $cond: [{ $eq: ["$status", "Target Hit"] }, 1, 0]
          }
        },
        stoplossHit: {
          $sum: {
            $cond: [{ $eq: ["$status", "Stoploss Hit"] }, 1, 0]
          }
        }
      }
    }
  ]);

  const data = stats[0] || { totalSignals: 0, activeSignals: 0, closedSignals: 0, targetHit: 0, stoplossHit: 0 };
  
  // Success Rate = (Target Hit) / (Target Hit + Stoploss Hit) * 100
  // Or (Target Hit) / (Total Closed) ? Usually Target vs SL.
  const outcomes = data.targetHit + data.stoplossHit;
  const successRate = outcomes > 0 ? Math.round((data.targetHit / outcomes) * 100) : 0;

  return {
    ...data,
    successRate
  };
};

const updateSignalById = async (signalId, updateBody) => {
  const signal = await Signal.findById(signalId);
  if (!signal) {
     throw new Error('Signal not found');
  }
  // Auto-map category on update if segment/symbol changed or category missing
  if ((updateBody.symbol || updateBody.segment) && !updateBody.category) {
     // Merge current signal data with updates to map correctly
     const merged = { ...signal.toObject(), ...updateBody };
     updateBody.category = mapSignalToCategory(merged);
  } else if (!signal.category && !updateBody.category) {
      // First time mapping for legacy signals
      updateBody.category = mapSignalToCategory(signal);
  }

  Object.assign(signal, updateBody);
  
  // Status update broadcast
  if (updateBody.status || updateBody.notes) {
       try {
           broadcastToAll({ type: 'update_signal', payload: signal });

          // Notification Logic
          const { redisClient } = await import('./redis.service.js');
          let subType = null;
          let notificationData = { ...signal.toJSON() }; // Use signal.toJSON() for full refreshed document

          if (updateBody.status === 'Target Hit') {
              subType = 'SIGNAL_TARGET';
              notificationData.targetLevel = 'TP1'; // Logic to detect which target? usually TP1
          } else if (updateBody.status === 'Stoploss Hit') {
              subType = 'SIGNAL_STOPLOSS';
          } else if (updateBody.notes || updateBody.status) {
              // Generic Update
              subType = 'SIGNAL_UPDATE';
              notificationData.updateMessage = updateBody.notes || `Status changed to ${updateBody.status}`;
          }

          if (subType) {
              await redisClient.publish('signals', JSON.stringify({
                  ...notificationData,
                  subType
              }));
              logger.info(`Published ${subType} notification for signal ${signalId}`);
          }

      } catch (e) {
          logger.error('Failed to emit socket/redis event for update signal', e);
      }
  }

  await signal.save();
  return signal;
};

const deleteSignalById = async (signalId) => {
  const signal = await Signal.findById(signalId);
  if (!signal) {
    throw new Error('Signal not found');
  }
  await signal.deleteOne();
  return signal;
};

export default {
  createSignal,
  querySignals,
  getSignalStats,
  updateSignalById,
  deleteSignalById,
};
