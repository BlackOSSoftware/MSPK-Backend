const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const AdminSetting = require('../models/AdminSetting');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mspk_trading');
        console.log('MongoDB Connected');
    } catch (err) {
        console.error('MongoDB Connection Error:', err);
        process.exit(1);
    }
};

const checkSegments = async () => {
    await connectDB();
    try {
        const settings = await AdminSetting.findOne();
        if (!settings) {
            console.log('No AdminSettings found!');
        } else {
            console.log('AdminSettings Found.');
            console.log('Segments Count:', settings.segments ? settings.segments.length : 0);
            if (settings.segments) {
                console.log(JSON.stringify(settings.segments, null, 2));
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

checkSegments();
