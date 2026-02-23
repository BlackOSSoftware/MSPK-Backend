import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import cmsService from '../services/cms.service.js';

const getPage = catchAsync(async (req, res) => {
    const page = await cmsService.getPage(req.params.slug);
    if (!page) {
        // Return default structure if not found (or 404?)
        // Better to return empty object or default for UI to handle "Compose New"
        return res.send({ slug: req.params.slug, title: '', content: '' }); 
    }
    res.send(page);
});

const updatePage = catchAsync(async (req, res) => {
    const page = await cmsService.updatePage(req.params.slug, req.body);
    res.send(page);
});

const getFAQs = catchAsync(async (req, res) => {
    const faqs = await cmsService.getFAQs();
    res.send(faqs);
});

const createFAQ = catchAsync(async (req, res) => {
    const faq = await cmsService.createFAQ(req.body);
    res.status(httpStatus.CREATED).send(faq);
});

const updateFAQ = catchAsync(async (req, res) => {
    const faq = await cmsService.updateFAQ(req.params.id, req.body);
    if (!faq) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'FAQ not found' });
    }
    res.send(faq);
});

const deleteFAQ = catchAsync(async (req, res) => {
    await cmsService.deleteFAQ(req.params.id);
    res.status(httpStatus.NO_CONTENT).send();
});

export default {
    getPage,
    updatePage,
    getFAQs,
    createFAQ,
    updateFAQ,
    deleteFAQ
};
