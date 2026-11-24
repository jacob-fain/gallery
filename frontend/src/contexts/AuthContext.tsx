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

const TOKEN_KEY = 'auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);

  // On mount, check if we have a valid token
  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const currentUser = await getCurrentUser(token);
        setUser(currentUser);
      } catch {
        // Token is invalid, clear it
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      } finally {
        setIsLoading(false);
      }
    }

    validateToken();
  }, [token]);

  // A 401 on any admin request means the session ended on the server: sign
  // out locally, which sends the admin back to the login page.
  useEffect(() => {
    onSessionExpired(() => {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    });
    return () => onSessionExpired(null);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await apiLogin(email, password);
    localStorage.setItem(TOKEN_KEY, response.token);
    setToken(response.token);
    setUser(response.user);
  };

  const logout = () => {
    // Revokes this and every other session on the server; signing out locally
    // does not wait for it.
    if (token) apiLogout(token).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    clearAdminMode();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
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
