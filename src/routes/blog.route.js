import express from 'express';
import auth from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import blogController from '../controllers/blog.controller.js';

const router = express.Router();

router
  .route('/')
  .get(blogController.getBlogs)
  .post(
    auth(['admin']),
    upload.fields([
      { name: 'heroImage', maxCount: 1 },
      { name: 'metaImage', maxCount: 1 },
    ]),
    blogController.createBlog
  );

router
  .route('/slug/:slug')
  .get(blogController.getBlogBySlug);

router
  .route('/bulk')
  .post(auth(['admin']), blogController.createBlogsBulk);

router
  .route('/:blogId')
  .get(blogController.getBlog)
  .patch(
    auth(['admin']),
    upload.fields([
      { name: 'heroImage', maxCount: 1 },
      { name: 'metaImage', maxCount: 1 },
    ]),
    blogController.updateBlog
  )
  .delete(auth(['admin']), blogController.deleteBlog);

export default router;
