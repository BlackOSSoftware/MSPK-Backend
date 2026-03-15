import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import User from '../models/User.js';
import SubBroker from '../models/SubBroker.js';
import Segment from '../models/Segment.js';
import Subscription from '../models/Subscription.js';
import Plan from '../models/Plan.js';
import Notification from '../models/Notification.js';
import Signal from '../models/Signal.js';
import ApiError from '../utils/ApiError.js';
import { redisClient } from '../services/redis.service.js';
import transactionService from '../services/transaction.service.js';
import { subBrokerService, announcementService } from '../services/index.js';
import subscriptionService from '../services/subscription.service.js';
import planService from '../services/plan.service.js';
import subscriptionCron from '../jobs/subscriptionCron.js';

const normalizeSubscriptionSegments = (segments) => {
    if (!Array.isArray(segments)) return [];
    const normalized = segments
        .map((segment) => String(segment || '').trim().toUpperCase())
        .filter(Boolean);
    return Array.from(new Set(normalized));
};

const normalizeSegmentForSubscription = (segment) => {
    const value = String(segment || '').trim().toUpperCase();
    if (!value) return null;
    if (value === 'FNO') return 'OPTIONS';
    if (value === 'CURRENCY') return 'FOREX';
    return value;
};

const mapSubscriptionToPreferred = (segments) => {
    const map = {
        EQUITY: 'NSE',
        OPTIONS: 'OPTIONS',
        FNO: 'OPTIONS',
        COMMODITY: 'MCX',
        CURRENCY: 'FOREX',
        FOREX: 'FOREX',
        CRYPTO: 'CRYPTO'
    };
    const preferred = segments
        .map((segment) => map[segment])
        .filter(Boolean);
    return Array.from(new Set(preferred));
};

const mapSegmentsToPermissions = (segments) => {
    const permissions = new Set();
    segments.forEach((segRaw) => {
        const seg = String(segRaw || '').trim().toUpperCase();
        if (seg === 'EQUITY') {
            permissions.add('EQUITY_INTRA');
            permissions.add('EQUITY_DELIVERY');
        }
        if (seg === 'FNO' || seg === 'OPTIONS') {
            permissions.add('NIFTY_OPT');
            permissions.add('BANKNIFTY_OPT');
            permissions.add('FINNIFTY_OPT');
            permissions.add('STOCK_OPT');
        }
        if (seg === 'COMMODITY') {
            permissions.add('MCX_FUT');
        }
        if (seg === 'CURRENCY' || seg === 'FOREX') {
            permissions.add('CURRENCY');
        }
        if (seg === 'CRYPTO') {
            permissions.add('CRYPTO');
        }
    });
    return Array.from(permissions);
};

const inferPrimarySegment = (segments) => {
    const set = new Set(segments.map(s => String(s || '').trim().toUpperCase()));
    if (set.has('EQUITY')) return 'EQUITY';
    if (set.has('FNO') || set.has('OPTIONS')) return 'FNO';
    if (set.has('COMMODITY')) return 'COMMODITY';
    if (set.has('CURRENCY') || set.has('FOREX')) return 'CURRENCY';
    return undefined;
};

const escapeCsvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const buildAdminUserQuery = (query = {}) => {
    const filter = {};
    const status = String(query.status || '').trim();
    const search = String(query.search || '').trim();
    const subBrokerId = String(query.subBrokerId || '').trim();

    if (status && status.toLowerCase() !== 'all') {
        filter.status = status;
    }

    if (subBrokerId && subBrokerId.toLowerCase() !== 'all') {
        if (subBrokerId === 'DIRECT') {
            filter.$and = [
                {
                    $or: [
                        { subBrokerId: { $exists: false } },
                        { subBrokerId: null }
                    ]
                },
                {
                    $or: [
                        { 'referral.referredBy': { $exists: false } },
                        { 'referral.referredBy': null }
                    ]
                }
            ];
        } else {
            filter.$or = [
                { subBrokerId },
                { 'referral.referredBy': subBrokerId }
            ];
        }
    }

    if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const searchClause = {
            $or: [
                { name: regex },
                { email: regex },
                { clientId: regex },
                { phone: regex },
                { tradingViewId: regex },
            ]
        };

        if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, searchClause];
            delete filter.$or;
        } else {
            Object.assign(filter, searchClause);
        }
    }

    return filter;
};

