import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db';
import type { User, JwtPayload, Gallery, GalleryAccessPayload } from '../types';

const BCRYPT_ROUNDS = 10;
// A day, down from seven: a leaked token is useful for less time.
const JWT_EXPIRY = '24h';
const GALLERY_ACCESS_EXPIRY = '24h';

// Admin sessions and gallery unlocks share one signing secret, so each token
// names its audience and every verifier requires its own. Without this a
// gallery unlock token passes the admin check.
const ISSUER = 'gallery-api';
const ADMIN_AUDIENCE = 'admin';
const GALLERY_AUDIENCE = 'gallery-access';
const ALGORITHM = 'HS256';

// Validate JWT_SECRET is configured
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return secret;
};

/**
 * Hash a password using bcrypt
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
};

/**
 * Verify a password against a bcrypt hash
 */
export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// A real hash of a random value, compared against when the email is unknown
// so a login takes as long whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync(Math.random().toString(36), BCRYPT_ROUNDS);

/** Spend the same work as a failed password check. Always false. */
export const verifyPasswordForUnknownUser = async (password: string): Promise<false> => {
  await bcrypt.compare(password, DUMMY_HASH);
  return false;
};

/**
 * Generate a JWT token for a user
 */
export const generateToken = (userId: string, email: string, tokenVersion: number): string => {
  const payload: JwtPayload = { userId, email, tokenVersion };
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRY,
    algorithm: ALGORITHM,
    issuer: ISSUER,
    audience: ADMIN_AUDIENCE,
  });
};

/**
 * Verify and decode a JWT token
 * Returns null if invalid or expired
 */
export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: ADMIN_AUDIENCE,
    });
    if (
      typeof decoded !== 'object' ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.email !== 'string' ||
      !Number.isInteger(decoded.tokenVersion)
    ) {
      return null;
    }
    return { userId: decoded.userId, email: decoded.email, tokenVersion: decoded.tokenVersion };
  } catch {
    return null;
  }
};

/**
 * Get a user by email from the database
 */
export const getUserByEmail = async (email: string): Promise<User | null> => {
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
};

/**
 * Get a user by ID from the database
 */
export const getUserById = async (id: string): Promise<User | null> => {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
};

/**
 * Revoke every admin token the user holds, by moving their token_version on.
 */
export const revokeTokens = async (userId: string): Promise<void> => {
  await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
};

/**
 * Generate a signed access token for a private gallery
 * This token proves the user has verified the gallery password
 */
export const generateGalleryAccessToken = (
  galleryId: string,
  slug: string,
  accessVersion: number
): string => {
  const payload: GalleryAccessPayload = { galleryId, slug, accessVersion };
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: GALLERY_ACCESS_EXPIRY,
    algorithm: ALGORITHM,
    issuer: ISSUER,
    audience: GALLERY_AUDIENCE,
  });
};

/**
 * Verify and decode a gallery access token
 * Returns the payload if valid, null if invalid or expired
 */
export const verifyGalleryAccessToken = (
  token: string
): GalleryAccessPayload | null => {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: GALLERY_AUDIENCE,
    });
    if (
      typeof decoded !== 'object' ||
      typeof decoded.galleryId !== 'string' ||
      typeof decoded.slug !== 'string' ||
      !Number.isInteger(decoded.accessVersion)
    ) {
      return null;
    }
    return { galleryId: decoded.galleryId, slug: decoded.slug, accessVersion: decoded.accessVersion };
  } catch {
    return null;
  }
};

/**
 * Whether an access token unlocks this gallery as it is now: signed for it,
 * and issued since its access_version last moved (a password or visibility
 * change revokes every token handed out before).
 */
export const galleryAccessTokenUnlocks = (
  token: unknown,
  gallery: Pick<Gallery, 'id' | 'access_version'>
): boolean => {
  if (typeof token !== 'string') return false;
  const payload = verifyGalleryAccessToken(token);
  return payload?.galleryId === gallery.id && payload.accessVersion === gallery.access_version;
};
