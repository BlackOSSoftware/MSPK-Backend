import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { announcementService } from '../services/index.js';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import Announcement from '../models/Announcement.js';

const createAnnouncement = catchAsync(async (req, res) => {
  const announcement = await announcementService.createAnnouncement(req.body);
  res.status(httpStatus.CREATED).send(announcement);
});

const getAnnouncements = catchAsync(async (req, res) => {
  const { status, type, priority } = req.query;
  const now = new Date();

  const filter = {};
  if (type) filter.type = type;
  if (priority) filter.priority = priority;

  // Status filtering logic
  if (status === 'active') {
    filter.isActive = true;
    filter.startDate = { $lte: now };
    filter.$or = [{ endDate: { $exists: false } }, { endDate: { $gt: now } }];
  } else if (status === 'scheduled') {
    filter.isActive = true;
    filter.startDate = { $gt: now };
  } else if (status === 'history') {
    // History includes expired OR disabled
    filter.$or = [
      { endDate: { $lte: now } },
      { isActive: false }
    ];
    // Note: if user wants ONLY expired but active, logic varies. 
    // Usually history implies "not currently active".
  } else {
    // Default or 'all' - maybe hide deleted?
    // for now keep it open
  }

  const options = pick(req.query, ['page', 'limit']);
  const result = await announcementService.queryAnnouncements(filter, options);
  res.send(result);
});

const getAnnouncement = catchAsync(async (req, res) => {
  const announcement = await announcementService.getAnnouncementById(req.params.announcementId);
  if (!announcement) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Announcement not found');
  }
  res.send(announcement);
});

const updateAnnouncement = catchAsync(async (req, res) => {
  const announcement = await announcementService.updateAnnouncementById(req.params.announcementId, req.body);
  res.send(announcement);
});

const deleteAnnouncement = catchAsync(async (req, res) => {
  await announcementService.deleteAnnouncementById(req.params.announcementId);
  res.status(httpStatus.NO_CONTENT).send();
});

const exportAnnouncements = catchAsync(async (req, res) => {
    const { status, type, priority } = req.query;
    const now = new Date();
  
    const filter = {};
    if (type && type !== 'All') filter.type = type;
    if (priority) filter.priority = priority;
  
    // Status logic (Duplicated for availability - ideally refactor to service)
    if (status === 'active') {
      filter.isActive = true;
      filter.startDate = { $lte: now };
      filter.$or = [{ endDate: { $exists: false } }, { endDate: { $gt: now } }];
    } else if (status === 'scheduled') {
      filter.isActive = true;
      filter.startDate = { $gt: now };
    } else if (status === 'history') {
      filter.$or = [ { endDate: { $lte: now } }, { isActive: false } ];
    }
    
    // Fetch all matching records (limit 1000)
    const announcements = await announcementService.queryAnnouncements(filter, { limit: 1000 });
    const data = announcements.results || announcements;

    // Helper to format date
    const formatDate = (d) => {
        if (!d) return '-';
        return new Date(d).toLocaleString('en-GB', { 
            day: '2-digit', month: '2-digit', year: 'numeric', 
            hour: '2-digit', minute: '2-digit', hour12: true 
        }).replace(',', '');
    };

    // Convert to CSV
    // Fields: Title, Type, Message, Audience, Status, Start Date, End Date, Created At
    const header = ['Title', 'Type', 'Message Body', 'Audience', 'Status', 'Start Date', 'End Date', 'Created At'];
    const csvRows = [];
    
    // Header
    csvRows.push(header.join(','));

    // Rows
    data.forEach(item => {
        const row = [
            `"${(item.title || '').replace(/"/g, '""')}"`, // Title
            item.type || '',
            `"${(item.message || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`, // Message (remove newlines for CSV safety)
            (item.targetAudience?.role === 'all' ? 'All Users' : 
             item.targetAudience?.role === 'sub-broker' ? 'Sub Brokers' : 
             (() => {
                let parts = [item.targetAudience?.role || 'User'];
                if (item.targetAudience?.planValues?.length > 0) parts.push(`Plans: ${item.targetAudience.planValues.join('|')}`);
                if (item.targetAudience?.segments?.length > 0) parts.push(`Segments: ${item.targetAudience.segments.join('|')}`);
                return parts.join(' - ');
             })()),
            item.status || (item.isActive ? 'Active' : 'Inactive'), 
            formatDate(item.startDate),
            formatDate(item.endDate),
            formatDate(item.createdAt)
        ];
        csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="announcements_export_${Date.now()}.csv"`);
    res.send(csvString);
});

export default {
  createAnnouncement,
  getAnnouncements,
  getAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  exportAnnouncements
};
