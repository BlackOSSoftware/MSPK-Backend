import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import { redisSubscriber } from './redis.service.js';
import logger, { logEmitter } from '../config/logger.js';
import pipeline from '../utils/pipeline/DataPipeline.js';

// Re-subscribe to stats (moved from top)
redisSubscriber.subscribe('market_stats', (err) => {
  if (err) logger.error('Failed to subscribe to market_stats channel');
});

redisSubscriber.on('message', (channel, message) => {
  try {
    const data = JSON.parse(message);
    if (channel === 'market_stats') {
      // We need broadcastToAll which is defined later. 
      // We can't call it here if it's const.
      // We'll move this listener setup INTO initWebSocket or after definitions.
    }
  } catch (error) {
    logger.error('WebSocket Broadcast Error', error);
  }
});

let wss;
const rooms = new Map(); // Map<string, Set<WebSocket>>

const initWebSocket = (server) => {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    logger.debug('New WebSocket connection attempt');

    // Handle authentication
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (token) {
      jwt.verify(token, config.jwt.secret, async (err, decoded) => {
        if (err) {
          logger.error('WebSocket Auth Error:', err.message);
          ws.close(1008, 'Authentication failed');
          return;
        }
        ws.decoded = decoded;
        logger.debug(`WebSocket authenticated for user: ${decoded.sub || 'unknown'}`);

        // Perform Single Session & Auto-Subscription
        try {
          const { default: authService } = await import('./auth.service.js');
          const { default: User } = await import('../models/User.js');
          const { default: MasterSymbol } = await import('../models/MasterSymbol.js');

          const user = await User.findById(decoded.sub);
          if (!user) {
            ws.close(1008, 'User not found');
            return;
          }

          // 1. Single Session Verification
          if (user.tokenVersion && decoded.v !== user.tokenVersion) {
            logger.warn(`WS: Session mismatch for ${user.email}. Expected v:${user.tokenVersion}, got v:${decoded.v}`);
            ws.send(JSON.stringify({ type: 'error', payload: 'Session expired. Logged in on another device.' }));
            ws.close(1008, 'Session expired');
            return;
          }

          // 2. Auto-Subscribe to Plan Segments
          const planDetails = await authService.getUserActivePlan(user);
          const segments = authService.getSegmentsFromPermissions(planDetails.permissions);
          
          if (segments.length > 0) {
            const symbols = await MasterSymbol.find({ segment: { $in: segments }, isActive: true });
            const tickerNames = symbols.map(s => s.symbol);
            
            logger.info(`WS: Auto-subscribing user ${user.email} to ${tickerNames.length} symbols in segments: ${segments.join(', ')}`);
            
            tickerNames.forEach(sym => {
              subscribeToRoom(ws, sym);
            });

            // Send confirmation of active segments
            ws.send(JSON.stringify({ 
                type: 'subscription_sync', 
                payload: { segments, symbolCount: tickerNames.length } 
            }));
          } else {
             logger.info(`WS: User ${user.email} has no active plan segments to subscribe.`);
          }
        } catch (authErr) {
          logger.error('WS: Plan logic error during connection:', authErr.message);
        }
      });
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        const { type, payload } = data;

        switch (type) {
          case 'subscribe':
            subscribeToRoom(ws, payload?.toString().trim());
            break;
          case 'unsubscribe':
            unsubscribeFromRoom(ws, payload?.toString().trim());
            break;
          default:
            logger.warn(`Unknown message type: ${type}`);
        }
      } catch (error) {
        logger.error('WebSocket Message Error:', error.message);
      }
    });

    ws.on('close', () => {
      logger.debug('WebSocket connection closed');
      removeFromAllRooms(ws);
    });

    ws.on('error', (error) => {
      logger.error('WebSocket Error:', error.message);
      removeFromAllRooms(ws);
    });
  });

  // Keep-alive heartbeat
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  // --- PIPELINE & REDIS SETUP ---

  // 1. Start In-Memory Pipeline (Fast Path)
  pipeline.start((tick) => {
      // Use broadcastToRoom (defined below, but available at runtime)
      broadcastToRoom(tick.symbol, { type: 'tick', payload: tick });
  });

  // 2. Subscribe to Low-Freq Stats via Redis
  redisSubscriber.subscribe('market_stats', (err) => {
    if (err) logger.error('Failed to subscribe to market_stats channel');
  });

  // Note: market_data via Redis is DISABLED for performance (Pipeline is used). 
  // If scaling to multiple nodes, re-enable Redis or use Pipeline->Redis bridge.

  redisSubscriber.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);

      if (channel === 'market_stats') {
        broadcastToAll({ type: 'market_stats', payload: data });
      }
    } catch (error) {
      logger.error('WebSocket Broadcast Error', error);
    }
  });

  // Handle log broadcasting via emitter to avoid circular dependency
  logEmitter.on('log', (log) => {
    broadcastLog(log);
  });

  logger.info('WebSocket Server initialized (ws)');
  return wss;
};