const buildSubBrokerLookup = async (users = []) => {
    const ids = Array.from(new Set(
        (Array.isArray(users) ? users : [])
            .flatMap((user) => [user?.subBrokerId, user?.referral?.referredBy])
            .map((value) => String(value || '').trim())
            .filter((value) => /^[0-9a-fA-F]{24}$/.test(value))
    ));

    if (ids.length === 0) {
        return new Map();
    }

    const brokers = await SubBroker.find({ _id: { $in: ids } })
        .select('name brokerId')
        .lean();

    return new Map(
        brokers.map((broker) => [
            String(broker._id),
            {
                _id: broker._id,
                name: broker.name,
                clientId: broker.brokerId || null,
            },
        ])
    );
};

const enrichAdminUsers = async (users = [], subBrokerMap = new Map()) => Promise.all(users.map(async (u) => {
    const subs = await Subscription.find({ user: u.id, status: 'active' }).populate('plan');
    const brokerRefId = String(u.subBrokerId || u.referral?.referredBy || '').trim();
    const brokerUser = brokerRefId ? (subBrokerMap.get(brokerRefId) || null) : null;

    let planNames = [];
    let minStart = null;
    let maxEnd = null;

    if (subs.length > 0) {
        planNames = subs.map((s) => (s.plan ? s.plan.name : 'Unknown')).filter((n) => n !== 'Unknown');
        const starts = subs.map((s) => new Date(s.startDate).getTime()).filter((value) => !Number.isNaN(value));
        const ends = subs.map((s) => new Date(s.endDate).getTime()).filter((value) => !Number.isNaN(value));

        if (starts.length > 0) minStart = new Date(Math.min(...starts));
        if (ends.length > 0) maxEnd = new Date(Math.max(...ends));
    }

    const hasActivePlan = subs.length > 0;

    return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        tradingViewId: u.tradingViewId || '',
        role: u.role,
        ip: u.lastLoginIp || '',
        lastLoginIp: u.lastLoginIp || '',
        plan: hasActivePlan ? planNames.join(', ') : 'Free',
        planStatus: hasActivePlan ? 'Active' : 'Inactive',
        subscriptionStart: minStart,
        subscriptionExpiry: maxEnd,
        subBrokerId: brokerUser ? brokerUser._id : 'DIRECT',
        subBrokerName: brokerUser ? brokerUser.name : 'Direct Client',
        status: u.status || 'Active',
        walletBalance: u.walletBalance || 0,
        clientId: u.clientId || `MS-${u.id.toString().slice(-4)}`,
        equity: u.equity || 0,
        marginUsed: u.marginUsed || 0,
        pnl: u.pnl || 0,
        joinDate: u.createdAt,
        lastOtpSentAt: u.lastOtpSentAt || null,
        lastOtpChannel: u.lastOtpChannel || null,
        lastOtpTarget: u.lastOtpTarget || null,
    };
}));

const getNextSubscriptionStartDate = async (userId) => {
    const latest = await Subscription.findOne({ user: userId, status: 'active' }).sort({ endDate: -1 });
    const now = new Date();
    if (latest?.endDate && latest.endDate > now) {
        return new Date(latest.endDate);
    }
    return now;
};

const assignPlanWithCommission = async ({ user, plan, adminCreated = true }) => {
    const startDate = await getNextSubscriptionStartDate(user.id);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (plan.durationDays || 30));

    const transaction = await transactionService.createTransaction({
        user: user.id,
        amount: plan.price,
        currency: 'INR',
        type: 'DEBIT',
        purpose: 'SUBSCRIPTION',
        status: 'success',
        paymentGateway: 'MANUAL_ADMIN',
        metadata: { planId: plan.id, planName: plan.name, adminCreated }
    });

    const subscription = await Subscription.create({
        user: user.id,
        plan: plan.id,
        status: 'active',
        startDate,
        endDate,
        transaction: transaction.id
    });

    user.subscription = {
        plan: plan.name,
        expiresAt: endDate
    };
    await user.save();

    await subBrokerService.recordCommission(transaction, user, plan);

    return { transaction, subscription, startDate, endDate };
};

