const ADMIN_SUBDOMAIN = import.meta.env.VITE_ADMIN_SUBDOMAIN || 'manage';
const ADMIN_MODE_KEY = 'gallery_admin_mode';

/**
 * Check if the current hostname is the admin subdomain
 * Works for both production (manage.jacobfain.gallery) and local dev (manage.localhost)
 *
 * For development over SSH/remote access, you can also use ?admin=true query param
 * Once admin mode is entered, it's persisted in sessionStorage for the session
 */
export function isAdminSubdomain(): boolean {
  const hostname = window.location.hostname;

  // Check if hostname starts with the admin subdomain (production)
  if (hostname.startsWith(`${ADMIN_SUBDOMAIN}.`)) {
    return true;
  }

  // Dev mode: check for ?admin=true query param or persisted session
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);

    // If ?admin=true is present, persist it for the session
    if (params.get('admin') === 'true') {
      sessionStorage.setItem(ADMIN_MODE_KEY, 'true');
      return true;
    }

    // Check if admin mode was previously set in this session
    if (sessionStorage.getItem(ADMIN_MODE_KEY) === 'true') {
      return true;
    }
  }

  return false;
}

/**
 * Clear admin mode from session (for logout)
 */
export function clearAdminMode(): void {
  sessionStorage.removeItem(ADMIN_MODE_KEY);
}

/**
 * Get the base domain (without subdomain)
 * Used for redirects between public and admin sites
 */
export function getBaseDomain(): string {
  const hostname = window.location.hostname;

  if (isAdminSubdomain()) {
    // Remove the admin subdomain prefix
    return hostname.replace(`${ADMIN_SUBDOMAIN}.`, '');
  }

  return hostname;
}

/**
 * Get the admin domain URL
 */
export function getAdminUrl(): string {
  const { protocol, port } = window.location;
  const baseDomain = getBaseDomain();
  const portSuffix = port ? `:${port}` : '';

  return `${protocol}//${ADMIN_SUBDOMAIN}.${baseDomain}${portSuffix}`;
}
