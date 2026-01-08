import type {
  Gallery,
  Photo,
  ApiResponse,
  AdminStats,
  CreateGalleryInput,
  UpdateGalleryInput,
  PrivateGalleryResponse,
  GalleryAccessResponse,
} from '../types';

// In dev, use same hostname as frontend so it works when accessing via IP
const API_BASE = import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:3001/api`;

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
  return fetchApi<Photo[]>('/featured');
}

export async function getGalleries(): Promise<Gallery[]> {
  return fetchApi<Gallery[]>('/galleries');
}

export async function getGallery(slug: string): Promise<Gallery | PrivateGalleryResponse> {
  return fetchApi<Gallery | PrivateGalleryResponse>(`/galleries/${slug}`);
}

export async function getGalleryPhotos(slug: string, accessToken?: string): Promise<Photo[]> {
  const url = accessToken
    ? `/galleries/${slug}/photos?access=${encodeURIComponent(accessToken)}`
    : `/galleries/${slug}/photos`;
  return fetchApi<Photo[]>(url);
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
