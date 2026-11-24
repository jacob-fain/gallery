import { Request, Response } from 'express';
import {
  getUserByEmail,
  verifyPassword,
  verifyPasswordForUnknownUser,
  generateToken,
  revokeTokens,
} from '../services/authService';
import { clearSessionCookie, setSessionCookie } from '../middleware/session';
import { logger } from '../utils/logger';

/**
 * POST /api/auth/login
 * Authenticate the admin and set the session cookie. The token is never in
 * the response body, so page scripts cannot read it.
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
      return;
    }

    // Find user by email
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }

    // An unknown email costs the same bcrypt work as a wrong password, so
    // timing does not reveal whether the account exists.
    const user = await getUserByEmail(email);
    const isValid = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPasswordForUnknownUser(password);
    if (!user || !isValid) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
      });
      return;
    }

    setSessionCookie(res, generateToken(user.id, user.email, user.token_version));
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
        },
      },
    });
  } catch (err) {
    logger.error('Login error', { err });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * GET /api/auth/me
 * Get current authenticated user
 * Requires authMiddleware
 */
export const me = async (req: Request, res: Response): Promise<void> => {
  try {
    // req.user is set by authMiddleware
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        id: req.user.userId,
        email: req.user.email,
      },
    });
  } catch (err) {
    logger.error('Get current user error', { err });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * POST /api/auth/logout
 * Revokes every admin token the user holds, this one included, so a copied
 * or forgotten session stops working too. Requires authMiddleware.
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    await revokeTokens(req.user!.userId);
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (err) {
    logger.error('Logout error', { err });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
