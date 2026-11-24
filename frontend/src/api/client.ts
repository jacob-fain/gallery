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
export const API_BASE = import.meta.env.VITE_API_URL ||
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

// The list endpoints put paging fields beside data.
type ApiBody<T> = ApiResponse<T> & { nextCursor?: string | null; total?: number };

// A private gallery's access token travels in this header, never in a URL:
// nginx's error log records the full request line when the API fails.
const GALLERY_ACCESS_HEADER = 'X-Gallery-Access';

const accessHeaders = (accessToken?: string): Record<string, string> | undefined =>
  accessToken ? { [GALLERY_ACCESS_HEADER]: accessToken } : undefined;

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}, accessToken?: string): Promise<T> {
  return (await fetchApiBody<T>(endpoint, options, accessToken)).data;
}

async function fetchApiBody<T>(
  endpoint: string,
  options: FetchOptions = {},
  accessToken?: string
): Promise<ApiBody<T> & { data: T }> {
  const init: RequestInit = {};
  if (options.fresh) init.cache = 'no-cache';
  const headers = accessHeaders(accessToken);
  if (headers) init.headers = headers;
  const response = await fetch(`${API_BASE}${endpoint}`, Object.keys(init).length ? init : undefined);

  if (!response.ok) {
    throw new ApiError(`API request failed: ${response.status} ${response.statusText}`, response.status);
  }

  const data: ApiBody<T> = await response.json();

  if (!data.success || !data.data) {
    throw new Error(data.error || 'API request failed');
  }

  return data as ApiBody<T> & { data: T };
}

// A fresh request never joins one in flight, since that one may carry the
// expired URLs. It takes over the key instead: only the newest request for a
// key fills the cache, so an older response cannot overwrite a fresher one.
function fetchCached<T>(key: string, endpoint: string, options: FetchOptions = {}, accessToken?: string): Promise<T> {
  return cachedRequest(key, options, () => fetchApi<T>(endpoint, options, accessToken));
}