const createUser = catchAsync(async (req, res) => {
    console.log("Create User Payload:", JSON.stringify(req.body, null, 2)); // DEBUG LOG
    const { email, password, name, phone, tradingViewId, role, clientId, equity, walletBalance, subBrokerId, planId, status, segments } = req.body;

    if (await User.findOne({ email })) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }

    let normalizedSegments = normalizeSubscriptionSegments(segments).map(normalizeSegmentForSubscription).filter(Boolean);
    if (normalizedSegments.includes('ALL')) {
        const activeSegments = await Segment.find({ is_active: true }).select('segment_code').lean();
        normalizedSegments = activeSegments
            .map((seg) => normalizeSegmentForSubscription(seg.segment_code))
            .filter(Boolean);
    }
    const preferredSegments = mapSubscriptionToPreferred(normalizedSegments);

    const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const user = await User.create({
        name,
        email,
        password,
        phone,
        tradingViewId,
        role,
        clientId,
        equity,
        walletBalance,
        subBrokerId,
        status,
        ...(preferredSegments.length > 0 ? { preferredSegments } : {}),
        referral: {
            code: referralCode
        },
        isEmailVerified: true // Admin created, so verify
    });

    if (normalizedSegments.length > 0) {
        await subscriptionService.purchaseSegments(user.id, normalizedSegments, 'demo');
    }

    // Handle Plan Subscription
    if (planId) {
        const plan = await Plan.findById(planId);
        if (plan) {
            await assignPlanWithCommission({ user, plan, adminCreated: true });
        }
    }

    res.status(httpStatus.CREATED).send(user);
});

const assignCustomPlan = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { name, description, segment, segments, price, durationDays, features, permissions, isActive, isDemo } = req.body;

    const user = await User.findById(userId);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    let normalizedSegments = normalizeSubscriptionSegments(segments).map(normalizeSegmentForSubscription).filter(Boolean);
    if (normalizedSegments.includes('ALL')) {
        const activeSegments = await Segment.find({ is_active: true }).select('segment_code').lean();
        normalizedSegments = activeSegments
            .map((seg) => normalizeSegmentForSubscription(seg.segment_code))
            .filter(Boolean);
    }

    let resolvedPermissions = permissions;
    if ((!resolvedPermissions || resolvedPermissions.length === 0) && (!features || features.length === 0) && normalizedSegments.length > 0) {
        resolvedPermissions = mapSegmentsToPermissions(normalizedSegments);
    }

    const resolvedSegment = segment || inferPrimarySegment(normalizedSegments);

    const plan = await planService.createPlan({
        name,
        description,
        segment: resolvedSegment,
        price,
        durationDays,
        features,
        permissions: resolvedPermissions,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        isDemo: typeof isDemo === 'boolean' ? isDemo : false,
        isCustom: true
    });

    const startDate = await getNextSubscriptionStartDate(user.id);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (plan.durationDays || 30));

    const { subscription } = await assignPlanWithCommission({ user, plan, adminCreated: true });

    res.status(httpStatus.CREATED).send({
        message: 'Custom plan assigned successfully',
        plan: {
            id: plan.id,
            name: plan.name,
            price: plan.price,
            durationDays: plan.durationDays,
            segment: plan.segment || null,
            permissions: plan.permissions || [],
            features: plan.features || []
        },
        subscription: {
            id: subscription.id,
            startDate: subscription.startDate,
            endDate: subscription.endDate
        }
    });
});

