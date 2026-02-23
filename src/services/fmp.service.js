import axios from 'axios';
import marketDataService from './marketData.service.js';
import logger from '../config/logger.js';

class FmpService {
    constructor() {
        this.baseUrl = 'https://financialmodelingprep.com/api/v3';
    }

    get apiKey() {
        return marketDataService.config.fmp_api_key;
    }

    /**
     * Get News for a specific symbol or general market
     * @param {String} symbol 
     * @param {Number} limit 
     */
    async getNews(symbol, limit = 10) {
        if (!this.apiKey) {
            logger.warn('FMP API Key not configured');
            return [];
        }

        try {
            let url = '';
            const baseUrl = 'https://financialmodelingprep.com/stable';

            if (symbol) {
                 // Asset Type Detection & Symbol Cleanup
                 let querySymbol = symbol;
                 // NSE:RELIANCE -> RELIANCE.NS
                 if (symbol.startsWith('NSE:')) querySymbol = symbol.replace('NSE:', '') + '.NS';
                 else if (symbol.startsWith('BSE:')) querySymbol = symbol.replace('BSE:', '') + '.BO';
                 
                 // Crypto detection (USDT -> USD)
                 let isCrypto = false;
                 if (symbol.includes('USDT') || (symbol.endsWith('USD') && !symbol.includes('.'))) {
                     isCrypto = true;
                     if (querySymbol.endsWith('USDT')) querySymbol = querySymbol.replace('USDT', 'USD');
                 }

                 let isForex = !isCrypto && !symbol.includes('.') && symbol.length === 6 && !symbol.startsWith('NSE');

                 if (isCrypto) {
                      // Crypto News Search
                      url = `${baseUrl}/news/crypto?symbols=${querySymbol}&limit=${limit}&apikey=${this.apiKey}`;
                 } else if (isForex) {
                      // Forex News Search
                      url = `${baseUrl}/news/forex?symbols=${querySymbol}&limit=${limit}&apikey=${this.apiKey}`;
                 } else {
                      // Stock News Search
                      url = `${baseUrl}/news/stock?symbols=${querySymbol}&limit=${limit}&apikey=${this.apiKey}`;
                 }
            } else {
                 // General News
                 url = `${baseUrl}/news/general-latest?limit=${limit}&apikey=${this.apiKey}`;
            }

            const response = await axios.get(url);
            return response.data;

        } catch (error) {
            logger.error(`FMP News Error for ${symbol}: ${error.message}`);
            if (error.response && error.response.data) {
                logger.error(`FMP Error Data: ${JSON.stringify(error.response.data)}`);
            }
            return [];
        }
    }
}

export default new FmpService();
