import { useState, useEffect, type ReactNode } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  getCurrentUser,
  onSessionExpired,
  type User,
} from '../api/client';
import { AuthContext } from './auth';
import { clearAdminMode } from '../utils/subdomain';

// Where the admin token was kept before the session moved to an httpOnly
// cookie. Removed on load so a token left by an older build does not linger.
const LEGACY_TOKEN_KEY = 'auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // The session cookie is httpOnly, so the only way to know whether one is
  // live is to ask the API.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      // Storage blocked: there is nothing to remove.
    }

    let cancelled = false;
    getCurrentUser()
      .then((currentUser) => {
        if (!cancelled) setUser(currentUser);
      })
      .catch(() => {
        // No session, or it expired: the login page shows.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 on any admin request means the session ended on the server: sign
  // out locally, which sends the admin back to the login page.
  useEffect(() => {
    onSessionExpired(() => setUser(null));
    return () => onSessionExpired(null);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await apiLogin(email, password);
    setUser(response.user);
  };

  const logout = () => {
    // Revokes this and every other session on the server and clears the
    // cookie; signing out locally does not wait for it.
    apiLogout().catch(() => {});
    setUser(null);
    clearAdminMode();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
