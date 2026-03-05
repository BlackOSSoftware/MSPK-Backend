import Blog from '../models/Blog.js';

const createBlog = async (blogBody) => {
  return Blog.create(blogBody);
};

const queryBlogs = async (filter, options) => {
  const page = options.page ? parseInt(options.page, 10) : 1;
  const limit = options.limit ? parseInt(options.limit, 10) : 12;
  const skip = (page - 1) * limit;

  const [totalResults, results] = await Promise.all([
    Blog.countDocuments(filter),
    Blog.find(filter)
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
  ]);

  const totalPages = Math.ceil(totalResults / limit);

  return {
    results,
    page,
    limit,
    totalPages,
    totalResults,
  };
};

const getBlogById = async (id) => {
  return Blog.findById(id);
};

const getBlogBySlug = async (slug) => {
  return Blog.findOne({ slug });
};

const updateBlogById = async (blogId, updateBody) => {
  const blog = await getBlogById(blogId);
  if (!blog) {
    throw new Error('Blog not found');
  }
  Object.assign(blog, updateBody);
  await blog.save();
  return blog;
};

const deleteBlogById = async (blogId) => {
  const blog = await getBlogById(blogId);
  if (!blog) {
    throw new Error('Blog not found');
  }
  await blog.deleteOne();
  return blog;
};

export default {
  createBlog,
  queryBlogs,
  getBlogById,
  getBlogBySlug,
  updateBlogById,
  deleteBlogById,
};
