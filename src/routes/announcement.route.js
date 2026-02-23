import express from 'express';
import announcementController from '../controllers/announcement.controller.js';

const router = express.Router();

router
  .route('/export')
  .get(announcementController.exportAnnouncements);

router
  .route('/')
  .post(announcementController.createAnnouncement)
  .get(announcementController.getAnnouncements);

router
  .route('/:announcementId')
  .get(announcementController.getAnnouncement)
  .patch(announcementController.updateAnnouncement)
  .delete(announcementController.deleteAnnouncement);

export default router;
