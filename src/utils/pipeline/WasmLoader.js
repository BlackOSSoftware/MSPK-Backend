import fs from 'fs';
import path from 'path';

class WasmLoader {
    constructor() {
        this.instance = null;
        this.isReady = false;
        this.init();
    }

    async init() {
        try {
            const wasmPath = path.resolve(__dirname, 'filters.wasm');
            if (fs.existsSync(wasmPath)) {
                const buffer = fs.readFileSync(wasmPath);
                const module = await WebAssembly.compile(buffer);
                this.instance = await WebAssembly.instantiate(module);
                this.isReady = true;
                console.log('[Pipeline] WASM Filter Loaded');
            } else {
                console.log('[Pipeline] filters.wasm not found, using JS fallback');
            }
        } catch (e) {
            console.error('[Pipeline] WASM Load Error:', e);
        }
    }

    isValid(price, volume) {
        if (this.isReady && this.instance) {
            return this.instance.exports.isValid(price, volume) === 1;
        }
        // Fallback
        return price > 0 && volume >= 0;
    }
}

export default new WasmLoader();
