import Joi from 'joi';

const createTicket = {
  body: Joi.object().keys({
    subject: Joi.string().required(),
    ticketType: Joi.string().required(),
    description: Joi.string().required(),
    contactEmail: Joi.string().email().required(),
    contactNumber: Joi.string().required(),
  }),
};

const updateTicketStatus = {
  body: Joi.object().keys({
    status: Joi.string().valid('pending', 'resolved', 'rejected').required(),
  }),
};

export default {
  createTicket,
  updateTicketStatus,
};
