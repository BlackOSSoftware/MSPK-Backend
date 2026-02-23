import Page from '../models/Page.js';
import FAQ from '../models/FAQ.js';

/**
 * Get Page by Slug
 * @param {string} slug
 * @returns {Promise<Page>}
 */
const getPage = async (slug) => {
    return Page.findOne({ slug });
};

/**
 * Update or Create Page
 * @param {string} slug
 * @param {object} data - { title, content }
 * @returns {Promise<Page>}
 */
const updatePage = async (slug, data) => {
    return Page.findOneAndUpdate(
        { slug },
        { ...data, slug }, // Ensure slug is set
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
};

/**
 * Get All FAQs
 * @returns {Promise<Array>}
 */
const getFAQs = async () => {
    return FAQ.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
};

/**
 * Create FAQ
 * @param {object} data
 * @returns {Promise<FAQ>}
 */
const createFAQ = async (data) => {
    return FAQ.create(data);
};

/**
 * Update FAQ
 * @param {string} id
 * @param {object} data
 * @returns {Promise<FAQ>}
 */
const updateFAQ = async (id, data) => {
    return FAQ.findByIdAndUpdate(id, data, { new: true });
};

/**
 * Delete FAQ
 * @param {string} id
 * @returns {Promise<FAQ>}
 */
const deleteFAQ = async (id) => {
    return FAQ.findByIdAndDelete(id);
};

export default {
    getPage,
    updatePage,
    getFAQs,
    createFAQ,
    updateFAQ,
    deleteFAQ
};
