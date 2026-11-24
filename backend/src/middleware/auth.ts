import { Request, Response, NextFunction } from 'express';
import { verifyToken, getUserById } from '../services/authService';
import { clearSessionCookie, hasAdminOrigin, readSessionCookie, refuseOrigin } from './session';

const deny = (res: Response, error: string): void => {
  res.status(401).json({ success: false, error });
};

/**
 * Require an admin session: a valid admin token in the httpOnly session
 * cookie whose user still exists and has not revoked it (its token_version
 * still matches), and for state-changing requests an Origin from the admin
 * site. Attaches the user to req.user.
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!hasAdminOrigin(req)) {
    refuseOrigin(res);
    return;
  }

  const token = readSessionCookie(req);
  if (!token) {
    deny(res, 'Authentication required');
    return;
  }

  // A cookie that no longer authenticates is removed, so the browser stops
  // sending it.
  const refuse = () => {
    clearSessionCookie(res);
    deny(res, 'Invalid or expired token');
  };

  const payload = verifyToken(token);
  if (!payload) {
    refuse();
    return;
  }

  // Checked on every request so a deleted account, a logout or a password
  // change takes effect immediately, not when the token expires.
  try {
    const user = await getUserById(payload.userId);
    if (!user || user.token_version !== payload.tokenVersion) {
      refuse();
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  req.user = payload;
  next();
};
