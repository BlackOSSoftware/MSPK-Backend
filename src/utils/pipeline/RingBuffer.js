export class RingBuffer {
    constructor(capacity = 10000) {
        this.capacity = capacity;
        // Float32Array for structured data? 
        // Ticks have Symbol(string), Price, Vol, Time.
        // Mixed types. Pointer array is fastest in JS for mixed objects, 
        // but TypedArray is better for memory if we serialize.
        // User target: "Memory < 100MB buffer".
        // 100k ticks * 100 bytes = 10MB.
        // We will use a cyclic array of Objects for flexibility first, 
        // optimization to Structs if needed. JS Engine optimizes object pools well.
        
        this.buffer = new Array(capacity);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }

    push(item) {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) {
            this.size++;
        } else {
            this.tail = (this.tail + 1) % this.capacity; // Overwrite oldest
        }
    }

    pop() {
        if (this.size === 0) return null;
        const item = this.buffer[this.tail];
        this.buffer[this.tail] = null; // Help GC
        this.tail = (this.tail + 1) % this.capacity;
        this.size--;
        return item;
    }

    peek() {
        if (this.size === 0) return null;
        return this.buffer[this.tail];
    }

    isEmpty() {
        return this.size === 0;
    }
    
    clear() {
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }
}