function cachedRequest<T>(key: string, options: FetchOptions, load: () => Promise<T>): Promise<T> {
  if (!options.fresh) {
    const cached = getCached<T>(key);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const request: Promise<T> = load().then(
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
  if (limit) return fetchCached<PublicPhoto[]>(`allPhotos:${limit}`, `/photos?limit=${limit}`, options);
  // The API sends the list in pages. All Photos shuffles the whole set and
  // its lightbox walks all of it, so every page is fetched.
  return cachedRequest('allPhotos', options, async () => {
    const data: PublicPhoto[] = [];
    let cursor: string | null = null;
    do {
      const page: ApiBody<PublicPhoto[]> & { data: PublicPhoto[] } = await fetchApiBody<PublicPhoto[]>(
        cursor ? `/photos?cursor=${encodeURIComponent(cursor)}` : '/photos',
        options
      );
      data.push(...page.data);
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return data;
  });
}

export function getGalleries(): Promise<Gallery[]> {
  return fetchCached<Gallery[]>('galleries', '/galleries');
}

// Slugs whose latest metadata response said private. Kept for the page's
// lifetime, past the cache TTL: privacy rarely changes, and a wrong guess
// costs only a photos request after the metadata instead of alongside it.
const privateSlugs = new Set<string>();

// React Router hands the page a decoded slug, so a slug from the address bar
// can hold "/", "?" or "..". Encoded, it stays one path segment.
const galleryPath = (slug: string) => `/galleries/${encodeURIComponent(slug)}`;

export async function getGallery(slug: string): Promise<Gallery | PrivateGalleryResponse> {
  const data = await fetchCached<Gallery | PrivateGalleryResponse>(`gallery:${slug}`, galleryPath(slug));
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
  return fetchCached<PublicPhoto[]>(cacheKey, `${galleryPath(slug)}/photos`, options, accessToken);
}

export async function verifyGalleryPassword(
  slug: string,
  password: string
): Promise<GalleryAccessResponse> {
  const response = await fetch(`${API_BASE}${galleryPath(slug)}/verify`, {
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
  user: User;
}

// The admin session is an httpOnly cookie the API sets on login, so page
// scripts never see the token. 'include' rather than 'same-origin' because
// local development serves the API from another port.
const WITH_SESSION: RequestCredentials = 'include';

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    credentials: WITH_SESSION,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data: ApiResponse<LoginResponse> = await response.json();

  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.error || 'Login failed');
  }

  return data.data;
}

export async function getCurrentUser(): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/me`, { credentials: WITH_SESSION });

  const data: ApiResponse<User> = await response.json();

  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.error || 'Failed to get current user');
  }

  return data.data;
}

/**
 * Revoke every admin session on the server and clear the session cookie.
 * Best effort: the caller signs out locally either way.
 */
export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: WITH_SESSION });
}

// ============ Admin API (Authenticated) ============

// Called when the server refuses the admin session (expired, or revoked by a
// logout elsewhere), so the app can sign out instead of showing errors.
let sessionExpiredHandler: (() => void) | null = null;

export function onSessionExpired(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

function checkSession(status: number): void {
  if (status === 401) sessionExpiredHandler?.();
}

async function fetchApiAuth<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  return (await fetchApiAuthBody<T>(endpoint, options)).data as T;
}

async function fetchApiAuthBody<T>(endpoint: string, options: RequestInit = {}): Promise<ApiBody<T>> {
  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, credentials: WITH_SESSION });
  checkSession(response.status);

  const data: ApiBody<T> = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'API request failed');
  }

  return data;
}

// Admin Stats
export async function getAdminStats(): Promise<AdminStats> {
  return fetchApiAuth<AdminStats>('/admin/stats');
}

// Admin Analytics
export async function getAnalytics(): Promise<AnalyticsData> {
  return fetchApiAuth<AnalyticsData>('/admin/analytics');
}

// Gallery Management
export async function getAllGalleries(): Promise<Gallery[]> {
  return fetchApiAuth<Gallery[]>('/galleries/admin/all');
}

export async function createGallery(data: CreateGalleryInput): Promise<Gallery> {
  return fetchApiAuth<Gallery>('/galleries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateGallery(
  id: string,
  data: UpdateGalleryInput
): Promise<Gallery> {
  return fetchApiAuth<Gallery>(`/galleries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteGallery(id: string): Promise<{ deleted: boolean }> {
  return fetchApiAuth<{ deleted: boolean }>(`/galleries/${id}`, {
    method: 'DELETE',
  });
}

export async function reorderGalleries(
  galleryIds: string[]
): Promise<{ reordered: boolean }> {
  return fetchApiAuth<{ reordered: boolean }>('/galleries/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gallery_ids: galleryIds }),
  });
}

export async function setCoverImage(
  galleryId: string,
  photoId: string | null
): Promise<Gallery> {
  return fetchApiAuth<Gallery>(`/galleries/${galleryId}/cover`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId }),
  });
}

// Photo Management

/** A page of an admin photo list, and the length of the whole list. */
export interface PhotoPage {
  photos: Photo[];
  total: number;
}

async function fetchPhotoPage(endpoint: string, offset: number, limit: number): Promise<PhotoPage> {
  const body = await fetchApiAuthBody<Photo[]>(`${endpoint}?limit=${limit}&offset=${offset}`);
  const photos = body.data ?? [];
  return { photos, total: body.total ?? photos.length };
}

export function getGalleryPhotosPage(galleryId: string, offset: number, limit: number) {
  return fetchPhotoPage(`/galleries/${galleryId}/photos/admin`, offset, limit);
}

export function getUnassignedPhotosPage(offset: number, limit: number) {
  return fetchPhotoPage('/photos/admin/unassigned', offset, limit);
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
  hashes: string[]
): Promise<Record<string, DuplicateInfo>> {
  const found: Record<string, DuplicateInfo> = {};
  // Chunk to stay under the API's per-request hash limit
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const data = await fetchApiAuth<Record<string, DuplicateInfo>>(
      '/photos/admin/check-duplicates',
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
    xhr.withCredentials = true;
    xhr.send(formData);
  });
}

