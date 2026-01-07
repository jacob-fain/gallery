import multer from 'multer';

// Configure multer for memory storage (buffer for Sharp processing)
const storage = multer.memoryStorage();

// File filter: only accept image formats supported by Sharp
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/tiff',
    'image/heif',
    'image/heic',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Allowed: JPEG, PNG, WebP, TIFF, HEIF'));
  }
};

// Configure multer instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max for high-res photos
  },
});
