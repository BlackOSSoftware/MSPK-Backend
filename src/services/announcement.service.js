import Announcement from '../models/Announcement.js';
import notificationService from './notification.service.js';

/**
 * Create a announcement
 * @param {Object} announcementBody
 * @returns {Promise<Announcement>}
 */
const createAnnouncement = async (announcementBody) => {
  const announcement = await Announcement.create(announcementBody);
  
  // Check if it should trigger immediate notification
  // Active AND Start Date is Past/Present
  const now = new Date();
  const isImmediatelyActive = announcement.isActive && 
      (!announcement.startDate || new Date(announcement.startDate) <= now);

  console.log(`[DEBUG-LIVE] Announcement Created: ID=${announcement._id}`);
  console.log(`[DEBUG-LIVE] isActive=${announcement.isActive}, startDate=${announcement.startDate}, now=${now}`);
  console.log(`[DEBUG-LIVE] isImmediatelyActive=${isImmediatelyActive}, isNotificationSent=${announcement.isNotificationSent}`);

  if (isImmediatelyActive && !announcement.isNotificationSent) {
      console.log('[DEBUG-LIVE] Triggering Immediate Notification (Creation)...');
      // Fire and forget notification (or await if critical)
      notificationService.scheduleAnnouncementNotifications(announcement).catch(err => {
          console.error('[DEBUG-LIVE] Initial Notification Trigger Failed', err);
      });
      
      // Update flag
      announcement.isNotificationSent = true;
      await announcement.save();
  } else {
      console.log('[DEBUG-LIVE] Notification skipped on Creation (Scheduled for later).');
  }

  return announcement;
};

/**
 * Query for announcements
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
const queryAnnouncements = async (filter, options) => {
  const page = options.page ? parseInt(options.page) : 1;
  const limit = options.limit ? parseInt(options.limit) : 20;
  const skip = (page - 1) * limit;

  const [totalResults, results] = await Promise.all([
    Announcement.countDocuments(filter),
    Announcement.find(filter).sort({ startDate: -1 }).skip(skip).limit(limit)
  ]);

  const totalPages = Math.ceil(totalResults / limit);

  return {
    results,
    page,
    limit,
    totalPages,
    totalResults
  };
};

/**
 * Get announcement by id
 * @param {ObjectId} id
 * @returns {Promise<Announcement>}
 */
const getAnnouncementById = async (id) => {
  return Announcement.findById(id);
};

/**
 * Update announcement by id
 * @param {ObjectId} announcementId
 * @param {Object} updateBody
 * @returns {Promise<Announcement>}
 */
const updateAnnouncementById = async (announcementId, updateBody) => {
  const announcement = await getAnnouncementById(announcementId);
  if (!announcement) {
    throw new Error('Announcement not found');
  }
  Object.assign(announcement, updateBody);
  
  // Trigger notification if newly activated or updated while active and unsent
  const now = new Date();
  const isImmediatelyActive = announcement.isActive && 
      (!announcement.startDate || new Date(announcement.startDate) <= now);

  console.log(`[DEBUG-LIVE] Announcement Update: ID=${announcement._id}`);
  console.log(`[DEBUG-LIVE] isActive=${announcement.isActive}, startDate=${announcement.startDate}, now=${now}`);
  console.log(`[DEBUG-LIVE] isImmediatelyActive=${isImmediatelyActive}, isNotificationSent=${announcement.isNotificationSent}`);

  if (isImmediatelyActive && !announcement.isNotificationSent) {
      console.log('[DEBUG-LIVE] Triggering Immediate Notification...');
      notificationService.scheduleAnnouncementNotifications(announcement).catch(err => {
          console.error('[DEBUG-LIVE] Update Notification Trigger Failed', err);
      });
      announcement.isNotificationSent = true;
  } else {
      console.log('[DEBUG-LIVE] Notification skipped (Scheduled for later or already sent).');
  }

  await announcement.save();
  return announcement;
};

/**
 * Delete announcement by id
 * @param {ObjectId} announcementId
 * @returns {Promise<Announcement>}
 */
const deleteAnnouncementById = async (announcementId) => {
  const announcement = await getAnnouncementById(announcementId);
  if (!announcement) {
    throw new Error('Announcement not found');
  }
  await announcement.deleteOne();
  return announcement;
};

export default {
  createAnnouncement,
  queryAnnouncements,
  getAnnouncementById,
  updateAnnouncementById,
  deleteAnnouncementById,
};
