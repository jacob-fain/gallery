import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db';
import type { User, JwtPayload } from '../types';

const BCRYPT_ROUNDS = 10;
const JWT_EXPIRY = '7d';

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

/**
 * Generate a JWT token for a user
 */
export const generateToken = (userId: string, email: string): string => {
  const payload: JwtPayload = { userId, email };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRY });
};

/**
 * Verify and decode a JWT token
 * Returns null if invalid or expired
 */
export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    return decoded as JwtPayload;
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