export async function updatePhoto(
  id: string,
  data: { is_hidden?: boolean; sort_order?: number }
): Promise<Photo> {
  return fetchApiAuth<Photo>(`/photos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deletePhoto(id: string): Promise<{ deleted: boolean }> {
  return fetchApiAuth<{ deleted: boolean }>(`/photos/${id}`, {
    method: 'DELETE',
  });
}

export async function reorderPhotos(
  galleryId: string,
  photoIds: string[]
): Promise<{ reordered: boolean }> {
  return fetchApiAuth<{ reordered: boolean }>('/photos/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gallery_id: galleryId, photo_ids: photoIds }),
  });
}

// A null targetGalleryId moves the photos to Unassigned.
export async function movePhotos(
  photoIds: string[],
  targetGalleryId: string | null
): Promise<{ moved: number }> {
  return fetchApiAuth<{ moved: number }>('/photos/move', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds, target_gallery_id: targetGalleryId }),
  });
}

// ============ Gallery ZIP Download ============

/**
 * The URL that downloads a gallery as a ZIP. The download is a navigation,
 * which cannot send the access header, so a private gallery's URL carries a
 * one-time ticket (valid for a minute) that the token buys, never the token.
 */
export async function getGalleryDownloadUrl(slug: string, accessToken?: string): Promise<string> {
  const url = `${API_BASE}${galleryPath(slug)}/download`;
  if (!accessToken) return url;
  const response = await fetch(`${API_BASE}${galleryPath(slug)}/download-ticket`, {
    method: 'POST',
    headers: accessHeaders(accessToken),
  });
  const data: ApiResponse<{ ticket: string | null }> | null = await response.json().catch(() => null);
  if (!response.ok || !data?.success || !data.data) {
    const serverMessage = data?.error || null;
    throw new ApiError(serverMessage || 'The download could not be started', response.status, serverMessage);
  }
  // Null for a gallery made public since it was unlocked: no ticket needed.
  const { ticket } = data.data;
  return ticket ? `${url}?ticket=${encodeURIComponent(ticket)}` : url;
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
 * Count a view of a gallery page, once it is shown. Not counted by the
 * metadata request, which browsers may answer from cache. A private gallery
 * counts only with its access token.
 */
export function trackGalleryView(slug: string, accessToken?: string): void {
  const headers = accessHeaders(accessToken);
  const init: RequestInit = headers ? { method: 'POST', headers } : { method: 'POST' };
  fetch(`${API_BASE}${galleryPath(slug)}/view`, init).catch(() => {
    // Tracking never affects the page.
  });
}

/**
 * A signed URL that downloads the photo's original under its uploaded
 * filename. Fetched when the download button is pressed, not with the photo
 * lists, so lists never sign originals; the request also counts the download.
 * A photo in a private gallery needs that gallery's access token.
 */
export async function getPhotoDownloadUrl(photoId: string, accessToken?: string): Promise<string> {
  const endpoint = `/photos/${encodeURIComponent(photoId)}/download`;
  const data = await fetchApi<{ downloadUrl: string }>(endpoint, {}, accessToken);
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

export async function getHomepagePhotos(): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage');
}

export async function setHeroPhoto(photoId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/hero', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: photoId }),
  });
}

export async function addToHomepage(photoId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/featured', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: photoId }),
  });
}

export async function removeFromHomepage(photoId: string): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/featured', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: photoId }),
  });
}

export async function reorderHomepagePhotos(photoIds: string[]): Promise<Photo[]> {
  return fetchApiAuth<Photo[]>('/admin/homepage/reorder', {
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
  settings: Partial<SiteSettings>
): Promise<SiteSettings> {
  return fetchApiAuth<SiteSettings>('/settings/admin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
