import type {
  Gallery,
  Photo,
  ApiResponse,
  AdminStats,
  AnalyticsData,
  CreateGalleryInput,
  UpdateGalleryInput,
  PrivateGalleryResponse,
  GalleryAccessResponse,
} from '../types';

// In dev, use same hostname as frontend so it works when accessing via IP
const API_BASE = import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:3001/api`;

// ============ Simple In-Memory Cache ============
// Cache TTL: 5 minutes - makes back navigation instant
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) {
    return entry.data as T;
  }
  if (entry) {
    cache.delete(key);
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// Clear cache for a specific prefix (used when data is modified)
export function clearCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

// ============ Public API ============

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data: ApiResponse<T> = await response.json();

  if (!data.success || !data.data) {
    throw new Error(data.error || 'API request failed');
  }

  return data.data;
}

export async function getFeaturedPhotos(): Promise<Photo[]> {
  const cacheKey = 'featured';
  const cached = getCached<Photo[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchApi<Photo[]>('/featured');
  setCache(cacheKey, data);
  return data;
}

export async function getGalleries(): Promise<Gallery[]> {
  const cacheKey = 'galleries';
  const cached = getCached<Gallery[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchApi<Gallery[]>('/galleries');
  setCache(cacheKey, data);
  return data;
}

export async function getGallery(slug: string): Promise<Gallery | PrivateGalleryResponse> {
  const cacheKey = `gallery:${slug}`;
  const cached = getCached<Gallery | PrivateGalleryResponse>(cacheKey);
  if (cached) return cached;

  const data = await fetchApi<Gallery | PrivateGalleryResponse>(`/galleries/${slug}`);
  setCache(cacheKey, data);
  return data;
}

export async function getGalleryPhotos(slug: string, accessToken?: string): Promise<Photo[]> {
  const cacheKey = accessToken ? `photos:${slug}:${accessToken}` : `photos:${slug}`;
  const cached = getCached<Photo[]>(cacheKey);
  if (cached) return cached;

  const url = accessToken
    ? `/galleries/${slug}/photos?access=${encodeURIComponent(accessToken)}`
    : `/galleries/${slug}/photos`;
  const data = await fetchApi<Photo[]>(url);
  setCache(cacheKey, data);
  return data;
}

export async function verifyGalleryPassword(
  slug: string,
  password: string
): Promise<GalleryAccessResponse> {
  const response = await fetch(`${API_BASE}/galleries/${slug}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  const data: ApiResponse<GalleryAccessResponse> = await response.json();

  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.error || 'Password verification failed');
  }

  return data.data;
}

// ============ Auth API ============

export interface User {
  id: string;
  email: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data: ApiResponse<LoginResponse> = await response.json();

  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.error || 'Login failed');
  }

  return data.data;
}

export async function getCurrentUser(token: string): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data: ApiResponse<User> = await response.json();

  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.error || 'Failed to get current user');
  }

  return data.data;
}

// ============ Admin API (Authenticated) ============

async function fetchApiAuth<T>(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  const data: ApiResponse<T> = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'API request failed');
  }

  return data.data as T;
}

// Admin Stats
export async function getAdminStats(token: string): Promise<AdminStats> {
  return fetchApiAuth<AdminStats>('/admin/stats', token);
}

// Admin Analytics
export async function getAnalytics(token: string): Promise<AnalyticsData> {
  return fetchApiAuth<AnalyticsData>('/admin/analytics', token);
}

// Gallery Management
export async function getAllGalleries(token: string): Promise<Gallery[]> {
  return fetchApiAuth<Gallery[]>('/galleries/admin/all', token);
}

