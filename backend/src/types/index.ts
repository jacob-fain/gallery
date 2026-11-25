import type { ReviewStatus } from '../services/reviewStatus';

// EXIF metadata extracted from photos
export interface ExifData {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  iso?: number;
  aperture?: number;
  shutterSpeed?: number;
  focalLength?: number;
  // Camera wall-clock time, with OffsetTimeOriginal appended when recorded.
  dateTaken?: string;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  token_version: number;
  created_at: Date;
}

export interface Gallery {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image_id: string | null;
  is_public: boolean;
  password_hash: string | null;
  /** Moved on whenever the password or visibility changes; access tokens must match it. */
  access_version: number;
  view_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface Photo {
  id: string;
  gallery_id: string | null;
  filename: string;
  original_filename: string;
  s3_key: string;
  s3_thumbnail_key: string;
  s3_web_key: string;
  width: number;
  height: number;
  file_size: number;
  sort_order: number;
  is_featured: boolean;
  /** Kept equal to review_status <> 'shown' by a trigger until it is dropped; read review_status. */
  is_hidden: boolean;
  review_status: ReviewStatus;
  // 0 is the homepage hero, 1+ the featured photos, null not on the homepage.
  featured_order?: number | null;
  view_count: number;
  download_count: number;
  uploaded_at: Date;
  exif_data?: ExifData;
  content_hash?: string | null;
  // MIME type of the stored original, from its bytes. Null for photos
  // uploaded before it was recorded (#87).
  original_content_type?: string | null;
}

// Photo with signed S3 URLs for frontend consumption
export interface PhotoWithUrls extends Photo {
  url: string;          // Signed URL for original (downloads)
  webUrl: string;       // Signed URL for web version (lightbox)
  thumbnailUrl: string; // Signed URL for thumbnail (grid)
}

// API response types
export interface GalleryWithCover extends Gallery {
  cover_photo?: Photo;
}

// Gallery with cover photo URL for frontend display
export interface GalleryWithCoverUrl extends Gallery {
  /** Thumbnail of the cover photo (at most 600px wide). */
  coverUrl: string | null;
  /** Web size of the cover photo (at most 1920px wide). */
  coverWebUrl: string | null;
  /** The cover photo's displayed size, from which the derived widths follow. */
  coverWidth: number | null;
  coverHeight: number | null;
  /** Photos a visitor sees in the gallery: only shown ones are counted. */
  photoCount: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Auth types
export interface JwtPayload {
  userId: string;
  email: string;
  /** The user's token_version when this token was issued. */
  tokenVersion: number;
}

// Gallery access token payload (for private gallery password verification)
export interface GalleryAccessPayload {
  galleryId: string;
  slug: string;
  /** The gallery's access_version when this token was issued. */
  accessVersion: number;
}

// Input type for creating a photo record
export interface CreatePhotoInput {
  gallery_id: string | null;
  filename: string;
  original_filename: string;
  s3_key: string;
  s3_thumbnail_key: string;
  s3_web_key: string;
  width: number;
  height: number;
  file_size: number;
  exif_data?: ExifData;
  content_hash?: string;
  original_content_type?: string;
}

// Input type for creating a gallery
export interface CreateGalleryInput {
  title: string;
  slug: string;
  description?: string;
  is_public?: boolean;
  password?: string; // Plain text, will be hashed
}

// Input type for updating a gallery
export interface UpdateGalleryInput {
  title?: string;
  slug?: string;
  description?: string | null;
  is_public?: boolean;
  password?: string | null; // null to remove password
}

// Input type for updating a photo
export interface UpdatePhotoInput {
  review_status?: ReviewStatus;
  sort_order?: number;
}

// Extend Express Request type to include user from auth middleware
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
