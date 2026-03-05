import mongoose from 'mongoose';

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    heroImage: {
      type: String,
    },
    content: {
      type: String,
      required: true,
    },
    relatedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Blog',
      },
    ],
    categories: [
      {
        type: String,
        trim: true,
      },
    ],
    meta: {
      title: String,
      description: String,
      image: String,
    },
    publishedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    authors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    populatedAuthors: [
      {
        id: String,
        name: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Blog = mongoose.model('Blog', blogSchema);

export default Blog;
