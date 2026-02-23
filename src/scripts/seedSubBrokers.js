import mongoose from 'mongoose';
import SubBroker from '../models/SubBroker.js';
import process from 'node:process';

// Load env vars (Node 20+ style, assuming --env-file usage or pre-loaded)
// If running directly with node, use: node --env-file=.env src/scripts/seedSubBrokers.js
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URL || 'mongodb://localhost:27017/mspk_trading';

const seedSubBrokers = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB for Seeding...');

        // Clear existing SubBrokers
        await SubBroker.deleteMany({});
        console.log('Cleared existing SubBrokers.');

        const demoSubBrokers = [
            {
                name: "Rahul Verma",
                email: "rahul.verma@example.com",
                phone: "+91 9876543210",
                company: "Verma Financials",
                location: "Mumbai, Maharashtra",
                brokerId: "SB-1001",
                telegramId: "@rahul_invest",
                commission: { type: 'PERCENTAGE', value: 20 },
                status: 'Active',
                createdAt: new Date('2024-01-15')
            },
            {
                name: "Amit Singh",
                email: "amit.singh@example.com",
                phone: "+91 9812345678",
                company: "Singh Traders",
                location: "Delhi, NCR",
                brokerId: "SB-1002",
                telegramId: "@singh_trader",
                commission: { type: 'FIXED', value: 500 },
                status: 'Active',
                createdAt: new Date('2024-02-10')
            },
            {
                name: "Priya Sharma",
                email: "priya.sharma@example.com",
                phone: "+91 9988776655",
                company: "Priya Wealth Mgmt",
                location: "Bangalore, Karnataka",
                brokerId: "SB-1003",
                commission: { type: 'PERCENTAGE', value: 25 },
                status: 'Active',
                createdAt: new Date('2024-03-05')
            },
            {
                name: "Vikram Das",
                email: "vikram.das@example.com",
                phone: "+91 8877665544",
                company: "Das Capital",
                location: "Kolkata, West Bengal",
                brokerId: "SB-1004",
                commission: { type: 'PERCENTAGE', value: 15 },
                status: 'Blocked',
                createdAt: new Date('2023-11-20')
            },
             {
                name: "Sneha Patel",
                email: "sneha.patel@example.com",
                phone: "+91 7766554433",
                company: "Patel Investments",
                location: "Ahmedabad, Gujarat",
                brokerId: "SB-1005",
                commission: { type: 'FIXED', value: 1000 },
                status: 'Active',
                createdAt: new Date('2024-04-01')
            }
        ];

        await SubBroker.insertMany(demoSubBrokers);
        console.log(`Seeded ${demoSubBrokers.length} SubBrokers successfully.`);

        process.exit(0);
    } catch (error) {
        console.error('Seeding Failed:', error);
        process.exit(1);
    }
};

seedSubBrokers();
