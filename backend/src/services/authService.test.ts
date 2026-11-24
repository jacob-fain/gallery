import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  generateToken,
  verifyPasswordForUnknownUser,
  verifyToken,
  generateGalleryAccessToken,
  verifyGalleryAccessToken,
} from './authService';

const secret = process.env.JWT_SECRET as string;

describe('admin tokens', () => {
  it('verify and carry only the identity fields', () => {
    const payload = verifyToken(generateToken('user-1', 'admin@example.com', 0));
    expect(payload).toEqual({ userId: 'user-1', email: 'admin@example.com', tokenVersion: 0 });
  });

  it('reject a gallery access token', () => {
    // A visitor who knows one private gallery's password must not become admin.
    const galleryToken = generateGalleryAccessToken('gallery-1', 'wedding');
    expect(verifyToken(galleryToken)).toBeNull();
  });

  it('reject a token signed before audiences existed', () => {
    const legacy = jwt.sign({ userId: 'user-1', email: 'a@example.com' }, secret, {
      expiresIn: '7d',
    });
    expect(verifyToken(legacy)).toBeNull();
  });

  it('reject an unsigned token', () => {
    const unsigned = jwt.sign(
      { userId: 'user-1', email: 'a@example.com' },
      '',
      { algorithm: 'none', audience: 'admin', issuer: 'gallery-api' }
    );
    expect(verifyToken(unsigned)).toBeNull();
  });

  it('reject a token signed with another secret', () => {
    const forged = jwt.sign(
      { userId: 'user-1', email: 'a@example.com' },
      'a-different-secret-that-is-also-long-enough',
      { audience: 'admin', issuer: 'gallery-api' }
    );
    expect(verifyToken(forged)).toBeNull();
  });

  it('reject a correctly signed token missing the user id', () => {
    const noUser = jwt.sign({ email: 'a@example.com' }, secret, {
      audience: 'admin',
      issuer: 'gallery-api',
    });
    expect(verifyToken(noUser)).toBeNull();
  });

  it('reject an expired token', () => {
    const expired = jwt.sign({ userId: 'user-1', email: 'a@example.com' }, secret, {
      audience: 'admin',
      issuer: 'gallery-api',
      expiresIn: -10,
    });
    expect(verifyToken(expired)).toBeNull();
  });
});

describe('gallery access tokens', () => {
  it('verify and carry only the gallery fields', () => {
    const payload = verifyGalleryAccessToken(generateGalleryAccessToken('gallery-1', 'wedding'));
    expect(payload).toEqual({ galleryId: 'gallery-1', slug: 'wedding' });
  });

  it('reject an admin token', () => {
    expect(verifyGalleryAccessToken(generateToken('user-1', 'admin@example.com', 0))).toBeNull();
  });

  it('reject a token signed before audiences existed', () => {
    const legacy = jwt.sign({ galleryId: 'gallery-1', slug: 'wedding' }, secret, {
      expiresIn: '24h',
    });
    expect(verifyGalleryAccessToken(legacy)).toBeNull();
  });
});

describe('verifyPasswordForUnknownUser', () => {
  it('always fails, after doing a real bcrypt comparison', async () => {
    const started = Date.now();
    expect(await verifyPasswordForUnknownUser('anything')).toBe(false);
    // Ten bcrypt rounds take milliseconds, not microseconds.
    expect(Date.now() - started).toBeGreaterThan(5);
  });
});
