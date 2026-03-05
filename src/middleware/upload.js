import multer from 'multer';
import path from 'path';
import fs from 'fs';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let folder = 'uploads/avatars';
    if (file.fieldname === 'screenshot') folder = 'uploads/payments';
    if (file.fieldname === 'qrCode') folder = 'uploads/payments';
    if (file.fieldname === 'heroImage' || file.fieldname === 'metaImage') folder = 'uploads/blogs';
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    cb(null, folder);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  console.log('Multer Filter Check:', file.mimetype, file.originalname);
  // Allow all image types
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    console.error('Multer Rejected:', file.mimetype);
    cb(new Error('Unsupported file format: ' + file.mimetype), false);
  }
};

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 5 // 5MB limit
  },
  fileFilter: fileFilter
});

export default upload;
