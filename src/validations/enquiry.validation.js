import Joi from 'joi';

const createEnquiry = {
  body: Joi.object().keys({
    contactName: Joi.string().trim().min(2).required(),
    subject: Joi.string().trim().required(),
    ticketType: Joi.string().trim().allow('', null),
    description: Joi.string().trim().required(),
    contactEmail: Joi.string().email().required(),
    contactNumber: Joi.string().trim().required(),
  }),
};

export default {
  createEnquiry,
};
