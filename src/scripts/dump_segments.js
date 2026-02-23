import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Segment from '../models/Segment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mspk_trading');
        console.log('MongoDB Connected');
    } catch (err) {
        console.error('MongoDB Connection Error:', err);
        process.exit(1);
    }
};

const dumpSegments = async () => {
    await connectDB();
    try {
        const segments = await Segment.find({});
        console.log(`Found ${segments.length} segments.`);
        if (segments.length > 0) {
            console.log(JSON.stringify(segments, null, 2));
        } else {
            console.log("No segments found in 'segments' collection.");
        }
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

dumpSegments();
