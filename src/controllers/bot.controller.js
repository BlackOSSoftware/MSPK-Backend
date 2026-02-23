import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { signalService } from '../services/index.js';
import { broadcastToAll } from '../services/websocket.service.js';

const getStatus = catchAsync(async (req, res) => {
    // In a real system, this would come from a database or Redis
    // For now, we return a mock status or the last set status
    const status = global.BOT_STATUS || 'OFF';
    res.send({ status });
});

const toggleBot = catchAsync(async (req, res) => {
    const { status } = req.body; // 'ON' or 'OFF'
    global.BOT_STATUS = status;
    
    // Broadcast status change
    broadcastToAll({ type: 'bot_status', payload: { status } });

    res.send({ status: global.BOT_STATUS, message: `Bot turned ${status}` });
});

export default {
    getStatus,
    toggleBot
};
