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

// Extend Express Request type to include user from auth middleware
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
