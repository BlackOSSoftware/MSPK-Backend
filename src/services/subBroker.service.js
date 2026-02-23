import SubBroker from '../models/SubBroker.js';
import User from '../models/User.js';
import Commission from '../models/Commission.js';
import httpStatus from 'http-status';

/**
 * Create a sub-broker
 * @param {Object} subBrokerBody
 * @returns {Promise<SubBroker>}
 */
const createSubBroker = async (subBrokerBody) => {
    if (await SubBroker.isEmailTaken(subBrokerBody.email)) {
        throw new Error('Email already taken');
    }
    return SubBroker.create(subBrokerBody);
};

/**
 * Query for sub-brokers
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
const getSubBrokers = async (filter = {}, options = {}) => {
  return SubBroker.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: 'users',
        let: { sbId: '$_id' },
        pipeline: [
          { $match: {
              $expr: {
                $or: [
                   { $eq: ['$subBrokerId', '$$sbId'] },
                   { $eq: ['$referral.referredBy', '$$sbId'] } 
                ]
              }
          }},
          { $count: "count" }
        ],
        as: 'clientStats'
      }
    },
    {
      $lookup: {
        from: 'commissions',
        localField: '_id',
        foreignField: 'subBroker',
        pipeline: [
           { $project: { amount: 1 } },
           { $group: { _id: null, total: { $sum: "$amount" } } }
        ],
        as: 'revenueStats'
      }
    },
    {
       $addFields: {
          totalClients: { $ifNull: [{ $arrayElemAt: ["$clientStats.count", 0] }, 0] },
          totalRevenue: { $ifNull: [{ $arrayElemAt: ["$revenueStats.total", 0] }, 0] },
          id: '$_id' 
       }
    },
    { $sort: { createdAt: -1 } }
  ]);
};

/**
 * Get sub-broker by id
 * @param {ObjectId} id
 * @returns {Promise<SubBroker>}
 */
const getSubBrokerById = async (id) => {
  return SubBroker.findById(id);
};

/**
 * Update sub-broker by id
 * @param {ObjectId} subBrokerId
 * @param {Object} updateBody
 * @returns {Promise<SubBroker>}
 */
const updateSubBrokerById = async (subBrokerId, updateBody) => {
  const subBroker = await getSubBrokerById(subBrokerId);
  if (!subBroker) {
    const error = new Error('SubBroker not found');
    error.statusCode = httpStatus.NOT_FOUND;
    throw error;
  }
  if (updateBody.email && (await SubBroker.isEmailTaken(updateBody.email, subBrokerId))) {
    throw new Error('Email already taken');
  }
  Object.assign(subBroker, updateBody);
  await subBroker.save();
  return subBroker;
};

/**
 * Delete sub-broker by id
 * @param {ObjectId} subBrokerId
 * @returns {Promise<SubBroker>}
 */
const deleteSubBrokerById = async (subBrokerId) => {
  const subBroker = await getSubBrokerById(subBrokerId);
  if (!subBroker) {
    const error = new Error('SubBroker not found');
    error.statusCode = httpStatus.NOT_FOUND;
    throw error;
  }
  await subBroker.deleteOne();
  return subBroker;
};

// --- Existing Logic Preserved (but updated to check SubBroker model if needed) ---

const getSubBrokerClients = async (subBrokerId) => {
  // Support both new direct subBrokerId and legacy referral structure
  return User.find({ 
      $or: [
          { subBrokerId: subBrokerId },
          { 'referral.referredBy': subBrokerId }
      ]
  });
};

const getCommissions = async (subBrokerId) => {
    return Commission.find({ subBroker: subBrokerId }).populate('user', 'name').populate('transaction');
};

const recordCommission = async (transaction, user, plan) => {
    // Check if user is referred by a sub-broker
    const referrerId = user.subBrokerId || (user.referral && user.referral.referredBy);
    
    if (referrerId) {
        // Try finding in SubBroker model first (New Way)
        let subBroker = await SubBroker.findById(referrerId);
        
        // Fallback to User model (Old Way - for backward compatibility if any)
        if (!subBroker) {
             const userBroker = await User.findById(referrerId);
             if (userBroker && userBroker.role === 'sub-broker') {
                 subBroker = userBroker; // Treat as sub-broker
             }
        }
        
        if (subBroker) {
            // Determine commission
            let commissionAmount = 0;
            let commissionRate = 0;

            if (subBroker.commission && subBroker.commission.type === 'FIXED') {
                 commissionAmount = subBroker.commission.value;
            } else if (subBroker.commission && subBroker.commission.type === 'PERCENTAGE') {
                 commissionRate = subBroker.commission.value;
                 commissionAmount = (transaction.amount * commissionRate) / 100;
            } else {
                 // Default Fallback
                 commissionRate = 10;
                 commissionAmount = (transaction.amount * commissionRate) / 100;
            }

            await Commission.create({
                subBroker: subBroker.id,
                user: user.id,
                transaction: transaction.id,
                amount: commissionAmount,
                percentage: commissionRate,
                status: 'PENDING'
            });
        }
    }
};

const processPayout = async (subBrokerId) => {
    return Commission.updateMany(
        { subBroker: subBrokerId, status: 'PENDING' },
        { status: 'PAID' }
    );
};

export default {
  createSubBroker,
  getSubBrokers,
  getSubBrokerById,
  updateSubBrokerById,
  deleteSubBrokerById,
  getSubBrokerClients,
  getCommissions,
  recordCommission,
  processPayout
};
