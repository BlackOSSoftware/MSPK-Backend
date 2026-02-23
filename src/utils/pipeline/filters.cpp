// filters.cpp
// Compile: emcc filters.cpp -O3 -s WASM=1 -s SIDE_MODULE=1 -o filters.wasm

extern "C" {

    // Simple Noise Filter
    // Returns 1 if valid, 0 if noise
    int isValid(float price, float volume) {
        if (price <= 0) return 0;
        if (volume < 0) return 0;
        return 1;
    }

    // Significant Change Filter
    // Returns 1 if change > threshold %
    int isSignificant(float current, float last, float thresholdPercent) {
        if (last == 0) return 1;
        float diff = current - last;
        if (diff < 0) diff = -diff;
        
        float change = (diff / last) * 100.0;
        return (change >= thresholdPercent) ? 1 : 0;
    }

}
