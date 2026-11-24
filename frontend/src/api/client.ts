import type {
  Gallery,
  Photo,
  PublicPhoto,
  ApiResponse,
  AdminStats,
  AnalyticsData,
  CreateGalleryInput,
  UpdateGalleryInput,
  PrivateGalleryResponse,
  GalleryAccessResponse,
} from '../types';
import { ApiError } from './errors';

// In production (HTTPS), use relative path since nginx proxies /api
// In dev (HTTP), use port 3001 directly
const API_BASE = import.meta.env.VITE_API_URL ||
  (window.location.protocol === 'https:' ? '/api' : `http://${window.location.hostname}:3001/api`);

// ============ Simple In-Memory Cache ============
// Makes back navigation instant. Photo URLs in a response stay valid for at
// least 50 minutes when the API sends them (MIN_REMAINING_LIFETIME_MS in
// backend/src/services/s3Service.ts), so this must stay well under that.
//
// Only the public getters below fill it, and only public pages call them.
// The admin UI is a separate page load (its own origin in production), so its
// cache never holds these entries and admin mutations have nothing to clear.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
// Requests still in flight, so callers that ask for the same data at once
// (a remount, StrictMode's double effects) share one request.
const inflight = new Map<string, Promise<unknown>>();

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

// Clear cache for a specific prefix
export function clearCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    inflight.clear();
    return;
  }
  for (const map of [cache, inflight]) {
    for (const key of map.keys()) {
      if (key.startsWith(prefix)) {
        map.delete(key);
      }
    }
  }
}

// ============ Public API ============


// `fresh` skips this module's cache and revalidates the browser's HTTP cache,
// for reloading photos whose signed URLs have expired.
export interface FetchOptions {
  fresh?: boolean;
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetch(
    `${API_BASE}${endpoint}`,
    options.fresh ? { cache: 'no-cache' } : undefined
  );

  if (!response.ok) {
    throw new ApiError(`API request failed: ${response.status} ${response.statusText}`, response.status);
  }

  const data: ApiResponse<T> = await response.json();

  if (!data.success || !data.data) {
    throw new Error(data.error || 'API request failed');
  }

  return data.data;
}

