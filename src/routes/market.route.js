import express from 'express';
import marketController from '../controllers/market.controller.js';
import auth from '../middleware/auth.js';  // Uncommented/Added 

const router = express.Router();

// Public routes for now (or protect them as needed)
router.post('/seed', marketController.seedMarketData);

// Segments
router.get('/segments', marketController.getSegments);
router.post('/segments', marketController.createSegment);
router.patch('/segments/:id', marketController.updateSegment);
router.delete('/segments/:id', marketController.deleteSegment);

// Symbols
router.get('/symbols', marketController.getSymbols);
router.post('/symbols', marketController.createSymbol);
router.patch('/symbols/:id', marketController.updateSymbol);
router.delete('/symbols/:id', marketController.deleteSymbol);

router.get('/stats', auth(), marketController.getMarketStats); 
router.get('/tickers', auth(), marketController.getTickers); // Authenticated for Subscription Logic
router.get('/sentiment', auth(), marketController.getSentiment); // Authenticated for Context Awareness
router.post('/login/:provider', marketController.handleLogin);
router.get('/login/:provider', marketController.handleLoginCallback); // Browser Redirect Callback
router.get('/login/:provider/url', marketController.getLoginUrl); // Generic Login URL
router.get('/history', marketController.getHistory);
router.get('/search', marketController.searchInstruments);
router.get('/analysis/:symbol', auth(), marketController.getSymbolAnalysis); 
router.get('/news/:symbol', auth(), marketController.getNews);
router.post('/sync', marketController.syncInstruments);

export default router;