export async function createGallery(token: string, data: CreateGalleryInput): Promise<Gallery> {
  const result = await fetchApiAuth<Gallery>('/galleries', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  clearCache('galleries');
  return result;
}

export async function updateGallery(
  token: string,
  id: string,
  data: UpdateGalleryInput
): Promise<Gallery> {
  const result = await fetchApiAuth<Gallery>(`/galleries/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  clearCache('galleries');
  clearCache('gallery:');
  return result;
}

export async function deleteGallery(token: string, id: string): Promise<{ deleted: boolean }> {
  const result = await fetchApiAuth<{ deleted: boolean }>(`/galleries/${id}`, token, {
    method: 'DELETE',
  });
  clearCache('galleries');
  clearCache('gallery:');
  clearCache('photos:');
  return result;
}

export async function reorderGalleries(
  token: string,
  galleryIds: string[]
): Promise<{ reordered: boolean }> {
  const result = await fetchApiAuth<{ reordered: boolean }>('/galleries/reorder', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gallery_ids: galleryIds }),
  });
  clearCache('galleries');
  return result;
}

export async function setCoverImage(
  token: string,
  galleryId: string,
  photoId: string | null
): Promise<Gallery> {
  const result = await fetchApiAuth<Gallery>(`/galleries/${galleryId}/cover`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId }),
  });
  clearCache('galleries');
  return result;
}

// Photo Management
export async function getPhotosByGallery(token: string, galleryId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>(`/galleries/${galleryId}/photos/admin`, token);
}

export async function uploadPhoto(
  token: string,
  galleryId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('galleryId', galleryId);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const data: ApiResponse<Photo> = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success && data.data) {
          resolve(data.data);
        } else {
          reject(new Error(data.error || 'Upload failed'));
        }
      } catch {
        reject(new Error('Failed to parse response'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('POST', `${API_BASE}/photos/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function updatePhoto(
  token: string,
  id: string,
  data: { is_featured?: boolean; sort_order?: number }
): Promise<Photo> {
  return fetchApiAuth<Photo>(`/photos/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deletePhoto(token: string, id: string): Promise<{ deleted: boolean }> {
  const result = await fetchApiAuth<{ deleted: boolean }>(`/photos/${id}`, token, {
    method: 'DELETE',
  });
  clearCache('photos:');
  clearCache('featured');
  clearCache('galleries');
  return result;
}

export async function reorderPhotos(
  token: string,
  galleryId: string,
  photoIds: string[]
): Promise<{ reordered: boolean }> {
  return fetchApiAuth<{ reordered: boolean }>('/photos/reorder', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gallery_id: galleryId, photo_ids: photoIds }),
  });
}

export async function movePhotos(
  token: string,
  photoIds: string[],
  targetGalleryId: string
): Promise<{ moved: number }> {
  const result = await fetchApiAuth<{ moved: number }>('/photos/move', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds, target_gallery_id: targetGalleryId }),
  });
  clearCache('photos:');
  clearCache('galleries');
  return result;
}

// ============ Gallery ZIP Download ============

/**
 * Get the URL for downloading a gallery as ZIP
 * For private galleries, include the access token
 */
export function getGalleryDownloadUrl(slug: string, accessToken?: string): string {
  const url = `${API_BASE}/galleries/${slug}/download`;
  if (accessToken) {
    return `${url}?access=${encodeURIComponent(accessToken)}`;
  }
  return url;
}

// ============ Analytics Tracking (Public, fire-and-forget) ============

/**
 * Track a photo view - call when user opens/navigates to a photo in lightbox
 */
export function trackPhotoView(photoId: string): void {
  fetch(`${API_BASE}/photos/${photoId}/view`, { method: 'POST' }).catch(() => {
    // Silently ignore errors - tracking should not affect UX
  });
}

/**
 * Track a photo download - call when user clicks download button
 */
export function trackPhotoDownload(photoId: string): void {
  fetch(`${API_BASE}/photos/${photoId}/download-track`, { method: 'POST' }).catch(() => {
    // Silently ignore errors - tracking should not affect UX
  });
}

// ============ Site Settings ============

export interface SiteSettings {
  site_title: string;
  meta_description: string;
}

/**
 * Get site settings (public)
 */
export async function getSettings(): Promise<SiteSettings> {
  return fetchApi<SiteSettings>('/settings');
}

/**
 * Update site settings (admin only)
 */
export async function updateSettings(
  token: string,
  settings: Partial<SiteSettings>
): Promise<SiteSettings> {
  return fetchApiAuth<SiteSettings>('/settings/admin', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