// A fresh request never joins one in flight, since that one may carry the
// expired URLs. It takes over the key instead: only the newest request for a
// key fills the cache, so an older response cannot overwrite a fresher one.
function fetchCached<T>(key: string, endpoint: string, options: FetchOptions = {}): Promise<T> {
  if (!options.fresh) {
    const cached = getCached<T>(key);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const request: Promise<T> = fetchApi<T>(endpoint, options).then(
    (data) => {
      if (inflight.get(key) === request) {
        inflight.delete(key);
        cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
      }
      return data;
    },
    (error: unknown) => {
      if (inflight.get(key) === request) inflight.delete(key);
      throw error;
    }
  );
  inflight.set(key, request);
  return request;
}

export function getFeaturedPhotos(): Promise<PublicPhoto[]> {
  return fetchCached<PublicPhoto[]>('featured', '/featured');
}

export function getAllPhotos(limit?: number, options: FetchOptions = {}): Promise<PublicPhoto[]> {
  return fetchCached<PublicPhoto[]>(
    limit ? `allPhotos:${limit}` : 'allPhotos',
    limit ? `/photos?limit=${limit}` : '/photos',
    options
  );
}

export function getGalleries(): Promise<Gallery[]> {
  return fetchCached<Gallery[]>('galleries', '/galleries');
}

// Slugs whose latest metadata response said private. Kept for the page's
// lifetime, past the cache TTL: privacy rarely changes, and a wrong guess
// costs only a photos request after the metadata instead of alongside it.
const privateSlugs = new Set<string>();

export async function getGallery(slug: string): Promise<Gallery | PrivateGalleryResponse> {
  const data = await fetchCached<Gallery | PrivateGalleryResponse>(`gallery:${slug}`, `/galleries/${slug}`);
  if ('requires_password' in data && data.requires_password === true) {
    privateSlugs.add(slug);
  } else {
    privateSlugs.delete(slug);
  }
  return data;
}

/**
 * Whether an earlier metadata response showed this gallery as private. The
 * public galleries list cannot answer this: it lists only public galleries.
 */
export function isKnownPrivateGallery(slug: string): boolean {
  return privateSlugs.has(slug);
}

export function getGalleryPhotos(
  slug: string,
  accessToken?: string,
  options: FetchOptions = {}
): Promise<PublicPhoto[]> {
  const cacheKey = accessToken ? `photos:${slug}:${accessToken}` : `photos:${slug}`;
  const url = accessToken
    ? `/galleries/${slug}/photos?access=${encodeURIComponent(accessToken)}`
    : `/galleries/${slug}/photos`;
  return fetchCached<PublicPhoto[]>(cacheKey, url, options);
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

  // A refused or failed request may carry no JSON body.
  const data: ApiResponse<GalleryAccessResponse> | null = await response.json().catch(() => null);

  if (!response.ok || !data?.success || !data.data) {
    const serverMessage = data?.error || null;
    throw new ApiError(serverMessage || 'Password verification failed', response.status, serverMessage);
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

/**
 * Revoke every admin session on the server. Best effort: the caller clears
 * the local token either way.
 */
export async function logout(token: string): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ============ Admin API (Authenticated) ============

// Called when the server refuses the admin token (expired, or revoked by a
// logout elsewhere), so the app can sign out instead of showing errors.
let sessionExpiredHandler: (() => void) | null = null;

export function onSessionExpired(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

function checkSession(status: number): void {
  if (status === 401) sessionExpiredHandler?.();
}

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
  checkSession(response.status);

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
  return fetchApiAuth<Gallery>('/galleries', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateGallery(
  token: string,
  id: string,
  data: UpdateGalleryInput
): Promise<Gallery> {
  return fetchApiAuth<Gallery>(`/galleries/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteGallery(token: string, id: string): Promise<{ deleted: boolean }> {
  return fetchApiAuth<{ deleted: boolean }>(`/galleries/${id}`, token, {
    method: 'DELETE',
  });
}

export async function reorderGalleries(
  token: string,
  galleryIds: string[]
): Promise<{ reordered: boolean }> {
  return fetchApiAuth<{ reordered: boolean }>('/galleries/reorder', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gallery_ids: galleryIds }),
  });
}

export async function setCoverImage(
  token: string,
  galleryId: string,
  photoId: string | null
): Promise<Gallery> {
  return fetchApiAuth<Gallery>(`/galleries/${galleryId}/cover`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId }),
  });
}

// Photo Management
export async function getPhotosByGallery(token: string, galleryId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>(`/galleries/${galleryId}/photos/admin`, token);
}

export async function getUnassignedPhotos(token: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/photos/admin/unassigned', token);
}

// Duplicate detection
export interface DuplicateInfo {
  id: string;
  original_filename: string;
  gallery_id: string | null;
  gallery_title: string | null;
}

// Returns a map of content hash -> existing photo, for hashes already uploaded
export async function checkDuplicates(
  token: string,
  hashes: string[]
): Promise<Record<string, DuplicateInfo>> {
  const found: Record<string, DuplicateInfo> = {};
  // Chunk to stay under the API's per-request hash limit
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const data = await fetchApiAuth<Record<string, DuplicateInfo>>(
      '/photos/admin/check-duplicates',
      token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: chunk }),
      }
    );
    Object.assign(found, data);
  }
  return found;
}

/** A rejected upload. status is the HTTP status, or 0 when no response arrived. */
export class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

export async function uploadPhoto(
  token: string,
  galleryId: string | null,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Photo> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError('Upload aborted', 0));
      return;
    }
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('photo', file);
    if (galleryId) {
      formData.append('galleryId', galleryId);
    }

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      // Before parsing: a 401 from a proxy may not be JSON, and the session
      // must still end.
      checkSession(xhr.status);
      try {
        const data: ApiResponse<Photo> = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success && data.data) {
          resolve(data.data);
        } else {
          reject(new UploadError(data.error || 'Upload failed', xhr.status));
        }
      } catch {
        // Not JSON: the response came from the proxy (nginx), not the API.
        const message =
          xhr.status === 413 ? 'File is larger than the server accepts' : `Upload failed (HTTP ${xhr.status})`;
        reject(new UploadError(message, xhr.status));
      }
    });

    xhr.addEventListener('error', () => reject(new UploadError('Upload failed', 0)));
    xhr.addEventListener('abort', () => reject(new UploadError('Upload aborted', 0)));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.open('POST', `${API_BASE}/photos/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function updatePhoto(
  token: string,
  id: string,
  data: { is_hidden?: boolean; sort_order?: number }
): Promise<Photo> {
  return fetchApiAuth<Photo>(`/photos/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deletePhoto(token: string, id: string): Promise<{ deleted: boolean }> {
  return fetchApiAuth<{ deleted: boolean }>(`/photos/${id}`, token, {
    method: 'DELETE',
  });
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

// A null targetGalleryId moves the photos to Unassigned.
export async function movePhotos(
  token: string,
  photoIds: string[],
  targetGalleryId: string | null
): Promise<{ moved: number }> {
  return fetchApiAuth<{ moved: number }>('/photos/move', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds, target_gallery_id: targetGalleryId }),
  });
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
 * A signed URL that downloads the photo's original under its uploaded
 * filename. Fetched when the download button is pressed, not with the photo
 * lists, so lists never sign originals; the request also counts the download.
 * A photo in a private gallery needs that gallery's access token.
 */
export async function getPhotoDownloadUrl(photoId: string, accessToken?: string): Promise<string> {
  const query = accessToken ? `?access=${encodeURIComponent(accessToken)}` : '';
  const data = await fetchApi<{ downloadUrl: string }>(`/photos/${photoId}/download${query}`);
  return data.downloadUrl;
}

// ============ Contact Form ============

export async function sendContactMessage(
  name: string,
  email: string,
  message: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, message }),
  });

  // A refused or failed request may carry no JSON body.
  const data: ApiResponse<{ sent: boolean }> | null = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    const serverMessage = data?.error || null;
    throw new ApiError(serverMessage || 'Failed to send message', response.status, serverMessage);
  }
}

// ============ Homepage Management ============

export async function getHomepagePhotos(token: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage', token);
}

export async function setHeroPhoto(token: string, photoId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/hero', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: photoId }),
  });
}

export async function addToHomepage(token: string, photoId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/featured', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: photoId }),
  });
}

export async function removeFromHomepage(token: string, photoId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/featured', token, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: photoId }),
  });
}

export async function reorderHomepagePhotos(token: string, photoIds: string[]): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/reorder', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds }),
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
