export interface Gallery {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image_id: string | null;
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
  view_count: number;
  download_count: number;
  uploaded_at: string;
  // Joined fields from featured query
  gallery_title?: string;
  gallery_slug?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
