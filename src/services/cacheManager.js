import fs from 'fs';
import path from 'path';
import { redisClient } from './redis.service.js';
import logger from '../config/logger.js';

const CACHE_DIR = path.join(process.cwd(), 'temp', 'cache');

// Ensure Cache Dir Exists
if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch (e) {
        logger.warn(`Failed to create cache dir: ${e.message}`);
    }
}

class CacheManager {
    constructor() {
        // L1: Memory
        this.memoryCache = new Map();
        this.memoryTTL = 5 * 60 * 1000; // 5 Minutes
        
        // Stats
        this.stats = {
            l1Calls: 0, l1Hits: 0,
            l2Calls: 0, l2Hits: 0,
            l3Calls: 0, l3Hits: 0,
            misses: 0
        };

        // Periodic Cleanup (L1)
        setInterval(() => this.cleanupMemory(), 60 * 1000);
    }

    /**
     * Primary API: Get from cache or Fetch new data
     * @param {string} key - Cache Key
     * @param {Function} fetchFunction - Async function to fetch data if miss
     * @param {string} ttlType - '5m', '1h', '24h' (Default '5m')
     */
    async getOrFetch(key, fetchFunction, ttlType = '5m') {
        const value = await this.get(key);
        if (value) return value;

        // FETCH
        try {
            const data = await fetchFunction();
            if (data) {
                await this.set(key, data, ttlType);
            }
            return data;
        } catch (e) {
            throw e;
        }
    }

    /**
     * Cascading Read: L1 -> L2 -> L3
     */
    async get(key) {
        // 1. L1 Memory
        this.stats.l1Calls++;
        if (this.memoryCache.has(key)) {
            const entry = this.memoryCache.get(key);
            if (entry.expiry > Date.now()) {
                this.stats.l1Hits++;
                return entry.val;
            } else {
                this.memoryCache.delete(key);
            }
        }

        // 2. L2 Redis
        this.stats.l2Calls++;
        try {
            const redisVal = await redisClient.get(key);
            if (redisVal) {
                const parsed = JSON.parse(redisVal);
                this.stats.l2Hits++;
                // Populate L1
                this.setMemory(key, parsed, 60 * 1000); // 1 min hot cache
                return parsed;
            }
        } catch (e) { /* Ignore Redis Errors */ }

        // 3. L3 Disk (Only for History keys usually)
        // We generally assume keys starting with 'history_' or similar are disk-worthy
        // But here we check everything or selective?
        // Let's check everything for simplicity, FS check is fast enough compared to API
        this.stats.l3Calls++;
        const filePath = path.join(CACHE_DIR, `${key}.json`);
        if (fs.existsSync(filePath)) {
            try {
                // Check stats for TTL? FS doesn't natively expire. 
                // We rely on file mtime.
                const stat = fs.statSync(filePath);
                const age = Date.now() - stat.mtimeMs;
                
                // 24 Hours default for Disk
                if (age < 24 * 60 * 60 * 1000) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const parsed = JSON.parse(content);
                    this.stats.l3Hits++;
                    // Populate L1 & L2
                    this.setMemory(key, parsed, 5 * 60 * 1000);
                    // We skip back-filling Redis to save bandwidth? Or fill it?
                    // Fill Redis for faster access next time
                    this.setRedis(key, parsed, 3600);
                    return parsed;
                } else {
                    // Expired
                    fs.unlinkSync(filePath);
                }
            } catch (e) { /* Ignore FS Errors */ }
        }

        this.stats.misses++;
        return null;
    }

    /**
     * Cascading Write: L1, L2, L3 (Selective)
     */
    async set(key, value, ttlType = '5m') {
        let ttlSeconds = 300; // 5m
        if (ttlType === '1h') ttlSeconds = 3600;
        if (ttlType === '24h') ttlSeconds = 86400;

        // 1. L1
        this.setMemory(key, value, Math.min(ttlSeconds * 1000, this.memoryTTL));

        // 2. L2
        this.setRedis(key, value, ttlSeconds);

        // 3. L3 (Disk) - Only if long TTL (Historical)
        if (ttlSeconds >= 3600) { // 1h+ worthy of disk
            try {
                const filePath = path.join(CACHE_DIR, `${key}.json`);
                fs.writeFileSync(filePath, JSON.stringify(value));
            } catch (e) {
                // Disk full or perm error
            }
        }
    }

    setMemory(key, val, ttlMs) {
        this.memoryCache.set(key, { val, expiry: Date.now() + ttlMs });
        // LRU Protection
        if (this.memoryCache.size > 2000) {
            const keys = this.memoryCache.keys();
            for (let i = 0; i < 100; i++) this.memoryCache.delete(keys.next().value);
        }
    }

    async setRedis(key, val, ttlSeconds) {
        try {
            await redisClient.set(key, JSON.stringify(val), 'EX', ttlSeconds);
        } catch (e) {}
    }

    cleanupMemory() {
        const now = Date.now();
        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.expiry < now) this.memoryCache.delete(key);
        }
    }

    getStats() {
        return this.stats;
    }

    /**
     * Invalidate Real-Time Data for a Symbol
     * useful when a new tick arrives, we might want to clear cached 'Quote'
     */
    async invalidateOnWebSocket(symbol) {
        // Pattern match? 
        // We construct proper keys: `quote_${symbol}`
        const key = `quote_${symbol}`;
        this.memoryCache.delete(key);
        // Redis delete? 
        try {
            await redisClient.del(key);
        } catch (e) {}
        
        // Note: We don't delete History keys usually, just Quotes
    }
}

export default new CacheManager();
