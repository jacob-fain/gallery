// EXIF metadata extracted from photos
export interface ExifData {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  iso?: number;
  aperture?: number;
  shutterSpeed?: number;
  focalLength?: number;
  dateTaken?: string;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
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
  view_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface Photo {
  id: string;
  gallery_id: string;
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
  view_count: number;
  download_count: number;
  uploaded_at: Date;
  exif_data?: ExifData;
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
  coverUrl: string | null;
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
}

// Gallery access token payload (for private gallery password verification)
export interface GalleryAccessPayload {
  galleryId: string;
  slug: string;
}

// Input type for creating a photo record
export interface CreatePhotoInput {
  gallery_id: string;
  filename: string;
  original_filename: string;
  s3_key: string;
  s3_thumbnail_key: string;
  s3_web_key: string;
  width: number;
  height: number;
  file_size: number;
  exif_data?: ExifData;
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
  is_featured?: boolean;
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