const getUsers = catchAsync(async (req, res) => {
  const filter = buildAdminUserQuery(req.query);
  const users = await User.find(filter, '-password').sort({ createdAt: -1 });
  const subBrokerMap = await buildSubBrokerLookup(users);
  const enrichedUsers = await enrichAdminUsers(users, subBrokerMap);

  const statusCounts = await User.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  const stats = {
      total: await User.countDocuments(),
      active: 0,
      inactive: 0,
      blocked: 0,
  };

  statusCounts.forEach((item) => {
      if (item._id === 'Active') stats.active = item.count;
      if (item._id === 'Inactive') stats.inactive = item.count;
      if (item._id === 'Blocked') stats.blocked = item.count;
  });

  res.send({
      results: enrichedUsers,
      totalResults: enrichedUsers.length,
      stats,
  });
});

const exportUsers = catchAsync(async (req, res) => {
  const filter = buildAdminUserQuery(req.query);
  const users = await User.find(filter, '-password').sort({ createdAt: -1 });
  const subBrokerMap = await buildSubBrokerLookup(users);
  const enrichedUsers = await enrichAdminUsers(users, subBrokerMap);

  const header = ['Client ID', 'Name', 'Email', 'Phone', 'Status', 'Plan', 'Plan Status', 'Subscription Start', 'Subscription Expiry', 'Sub Broker', 'IP Address', 'Join Date'];
  const rows = [header.join(',')];

  enrichedUsers.forEach((user) => {
      rows.push([
          escapeCsvValue(user.clientId),
          escapeCsvValue(user.name),
          escapeCsvValue(user.email),
          escapeCsvValue(user.phone),
          escapeCsvValue(user.status),
          escapeCsvValue(user.plan),
          escapeCsvValue(user.planStatus),
          escapeCsvValue(user.subscriptionStart ? new Date(user.subscriptionStart).toISOString() : ''),
          escapeCsvValue(user.subscriptionExpiry ? new Date(user.subscriptionExpiry).toISOString() : ''),
          escapeCsvValue(user.subBrokerName),
          escapeCsvValue(user.ip || ''),
          escapeCsvValue(user.joinDate ? new Date(user.joinDate).toISOString() : ''),
      ].join(','));
  });

  res.header('Content-Type', 'text/csv');
  res.header('Content-Disposition', `attachment; filename="users_export_${Date.now()}.csv"`);
  res.send(rows.join('\n'));
});

const getUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.userId)
    .populate('subBrokerId', 'name clientId')
    .populate('referral.referredBy', 'name email phone clientId referral.code');
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Fetch active subscriptions (ALL)
  const activeSubs = await Subscription.find({ user: user.id, status: 'active' }).populate('plan');

  // Aggregate Data
  let planNames = [];
  let minStart = null;
  let maxEnd = null;
  let totalPrice = 0;

  if (activeSubs.length > 0) {
      planNames = activeSubs.map(s => s.plan ? s.plan.name : 'Unknown');
      totalPrice = activeSubs.reduce((sum, s) => sum + (s.plan ? s.plan.price : 0), 0);
      
      const starts = activeSubs.map(s => new Date(s.startDate).getTime());
      const ends = activeSubs.map(s => new Date(s.endDate).getTime());
      
      if (starts.length > 0) minStart = new Date(Math.min(...starts));
      if (ends.length > 0) maxEnd = new Date(Math.max(...ends));
  }

  // Fetch all subscriptions for history
  const history = await Subscription.find({ user: user.id }).sort({ createdAt: -1 }).populate('plan');
  const referredUsers = await User.find({ 'referral.referredBy': user._id })
    .select('name email phone clientId createdAt status referral.code')
    .sort({ createdAt: -1 })
    .lean();

  const referredByUser = user.referral?.referredBy
    ? {
        id: user.referral.referredBy._id,
        name: user.referral.referredBy.name || 'Unknown User',
        email: user.referral.referredBy.email || '',
        phone: user.referral.referredBy.phone || '',
        clientId: user.referral.referredBy.clientId || '',
        referralCode: user.referral.referredBy.referral?.code || '',
      }
    : null;

  const enrichedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      tradingViewId: user.tradingViewId || '',
      role: user.role,
      ip: user.lastLoginIp || '',
      lastLoginIp: user.lastLoginIp || '',
      currentDeviceId: user.currentDeviceId || '',
      isEmailVerified: Boolean(user.isEmailVerified),
      isPhoneVerified: Boolean(user.isPhoneVerified),
      preferredSegments: Array.isArray(user.preferredSegments) ? user.preferredSegments : [],
      referralCode: user.referral?.code || '',
      referredByUser,
      referredUsers: referredUsers.map((refUser) => ({
          id: refUser._id,
          name: refUser.name || 'Unnamed User',
          email: refUser.email || '',
          phone: refUser.phone || '',
          clientId: refUser.clientId || '',
          joinDate: refUser.createdAt || null,
          status: refUser.status || 'Active',
          referralCode: refUser.referral?.code || '',
      })),
      profile: {
          city: user.profile?.city || '',
          state: user.profile?.state || '',
          address: user.profile?.address || ''
      },
      
      // Subscription / Plan Data
      plan: planNames.length > 0 ? planNames.join(', ') : 'Free', 
      planStatus: planNames.length > 0 ? 'Active' : 'Inactive',
      subscriptionStart: minStart,
      subscriptionExpiry: maxEnd,
      planPrice: totalPrice,

      // Broker Data
      subBrokerId: user.subBrokerId ? user.subBrokerId._id : null,
      subBrokerName: user.subBrokerId ? user.subBrokerId.name : 'Direct Client',
      subBrokerClientId: user.subBrokerId ? user.subBrokerId.clientId : null,

      // Trading Stats
      status: user.status || 'Active', 
      walletBalance: user.walletBalance || 0,
      clientId: user.clientId || `MS-${user.id.toString().slice(-4)}`,
      equity: user.equity || 0,
      marginUsed: user.marginUsed || 0,
      pnl: user.pnl || 0,
      
      joinDate: user.createdAt,
      lastOtpSentAt: user.lastOtpSentAt || null,
      lastOtpChannel: user.lastOtpChannel || null,
      lastOtpTarget: user.lastOtpTarget || null,
      
      // History
      subscriptionHistory: history.map(h => ({
          id: h.id,
          plan: h.plan ? h.plan.name : 'Unknown Plan',
          amount: h.plan ? `₹${h.plan.price}` : '-',
          date: h.createdAt,
          status: h.status,
          expiry: h.endDate
      }))
  };

  res.send(enrichedUser);
});

const getUserSignalDeliveries = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const user = await User.findById(userId).select('_id');
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    const baseFilter = {
        user: userId,
        type: 'SIGNAL'
    };

    const [totalResults, unreadDeliveries, notifications] = await Promise.all([
        Notification.countDocuments(baseFilter),
        Notification.countDocuments({ ...baseFilter, isRead: false }),
        Notification.find(baseFilter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean()
    ]);

    const signalIds = Array.from(
        new Set(
            notifications
                .map((notification) => notification?.data?.signalId)
                .filter(Boolean)
                .map((id) => String(id))
        )
    );

    const signalDocs = signalIds.length > 0
        ? await Signal.find({ _id: { $in: signalIds } })
            .select('_id uniqueId webhookId symbol segment category type entryPrice stopLoss targets status signalTime exitPrice totalPoints exitReason exitTime timeframe createdAt isFree')
            .lean()
        : [];

    const signalMap = new Map(signalDocs.map((signal) => [String(signal._id), signal]));

    const results = notifications.map((notification) => {
        const signalId = notification?.data?.signalId ? String(notification.data.signalId) : null;
        const signal = signalId ? signalMap.get(signalId) : null;

        return {
            id: notification._id,
            title: notification.title,
            message: notification.message,
            type: notification.type,
            isRead: notification.isRead,
            link: notification.link,
            notifiedAt: notification.createdAt,
            signal: signal
                ? {
                    id: signal._id,
                    uniqueId: signal.uniqueId,
                    webhookId: signal.webhookId,
                    symbol: signal.symbol,
                    segment: signal.segment,
                    category: signal.category,
                    type: signal.type,
                    entry: signal.entryPrice,
                    stoploss: signal.stopLoss,
                    targets: signal.targets,
                    status: signal.status,
                    signalTime: signal.signalTime,
                    exitPrice: signal.exitPrice,
                    totalPoints: signal.totalPoints,
                    exitReason: signal.exitReason,
                    exitTime: signal.exitTime,
                    timeframe: signal.timeframe,
                    createdAt: signal.createdAt,
                    isFree: signal.isFree
                }
                : null
        };
    });

    res.send({
        results,
        pagination: {
            page,
            limit,
            totalPages: Math.max(Math.ceil(totalResults / limit), 1),
            totalResults
        },
        stats: {
            totalDeliveries: totalResults,
            unreadDeliveries,
            readDeliveries: Math.max(totalResults - unreadDeliveries, 0)
        }
    });
});

