import Joi from 'joi';

const purchaseSubscription = {
  body: Joi.object().keys({
    planId: Joi.string().required(),
    paymentDetails: Joi.object().keys({
        gateway: Joi.string().valid('RAZORPAY', 'STRIPE', 'MANUAL').required(),
        success: Joi.boolean(), // Mock flag
        transactionId: Joi.string()
    }).required()
  }),
};

export default {
  purchaseSubscription,
};
