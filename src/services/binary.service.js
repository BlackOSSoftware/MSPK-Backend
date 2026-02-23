import { BinaryProtocol, SharedRegistry } from '../mplktrading/src/utils/BinaryProtocol.js'; 
// Note: Imports across frontend/backend folders in this repo structure (monorepo-ish?) might depend on build tool.
// Assuming CommonJS for Node backend, but code used 'export'.
// I will rewrite BinaryProtocol to be Universal (CommonJS/ESM hybrid or just CommonJS if backend is CommonJS).
// Checking previous file... it ends in .js. It used `export const`. Node might fail if type != module.
// User context: "nodemon server.js". Usually CommonJS.
// I will write this service to use standard require/module.exports pattern OR standard import if ESM enabled.
// Looking at 'marketData.service.js' earlier... it used `class MarketDataService` but imports were not shown in snippets.
// Let's assume ESM since client side is React (ESM). If backend is also ESM (type: module in package.json), we are good.
// If backend is CommonJS, `import` will fail.
// SAFER BET: Use a dedicated backend version if needed or assume ESM if 'server.js' supports it.
// Given 'nodemon server.js', it's likely Node.
// Retrying with CommonJS compatible syntax for the UTIL if needed?
// Actually, earlier snippets showed `import ... from ...` so ESM is likely used in backend too. I will stick to ESM.

// Wait, the path to `BinaryProtocol` needs to be correct.
// `e:\mspk_trading_backend\mspktrading\src\utils\BinaryProtocol.js` is Frontend.
// Backend seems to be `e:\mspk_trading_backend\src\...`.
// I should duplicate the utility or symlink it.
// Requirement: "Symbol mapping service".
// I will create `src/services/binary.service.js` in BACKEND. 
// AND I will create a COPY of `BinaryProtocol.js` in BACKEND `src/utils/BinaryProtocol.js` to avoid path issues.

import { BinaryProtocol, SharedRegistry } from '../utils/BinaryProtocol.js';

class BinaryService {
    constructor() {
        this.protocol = new BinaryProtocol(SharedRegistry);
    }

    // Register a symbol and return its ID (called on startup for all symbols)
    registerSymbol(symbol) {
        return this.protocol.registry.register(symbol);
    }

    encodeTick(tick) {
        try {
            return this.protocol.encodeTick(
                tick.symbol,
                tick.last_price || tick.price,
                tick.volume,
                tick.bid || 0,
                tick.ask || 0,
                Math.floor(Date.now() / 1000)
            );
        } catch (e) {
            console.error('Binary Encode Error:', e.message);
            return null;
        }
    }

    encodeBatch(ticks) {
        try {
            // Ensure all are registered
            ticks.forEach(t => this.protocol.registry.register(t.symbol));
            return this.protocol.encodeBatch(ticks);
        } catch (e) {
            return null;
        }
    }
    
    getMappingMessage(symbol) {
        return this.protocol.encodeMapping(symbol);
    }
}

export const binaryService = new BinaryService();
export default binaryService;
