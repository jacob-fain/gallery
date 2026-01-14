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

export interface Gallery {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image_id: string | null;
  coverUrl: string | null;
  is_public: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
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
  is_hidden: boolean;
  view_count: number;
  download_count: number;
  uploaded_at: string;
  // Enriched URLs from S3
  url?: string;
  webUrl?: string;
  thumbnailUrl?: string;
  // EXIF metadata
  exif_data?: ExifData;
  // Joined fields from featured query
  gallery_title?: string;
  gallery_slug?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Admin types
export interface AdminStats {
  galleries: {
    total: number;
    public: number;
    private: number;
  };
  photos: {
    total: number;
    featured: number;
  };
  views: {
    galleries: number;
    photos: number;
  };
  downloads: number;
}

export interface CreateGalleryInput {
  title: string;
  slug: string;
  description?: string;
  is_public?: boolean;
  password?: string;
}

export interface UpdateGalleryInput {
  title?: string;
  slug?: string;
  description?: string | null;
  is_public?: boolean;
  password?: string | null;
}

// Response when accessing a private gallery without authentication
export interface PrivateGalleryResponse {
  title: string;
  slug: string;
  is_public: false;
  requires_password: true;
}

// Response after successfully verifying gallery password
export interface GalleryAccessResponse {
  title: string;
  slug: string;
  description: string | null;
  is_public: boolean;
  verified: true;
  accessToken: string;
}

// Analytics types
export interface AnalyticsData {
  viewsOverTime: { date: string; views: number }[];
  uploadActivity: { date: string; count: number }[];
  topGalleries: { id: string; title: string; slug: string; view_count: number }[];
  topPhotos: {
    id: string;
    filename: string;
    gallery_id: string;
    gallery_title: string;
    thumbnailUrl: string;
    view_count: number;
    download_count: number;
  }[];
  storage: {
    total_bytes: number;
    galleries: { id: string; title: string; bytes: number }[];
  };
}
