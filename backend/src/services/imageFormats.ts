/**
 * The formats an original may be stored in. Only sharp, reading the bytes,
 * decides which one an upload is: the client's MIME type and filename are
 * claims, and an original served under the wrong type or extension will not
 * open in some viewers (#87).
 */
export interface OriginalFormat {
  contentType: string;
  /** Used for the S3 key and for download names that lack a fitting one. */
  extension: string;
  /** Every extension a viewer recognises for this type, lowercase, no dot. */
  extensions: readonly string[];
}

const JPEG: OriginalFormat = { contentType: 'image/jpeg', extension: 'jpg', extensions: ['jpg', 'jpeg', 'jpe'] };
const PNG: OriginalFormat = { contentType: 'image/png', extension: 'png', extensions: ['png'] };
const WEBP: OriginalFormat = { contentType: 'image/webp', extension: 'webp', extensions: ['webp'] };
const TIFF: OriginalFormat = { contentType: 'image/tiff', extension: 'tif', extensions: ['tif', 'tiff'] };
const HEIC: OriginalFormat = { contentType: 'image/heic', extension: 'heic', extensions: ['heic', 'heif'] };
const AVIF: OriginalFormat = { contentType: 'image/avif', extension: 'avif', extensions: ['avif'] };

const FORMATS = [JPEG, PNG, WEBP, TIFF, HEIC, AVIF];

/**
 * The stored format for what sharp's metadata reports, or null when uploads
 * do not accept it. sharp calls both HEIC and AVIF "heif"; the compression
 * tells them apart.
 */
export const originalFormatFor = (format?: string, compression?: string): OriginalFormat | null => {
  switch (format) {
    case 'jpeg':
      return JPEG;
    case 'png':
      return PNG;
    case 'webp':
      return WEBP;
    case 'tiff':
      return TIFF;
    case 'heif':
      return compression === 'av1' ? AVIF : HEIC;
    default:
      return null;
  }
};

export const formatForContentType = (contentType: string | null | undefined): OriginalFormat | null =>
  FORMATS.find((f) => f.contentType === contentType) ?? null;

const KNOWN_IMAGE_EXTENSIONS = new Set(FORMATS.flatMap((f) => f.extensions));

/**
 * The name with an extension that matches the stored format. A name that
 * claims another image format has its extension replaced ("IMG_1.jpg" holding
 * PNG bytes becomes "IMG_1.png"); any other name keeps its text and gains the
 * extension ("Sunset" becomes "Sunset.jpg").
 */
export const withFormatExtension = (name: string, format: OriginalFormat): string => {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (format.extensions.includes(ext)) return name;
  const stem = KNOWN_IMAGE_EXTENSIONS.has(ext) ? name.slice(0, dot) : name;
  return `${stem}.${format.extension}`;
};
