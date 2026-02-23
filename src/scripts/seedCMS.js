import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import Page from '../models/Page.js';
import FAQ from '../models/FAQ.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const seedData = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Clear existing data
        await Page.deleteMany({});
        await FAQ.deleteMany({});
        console.log('Cleared existing CMS data');

        // Seed Pages
        const pages = [
            {
                slug: 'terms',
                title: 'Terms & Conditions',
                content: `# Terms and Conditions

**Effective Date:** January 1, 2024

## 1. Introduction
Welcome to **MasterStroke**. By accessing or using our website, mobile application, or any of our services, you agree to be bound by these Terms and Conditions.

## 2. User Accounts
- You must create an account to access certain features.
- You are responsible for maintaining the confidentiality of your account credentials.
- We reserve the right to terminate accounts that violate our policies.

## 3. Trading Risks
**Warning:** Trading in financial markets involves a high degree of risk. 
- You may lose some or all of your invested capital.
- Our signals and analytics are for informational purposes only and do not constitute financial advice.

## 4. Limitation of Liability
We are not liable for any financial losses incurred while using our platform. Users trade at their own risk.

## 5. Changes to Terms
We may update these terms from time to time. Continued use of the platform constitutes acceptance of the new terms.`
            },
            {
                slug: 'privacy',
                title: 'Privacy Policy',
                content: `# Privacy Policy

**Last Updated:** January 1, 2024

## 1. Data Collection
We collect the following information:
- **Personal Information:** Name, email address, phone number.
- **Usage Data:** Login history, feature usage, and device information.

## 2. How We Use Your Data
- To provide and maintain our services.
- To notify you about changes to our service.
- To provide customer support.
- To monitor the usage of our service.

## 3. Data Security
We implement robust security measures to protect your data. However, no method of transmission over the Internet is 100% secure.

## 4. Third-Party Services
We may use third-party services (e.g., payment processors, analytics) that collect, monitor, and analyze this type of information.`
            },
            {
                slug: 'refund',
                title: 'Refund Policy',
                content: `# Refund Policy

## 1. Subscription Refunds
- **7-Day Money-Back Guarantee:** If you are not satisfied with our service, you may request a refund within 7 days of your initial purchase.
- **Pro-rata Refunds:** We do not offer pro-rata refunds for cancellations made mid-billing cycle.

## 2. How to Request a Refund
Please contact our support team at **support@masterstroke.com** with your transaction ID and reason for the refund request.

## 3. Processing Time
Refunds are typically processed within 5-7 business days and credited back to the original payment method.`
            },
            {
                slug: 'about',
                title: 'About Us',
                content: `# About MasterStroke

## Our Mission
To empower traders with state-of-the-art tools, real-time analytics, and actionable insights to master the financial markets.

## Who We Are
We are a team of financial experts, data scientists, and software engineers dedicated to democratizing access to institutional-grade trading technology.

## Why Choose Us?
- **Advanced Analytics:** Proprietary algorithms to identify market trends.
- **Real-Time Data:** Millisecond-latency data feeds.
- **Community:** A vibrant community of like-minded traders.

## Contact Us
- **Email:** support@masterstroke.com
- **Address:** 123 Trading Plaza, Fintech City, NY 10001`
            }
        ];

        await Page.insertMany(pages);
        console.log('Seeded Pages');

        // Seed FAQs
        const faqs = [
            {
                category: 'General',
                question: 'What is MasterStroke?',
                answer: 'MasterStroke is an advanced trading analytics platform that provides real-time market data, signals, and strategy tools for traders of all levels.',
                order: 1
            },
            {
                category: 'Account',
                question: 'How do I reset my password?',
                answer: 'You can reset your password by clicking on the "Forgot Password" link on the login page and following the instructions sent to your email.',
                order: 2
            },
            {
                category: 'Billing',
                question: 'What payment methods do you accept?',
                answer: 'We accept all major credit cards (Visa, MasterCard, Amex), PayPal, and select cryptocurrency payments.',
                order: 3
            },
            {
                category: 'Technical',
                question: 'Do you offer a mobile app?',
                answer: 'Yes, our mobile app is available for both iOS and Android devices. You can download it from the App Store or Google Play Store.',
                order: 4
            },
            {
                category: 'Trading',
                question: 'Are the trading signals guaranteed?',
                answer: 'No, trading signals are based on technical analysis and historical data. They are for informational purposes only and do not guarantee profits. Trading involves risk.',
                order: 5
            }
        ];

        await FAQ.insertMany(faqs);
        console.log('Seeded FAQs');

        console.log('Seeding completed successfully');
        process.exit(0);

    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
};

seedData();
