const ADMIN_SUBDOMAIN = import.meta.env.VITE_ADMIN_SUBDOMAIN || 'manage';

/**
 * Check if the current hostname is the admin subdomain
 * Works for both production (manage.jacobfain.gallery) and local dev (manage.localhost)
 *
 * For development over SSH/remote access, you can also use ?admin=true query param
 */
export function isAdminSubdomain(): boolean {
  // Dev mode: check for ?admin=true query param (useful when accessing via IP)
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === 'true') {
      return true;
    }
  }

  const hostname = window.location.hostname;

  // Check if hostname starts with the admin subdomain
  // Handles: manage.jacobfain.gallery, manage.localhost, manage.127.0.0.1
  return hostname.startsWith(`${ADMIN_SUBDOMAIN}.`);
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
