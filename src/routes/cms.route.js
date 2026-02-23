import express from 'express';
import auth from '../middleware/auth.js';
import cmsController from '../controllers/cms.controller.js';

const router = express.Router();

// Pages (Public Read, Admin Write)
router
  .route('/pages/:slug')
  .get(cmsController.getPage)
  .post(auth(['admin']), cmsController.updatePage);

// FAQs (Public Read, Admin Write)
router
  .route('/faqs')
  .get(cmsController.getFAQs)
  .post(auth(['admin']), cmsController.createFAQ);

router
  .route('/faqs/:id')
  .patch(auth(['admin']), cmsController.updateFAQ)
  .delete(auth(['admin']), cmsController.deleteFAQ);

export default router;
