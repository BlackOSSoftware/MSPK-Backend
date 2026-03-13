import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import pick from '../utils/pick.js';
import blogService from '../services/blog.service.js';
import Blog from '../models/Blog.js';

const slugify = (value) =>
  value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const ensureUniqueSlug = async (baseSlug, currentId = null) => {
  let slug = baseSlug;
  let counter = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await Blog.findOne({ slug });
    if (!existing || (currentId && existing._id.toString() === currentId.toString())) {
      return slug;
    }
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }
};

const parseArrayField = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
};

const createBlog = catchAsync(async (req, res) => {
  const body = { ...req.body };

  if (req.files?.heroImage?.[0]?.path) {
    body.heroImage = req.files.heroImage[0].path;
  }
  if (req.files?.metaImage?.[0]?.path) {
    body.meta = { ...(body.meta || {}), image: req.files.metaImage[0].path };
  }
  if (body.metaTitle || body.metaDescription) {
    body.meta = {
      ...(body.meta || {}),
      title: body.metaTitle || body.meta?.title,
      description: body.metaDescription || body.meta?.description,
    };
  }

  body.categories = parseArrayField(body.categories);
  body.relatedPosts = parseArrayField(body.relatedPosts);
  body.authors = parseArrayField(body.authors);

  if (!body.slug && body.title) {
    const base = slugify(body.title);
    body.slug = await ensureUniqueSlug(base);
  }

  if (body.status === 'published' && !body.publishedAt) {
    body.publishedAt = new Date();
  }

  const blog = await blogService.createBlog(body);
  res.status(httpStatus.CREATED).send(blog);
});

const getBlogs = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.category) {
    filter.categories = req.query.category;
  }
  if (req.query.search) {
    const search = req.query.search.trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { title: regex },
        { slug: regex },
        { content: regex },
        { categories: regex },
        { 'meta.title': regex },
        { 'meta.description': regex },
      ];
    }
  }
  const options = pick(req.query, ['page', 'limit']);
  const result = await blogService.queryBlogs(filter, options);
  res.send(result);
});

const getBlog = catchAsync(async (req, res) => {
  const blog = await blogService.getBlogById(req.params.blogId);
  if (!blog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blog not found');
  }
  res.send(blog);
});

const getBlogBySlug = catchAsync(async (req, res) => {
  const blog = await blogService.getBlogBySlug(req.params.slug);
  if (!blog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blog not found');
  }
  res.send(blog);
});

const updateBlog = catchAsync(async (req, res) => {
  const body = { ...req.body };

  if (req.files?.heroImage?.[0]?.path) {
    body.heroImage = req.files.heroImage[0].path;
  }
  if (req.files?.metaImage?.[0]?.path) {
    body.meta = { ...(body.meta || {}), image: req.files.metaImage[0].path };
  }
  if (body.metaTitle || body.metaDescription) {
    body.meta = {
      ...(body.meta || {}),
      title: body.metaTitle || body.meta?.title,
      description: body.metaDescription || body.meta?.description,
    };
  }

  if (body.categories !== undefined) body.categories = parseArrayField(body.categories);
  if (body.relatedPosts !== undefined) body.relatedPosts = parseArrayField(body.relatedPosts);
  if (body.authors !== undefined) body.authors = parseArrayField(body.authors);

  if (body.title && !body.slug) {
    const base = slugify(body.title);
    body.slug = await ensureUniqueSlug(base, req.params.blogId);
  }

  if (body.status === 'published' && !body.publishedAt) {
    body.publishedAt = new Date();
  }

  const blog = await blogService.updateBlogById(req.params.blogId, body);
  res.send(blog);
});

const deleteBlog = catchAsync(async (req, res) => {
  await blogService.deleteBlogById(req.params.blogId);
  res.status(httpStatus.NO_CONTENT).send();
});

const createBlogsBulk = catchAsync(async (req, res) => {
  if (!Array.isArray(req.body)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Payload must be an array of blogs');
  }

  const usedSlugs = new Set();
  const normalized = [];

  for (const item of req.body) {
    const body = { ...item };

    if (!body.title || !body.content) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Each blog requires title and content');
    }

    body.categories = parseArrayField(body.categories);
    body.relatedPosts = parseArrayField(body.relatedPosts);
    body.authors = parseArrayField(body.authors);

    if (!body.slug) {
      const base = slugify(body.title);
      body.slug = await ensureUniqueSlug(base);
    }

    // Prevent duplicate slugs inside the same bulk request
    if (usedSlugs.has(body.slug)) {
      const base = slugify(body.title);
      body.slug = await ensureUniqueSlug(base);
    }
    usedSlugs.add(body.slug);

    if (body.status === 'published' && !body.publishedAt) {
      body.publishedAt = new Date();
    }

    normalized.push(body);
  }

  const blogs = await Blog.insertMany(normalized);
  res.status(httpStatus.CREATED).send({ results: blogs, totalResults: blogs.length });
});

export default {
  createBlog,
  getBlogs,
  getBlog,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  createBlogsBulk,
};
