import type { Gallery, Photo, ApiResponse } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  const data: ApiResponse<T> = await response.json();

  if (!data.success || !data.data) {
    throw new Error(data.error || 'API request failed');
  }

  return data.data;
}

export async function getFeaturedPhotos(): Promise<Photo[]> {
  return fetchApi<Photo[]>('/featured');
}

export async function getGalleries(): Promise<Gallery[]> {
  return fetchApi<Gallery[]>('/galleries');
}

export async function getGallery(slug: string): Promise<Gallery> {
  return fetchApi<Gallery>(`/galleries/${slug}`);
}

export async function getGalleryPhotos(slug: string): Promise<Photo[]> {
  return fetchApi<Photo[]>(`/galleries/${slug}/photos`);
}
