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

// Watchlist Templates (Admin)
router.get('/watchlist-templates', auth(['admin']), marketController.getWatchlistTemplates);
router.post('/watchlist-templates', auth(['admin']), marketController.createWatchlistTemplate);
router.patch('/watchlist-templates/:id', auth(['admin']), marketController.updateWatchlistTemplate);
router.delete('/watchlist-templates/:id', auth(['admin']), marketController.deleteWatchlistTemplate);

// Symbols
router.get('/symbols', marketController.getSymbols);
router.post('/symbols', marketController.createSymbol);
router.post('/symbols/:id/generate-id', marketController.generateSymbolId);
router.patch('/symbols/:id', marketController.updateSymbol);
router.delete('/symbols/:id', marketController.deleteSymbol);

router.get('/stats', auth(), marketController.getMarketStats); 
router.get('/tickers', auth(), marketController.getTickers); // Authenticated for Subscription Logic
router.get('/sentiment', auth(), marketController.getSentiment); // Authenticated for Context Awareness
router.get('/watchlists', auth(), marketController.getUserWatchlists);
router.post('/watchlists', auth(), marketController.createUserWatchlist);
router.patch('/watchlists/:id', auth(), marketController.updateUserWatchlist);
router.delete('/watchlists/:id', auth(), marketController.deleteUserWatchlist);
router.get('/watchlist', auth(), marketController.getUserWatchlist);
router.post('/watchlist/add', auth(), marketController.addUserWatchlist);
router.post('/watchlist/remove', auth(), marketController.removeUserWatchlist);
router.post('/watchlist/reorder', auth(), marketController.reorderUserWatchlist);
router.post('/login/:provider', marketController.handleLogin);
router.get('/login/:provider', marketController.handleLoginCallback); // Browser Redirect Callback
router.get('/login/:provider/url', marketController.getLoginUrl); // Generic Login URL
router.get('/history', marketController.getHistory);
router.get('/search', marketController.searchInstruments);
router.get('/analysis/:symbol', auth(), marketController.getSymbolAnalysis); 
router.get('/news/:symbol', auth(), marketController.getNews);
router.post('/sync', marketController.syncInstruments);

export default router;
