import mongoose from 'mongoose';
import dotenv from 'dotenv';
import MasterSymbol from './src/models/MasterSymbol.js';

dotenv.config();

const cryptoSymbols = [
    { base: 'BTC', name: 'Bitcoin' },
    { base: 'ETH', name: 'Ethereum' },
    { base: 'BNB', name: 'Binance Coin' },
    { base: 'XRP', name: 'Ripple' },
    { base: 'SOL', name: 'Solana' },
    { base: 'TRX', name: 'TRON' },
    { base: 'DOGE', name: 'Dogecoin' },
    { base: 'ADA', name: 'Cardano' },
    { base: 'USDC', name: 'USDC' },
    { base: 'USDT', name: 'Tether' }
];

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        let addedCount = 0;
        let skippedCount = 0;

        for (const item of cryptoSymbols) {
            // 1. Spot
            const spotSymbol = item.base === 'USDT' ? 'USDTUSD' : `${item.base}USDT`;
            const spotExists = await MasterSymbol.findOne({ symbol: spotSymbol });
            
            if (!spotExists) {
                await MasterSymbol.create({
                    symbol: spotSymbol,
                    name: `${item.name} / Spot`,
                    segment: 'CRYPTO',
                    exchange: 'BINANCE',
                    lotSize: 1,
                    tickSize: 0.00001,
                    isActive: true,
                    isWatchlist: false
                });
                addedCount++;
            } else {
                skippedCount++;
            }

            // 2. Perpetual Future
            const futSymbol = `${item.base}USDT.P`;
            const futExists = await MasterSymbol.findOne({ symbol: futSymbol });
            
            if (!futExists) {
                await MasterSymbol.create({
                    symbol: futSymbol,
                    name: `${item.name} / Perpetual Fut`,
                    segment: 'CRYPTO',
                    exchange: 'BINANCE_FUTURES',
                    lotSize: 1,
                    tickSize: 0.00001,
                    isActive: true,
                    isWatchlist: false
                });
                addedCount++;
            } else {
                skippedCount++;
            }
        }

        console.log(`Crypto Migration complete.`);
        console.log(`Added: ${addedCount}`);
        console.log(`Skipped: ${skippedCount}`);

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

run();
