import Transaction from '../models/Transaction.js';

const createTransaction = async (transactionBody) => {
  return Transaction.create(transactionBody);
};

const getTransactionById = async (id) => {
  return Transaction.findById(id);
};

const updateTransactionStatus = async (transactionId, status, gatewayTransactionId) => {
    const transaction = await getTransactionById(transactionId);
    if (!transaction) return null;
    
    transaction.status = status;
    if (gatewayTransactionId) {
        transaction.gatewayTransactionId = gatewayTransactionId;
    }
    await transaction.save();
    return transaction;
};

export default {
  createTransaction,
  getTransactionById,
  updateTransactionStatus,
};
