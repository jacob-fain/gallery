import path from 'path';
import multer from 'multer';

// Configure multer for memory storage (buffer for Sharp processing)
const storage = multer.memoryStorage();

const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'];

const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];

/** A file the upload filter refuses; the error handler answers 415 with its message. */
export class UnsupportedUploadError extends Error {}

export const HEIC_NOT_SUPPORTED =
  "HEIC photos aren't supported yet. Export as JPEG (on iPhone: Settings > Camera > Formats > Most Compatible)";

// iPhone photos are HEIF with HEVC compression. sharp's prebuilt libvips
// decodes HEIF only when it is AVIF-compressed (HEVC is left out for patent
// licensing), so these would fail late in processing (#131). They are refused
// by type or by name, whatever else the browser claims.
const HEIC_MIME = /^image\/hei[cf](-sequence)?$/;
const HEIC_EXTENSIONS = ['.heic', '.heif'];

const extensionOf = (file: Express.Multer.File) => path.extname(file.originalname).toLowerCase();

const isHeic = (file: Express.Multer.File): boolean =>
  HEIC_MIME.test(file.mimetype) || HEIC_EXTENSIONS.includes(extensionOf(file));

// A file the browser gives no type arrives as application/octet-stream. Those
// are accepted by extension; the controller still checks the bytes with sharp
// before storing anything.
const isAllowedUpload = (file: Express.Multer.File): boolean => {
  if (allowedMimeTypes.includes(file.mimetype)) return true;
  const untyped = file.mimetype === '' || file.mimetype === 'application/octet-stream';
  return untyped && allowedExtensions.includes(extensionOf(file));
};

// multer runs the filter on the part's headers, so a refused file is drained
// without being buffered.
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (isHeic(file)) {
    cb(new UnsupportedUploadError(HEIC_NOT_SUPPORTED));
  } else if (isAllowedUpload(file)) {
    cb(null, true);
  } else {
    cb(new UnsupportedUploadError('Unsupported file type. Allowed: JPEG, PNG, WebP, TIFF'));
  }
};

// original_filename is VARCHAR(255), which counts characters, not bytes.
const MAX_FILENAME_LENGTH = 255;

/** The upload's filename as stored: at most 255 characters, keeping the extension. */
export const storedFilename = (name: string): string => {
  const chars = Array.from(name);
  if (chars.length <= MAX_FILENAME_LENGTH) return name;
  const ext = Array.from(path.extname(name));
  // An extension that long is not a real one; cut the name as a whole.
  if (ext.length === 0 || ext.length > 16) return chars.slice(0, MAX_FILENAME_LENGTH).join('');
  return chars.slice(0, MAX_FILENAME_LENGTH - ext.length).join('') + ext.join('');
};

// Browsers send the multipart filename as raw UTF-8 bytes with no charset
// parameter. busboy's default for that case is latin1, which turns
// "café.jpg" into "cafÃ©.jpg" (#86). defParamCharset is a multer 2 option
// that @types/multer does not declare yet.
const options: multer.Options & { defParamCharset: string } = {
  storage,
  fileFilter,
  defParamCharset: 'utf8',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max for high-res photos
  },
};

export const upload = multer(options);