const subscribeToRoom = async (ws, roomName) => {
  if (!roomName) return;
  const normalized = roomName.toString().trim().toLowerCase();
  if (!rooms.has(normalized)) {
    rooms.set(normalized, new Set());
  }
  rooms.get(normalized).add(ws);
  logger.info(`WebSocket: Room Subscribed -> [${normalized}] (Total: ${rooms.get(normalized).size} clients)`);

  // TICK REPLAY
  try {
    const { default: marketDataService } = await import('./marketData.service.js');
    // Case-insensitive lookup in currentPrices
    const prices = marketDataService.currentPrices || {};
    const exactSymbol = Object.keys(prices).find(s => s.toLowerCase() === normalized);
    
    if (exactSymbol && prices[exactSymbol]) {
       const price = prices[exactSymbol];
       const tick = {
           symbol: exactSymbol,
           price: price,
           last_price: price,
           timestamp: new Date().toISOString(),
           provider: 'cached'
       };
       if (ws.readyState === WebSocket.OPEN) {
           ws.send(JSON.stringify({ type: 'tick', payload: tick }));
       }
    }
  } catch (e) {
      // Passive fail
  }
};

const logActiveRooms = () => {
  if (rooms.size === 0) {
    logger.info('WebSocket: No active rooms.');
    return;
  }
  const summary = Array.from(rooms.entries()).map(([room, clients]) => `${room}(${clients.size})`).join(', ');
  logger.info(`WebSocket: Active Rooms -> [${summary}]`);
};

// Log room status every 30 seconds
setInterval(logActiveRooms, 30000);

const unsubscribeFromRoom = (ws, roomName) => {
  if (!roomName) return;
  const normalized = roomName.toString().trim().toLowerCase();
  if (!rooms.has(normalized)) return;
  rooms.get(normalized).delete(ws);
  if (rooms.get(normalized).size === 0) {
    rooms.delete(normalized);
  }
  logger.debug(`WebSocket unsubscribed from room: ${normalized}`);
};

const removeFromAllRooms = (ws) => {
  rooms.forEach((clients, roomName) => {
    if (clients.has(ws)) {
      clients.delete(ws);
      if (clients.size === 0) {
        rooms.delete(roomName);
      }
    }
  });
};

const broadcastToRoom = (roomName, data) => {
  const normalizedRoom = roomName?.toString().trim().toLowerCase();
  const clients = rooms.get(normalizedRoom);
  if (clients && clients.size > 0) {
    // logger.info(`WebSocket: Broadcasting to room [${normalizedRoom}] -> Type: [${data.type}] (Clients: ${clients.size})`);
    const message = JSON.stringify(data);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  } else {
    // logger.warn(`WebSocket: Broadcast attempt to EMPTY room [${normalizedRoom}] -> Type: [${data.type}]`);
  }
};

const broadcastToAll = (data) => {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

const getWss = () => {
  if (!wss) {
    throw new Error('WebSocket Server not initialized!');
  }
  return wss;
};

const broadcastLog = (log) => {
  broadcastToAll({ type: 'system_log', payload: log });
};

const sendToUser = (userId, data) => {
  if (!wss) return;
  const message = JSON.stringify(data);
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.decoded && client.decoded.sub === userId) {
      client.send(message);
      count++;
    }
  });
  if (count > 0) {
    logger.info(`WebSocket: Sent targeted message to User [${userId}] (Clients: ${count})`);
  } else {
    logger.debug(`WebSocket: User [${userId}] not connected for targeted message`);
  }
};

export {
  initWebSocket,
  getWss,
  broadcastToRoom,
  broadcastToAll,
  broadcastLog,
  sendToUser
};