const updateUserRole = catchAsync(async (req, res) => {
    const user = await User.findByIdAndUpdate(req.params.userId, { role: req.body.role }, { new: true });
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    res.send(user);
});

const getSystemHealth = catchAsync(async (req, res) => {
    // Check Redis
    let redisStatus = 'DOWN';
    try {
        await redisClient.ping();
        redisStatus = 'UP';
    } catch(e) {
        redisStatus = 'DOWN';
    }

    // Check DB
    const dbStatus = 'UP'; // If we are here, express is connected (usually)
    
    // Memory Usage
    const memory = process.memoryUsage();

    res.send({
        status: 'OK',
        timestamp: new Date(),
        components: {
            redis: redisStatus,
            database: dbStatus
        },
        memory: {
            rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`
        }
    });
});

const deleteUser = catchAsync(async (req, res) => {
    const user = await User.findById(req.params.userId);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    await Subscription.deleteMany({ user: user.id });
    await User.deleteOne({ _id: user._id });
    res.status(httpStatus.NO_CONTENT).send();
});

const blockUser = catchAsync(async (req, res) => {
    const user = await User.findById(req.params.userId);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    user.status = user.status === 'Blocked' ? 'Active' : 'Blocked';
    await user.save();
    res.send(user);
});


const updateUser = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { planId, ...body } = req.body; // Extract planId separately

    const user = await User.findById(userId);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    // Check if email is taken (if email is being updated)
    if (body.email && body.email !== user.email) {
        if (await User.findOne({ email: body.email })) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
        }
    }

    // Update basic fields
    Object.assign(user, body);
    await user.save(); // Password hashing happens in pre-save if 'password' was in body

    // Handle Plan Update (if planId provided)
    if (planId) {
        const plan = await Plan.findById(planId);
        if (!plan) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Plan not found');
        }
        await assignPlanWithCommission({ user, plan, adminCreated: true });
    }

    res.send(user);
});

const broadcastMessage = catchAsync(async (req, res) => {
    const { title, message, targetAudience } = req.body;
    
    // Validate inputs
    if (!title || !message) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Title and Message are required');
    }

    // Use Announcement Service to Create + Schedule
    // This handles DB Log + Broadcast triggers
    const announcement = await announcementService.createAnnouncement({
        title,
        message,
        targetAudience: targetAudience || { role: 'all' },
        type: 'GENERAL',
        isActive: true, // Immediate
        startDate: new Date()
    });

    res.status(httpStatus.CREATED).send({ 
        message: 'Broadcast scheduled successfully', 
        announcementId: announcement.id
    });
});

const sendRenewalReminders = catchAsync(async (req, res) => {
    const result = await subscriptionCron.runRenewalRemindersNow();
    res.status(httpStatus.OK).send({ message: 'Renewal reminders triggered', ...result });
});

const sendDemoReminders = catchAsync(async (req, res) => {
    const result = await subscriptionCron.runDemoRemindersNow();
    res.status(httpStatus.OK).send({ message: 'Demo reminders triggered', ...result });
});

export default {
  getUsers,
  exportUsers,
  createUser,
  getUser,
  getUserSignalDeliveries,
  updateUser,
  assignCustomPlan,
  updateUserRole,
  deleteUser,
  blockUser, 
  getSystemHealth,
  broadcastMessage,
  sendRenewalReminders,
  sendDemoReminders
};
