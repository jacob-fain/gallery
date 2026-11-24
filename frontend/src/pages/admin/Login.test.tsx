// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  onSessionExpired: vi.fn(),
}));

const client = await import('../../api/client');
const { AuthProvider } = await import('../../contexts/AuthContext');
const { default: ProtectedRoute } = await import('../../components/ProtectedRoute');
const { default: Login } = await import('./Login');

// The same shape as the admin app: the login page, and a dashboard that only
// a signed-in admin reaches.
function renderAdmin(path = '/login') {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <h1>Dashboard</h1>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
  return user;
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('admin login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(client.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));
  });

  it('sends the typed credentials and opens the dashboard on success', async () => {
    vi.mocked(client.login).mockResolvedValue({ user: { id: 'u1', email: 'admin@example.com' } });
    const user = renderAdmin();

    await signIn(user, 'admin@example.com', 'correct horse');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(client.login).toHaveBeenCalledWith('admin@example.com', 'correct horse');
    expect(screen.queryByRole('heading', { name: 'Admin Login' })).toBeNull();
  });

  it('keeps no token in page storage, since the session is an httpOnly cookie', async () => {
    // A token left by a build that kept it in localStorage.
    localStorage.setItem('auth_token', 'stale');
    vi.mocked(client.login).mockResolvedValue({ user: { id: 'u1', email: 'admin@example.com' } });
    const user = renderAdmin();

    await signIn(user, 'admin@example.com', 'correct horse');
    await screen.findByRole('heading', { name: 'Dashboard' });

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it("shows the API's message for refused credentials and stays on the form", async () => {
    vi.mocked(client.login).mockRejectedValue(new Error('Invalid email or password'));
    const user = renderAdmin();

    await signIn(user, 'admin@example.com', 'wrong');

    expect(await screen.findByText('Invalid email or password')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Sign In' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    // The typed email stays, so a retry needs only the password.
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('admin@example.com');
  });

  it('falls back to a generic message when the failure is not an Error', async () => {
    vi.mocked(client.login).mockRejectedValue('network down');
    const user = renderAdmin();

    await signIn(user, 'admin@example.com', 'pw');

    expect(await screen.findByText('Login failed')).toBeTruthy();
  });

  it('clears the previous error and disables the form while signing in', async () => {
    let finish: (value: { user: { id: string; email: string } }) => void = () => {};
    vi.mocked(client.login)
      .mockRejectedValueOnce(new Error('Invalid email or password'))
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const user = renderAdmin();

    await signIn(user, 'admin@example.com', 'wrong');
    await screen.findByText('Invalid email or password');

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'right');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    const pending = screen.getByRole('button', { name: 'Signing in...' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect((screen.getByLabelText('Email') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('Invalid email or password')).toBeNull();

    finish({ user: { id: 'u1', email: 'admin@example.com' } });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  });

  it('sends a signed-out admin from the dashboard to the login page', async () => {
    renderAdmin('/');

    expect(await screen.findByRole('heading', { name: 'Admin Login' })).toBeTruthy();
  });
});
