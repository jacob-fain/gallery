import type { Gallery } from '../types';

/** A gallery as visitors receive it: never the password hash or whether one exists. */
export const publicGallery = <T extends Gallery>(gallery: T): Omit<T, 'password_hash'> => {
  const { password_hash: _passwordHash, ...safe } = gallery;
  return safe;
};

/**
 * A gallery as the admin receives it: no hash, but whether one is set, so
 * the edit form knows a blank password field means "keep the current one".
 */
export const adminGallery = <T extends Gallery>(gallery: T) => ({
  ...publicGallery(gallery),
  has_password: Boolean(gallery.password_hash),
});
