// EXIF metadata extracted from photos
export interface ExifData {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  // An array only on photos uploaded before the parser kept the first value.
  iso?: number | number[];
  aperture?: number;
  shutterSpeed?: number;
  focalLength?: number;
  // Camera wall-clock time: "2024-06-01T14:30:00", with the camera's offset
  // appended when it recorded one. Older uploads end in a "Z" that is not UTC.
  // Display it with formatDateTaken, never through new Date().
  dateTaken?: string;
}

// Public responses carry only the fields backend/src/services/galleryView.ts sends.
export interface Gallery {
  id: string;
  title: string;
  slug: string;
  // Set on a single gallery (GET /galleries/:slug, or the unlock response)
  // and on the public gallery list: how many photos a visitor sees.
  photoCount?: number;
  // Set on the public gallery list: the cover photo's thumbnail and web
  // URLs and its displayed size.
  coverUrl?: string | null;
  coverWebUrl?: string | null;
  coverWidth?: number | null;
  coverHeight?: number | null;
  // Set on admin responses and on a single gallery's public response.
  description?: string | null;
  // Set on admin responses only. has_password says whether a password is
  // stored, never the password.
  cover_image_id?: string | null;
  is_public?: boolean;
  has_password?: boolean;
  view_count?: number;
  created_at?: string;
  updated_at?: string;
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
  // SHA-256 of the original file (duplicate detection)
  content_hash?: string | null;
  // Joined fields from featured query
  gallery_title?: string;
  gallery_slug?: string;
}

// A photo as the public endpoints return it (PublicPhoto in
// backend/src/services/photoView.ts). It has no original URL: the download
// button asks GET /photos/:id/download for one.
export interface PublicPhoto {
  id: string;
  gallery_id: string | null;
  width: number;
  height: number;
  exif_data: ExifData | null;
  webUrl: string;
  thumbnailUrl: string;
  // Set on featured photos and on All Photos; null for a photo in no gallery.
  gallery_title?: string | null;
  gallery_slug?: string | null;
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
  photoCount: number;
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
    gallery_id: string | null;
    gallery_title: string;
    thumbnailUrl: string;
    view_count: number;
    download_count: number;
  }[];
  storage: {
    total_bytes: number;
    galleries: { id: string | null; title: string; bytes: number }[];
  };
}
