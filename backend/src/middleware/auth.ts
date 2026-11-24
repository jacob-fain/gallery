import { Request, Response, NextFunction } from 'express';
import { verifyToken, getUserById } from '../services/authService';

const deny = (res: Response, error: string): void => {
  res.status(401).json({ success: false, error });
};

/**
 * Require an admin session: a valid admin token in "Authorization: Bearer
 * <token>" whose user still exists and has not revoked it (its token_version
 * still matches). Attaches the user to req.user.
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    deny(res, 'Authentication required');
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    deny(res, 'Invalid authorization format. Use: Bearer <token>');
    return;
  }

  const payload = verifyToken(parts[1]);
  if (!payload) {
    deny(res, 'Invalid or expired token');
    return;
  }

  // Checked on every request so a deleted account, a logout or a password
  // change takes effect immediately, not when the token expires.
  try {
    const user = await getUserById(payload.userId);
    if (!user || user.token_version !== payload.tokenVersion) {
      deny(res, 'Invalid or expired token');
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  req.user = payload;
  next();
};
