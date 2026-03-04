import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import MasterSymbol from './src/models/MasterSymbol.js';
import MasterSegment from './src/models/MasterSegment.js';

dotenv.config();

const SEGMENT_MAP = {
    forex: 'CURRENCY',
    currency: 'CURRENCY',
    crypto: 'CRYPTO',
    commodity: 'COMMODITY',
    index: 'INDICES',
    stock: 'EQUITY',
    etf: 'EQUITY',
    future: 'COMMODITY'
};

const SEGMENT_SEED = [
    { code: 'EQUITY', name: 'Equity' },
    { code: 'INDICES', name: 'Indices' },
    { code: 'COMMODITY', name: 'Commodity' },
    { code: 'CURRENCY', name: 'Currency' },
    { code: 'CRYPTO', name: 'Crypto' }
];

function mapExchange(segment) {
    if (segment === 'CURRENCY') return 'FOREX';
    if (segment === 'CRYPTO') return 'CRYPTO';
    if (segment === 'COMMODITY') return 'FOREX';
    if (segment === 'INDICES') return 'FOREX';
    return 'GLOBAL';
}

async function seedSegments() {
    await Promise.all(
        SEGMENT_SEED.map((segment) =>
            MasterSegment.updateOne(
                { code: segment.code },
                {
                    $set: {
                        name: segment.name,
                        code: segment.code,
                        isActive: true,
                    },
                },
                { upsert: true }
            )
        )
    );
}

async function run() {
    try {
        const inputPath = process.argv[2]
            || process.env.BROKER_SYMBOLS_PATH
            || path.join(process.cwd(), '..', 'market-data', 'BROKER_SYMBOLS_SEGMENTS.json');

        if (!fs.existsSync(inputPath)) {
            throw new Error(`File not found: ${inputPath}`);
        }

        const raw = fs.readFileSync(inputPath, 'utf8');
        const parsed = JSON.parse(raw);
        const symbols = Array.isArray(parsed.symbols) ? parsed.symbols : [];

        console.log(`Loaded ${symbols.length} broker symbols from ${inputPath}`);

        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI is missing in environment');
        }

        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        await seedSegments();

        let upserted = 0;
        let skipped = 0;

        for (const item of symbols) {
            const sourceSymbol = String(item.symbol || '').trim();
            if (!sourceSymbol) {
                skipped += 1;
                continue;
            }

            const symbol = sourceSymbol.toUpperCase();
            const baseSegment = String(item.segment || 'stock').toLowerCase();
            const segment = SEGMENT_MAP[baseSegment] || 'EQUITY';
            const exchange = mapExchange(segment);

            const doc = {
                symbol,
                name: String(item.description || sourceSymbol).trim(),
                segment,
                exchange,
                lotSize: Number(item?.trading?.contract_size) || 1,
                tickSize: Number(item?.pricing?.tick_size) || Number(item?.pricing?.point) || 0.01,
                isActive: true,
                isWatchlist: false,
                provider: 'market_data',
                sourceSymbol,
                subsegment: item.subsegment || null,
                region: item.region || null,
                meta: {
                    broker_group: item.broker_group || null,
                    currencies: item.currencies || null,
                    pricing: item.pricing || null,
                    trading: item.trading || null,
                    tags: item.tags || [],
                },
            };

            const result = await MasterSymbol.updateOne(
                { symbol },
                { $set: doc },
                { upsert: true }
            );

            if (result.upsertedCount || result.modifiedCount) {
                upserted += 1;
            } else {
                skipped += 1;
            }
        }

        console.log(`Import complete. Upserted: ${upserted}, Skipped: ${skipped}`);
        process.exit(0);
    } catch (error) {
        console.error('Import failed:', error.message || error);
        process.exit(1);
    }
}

run();
