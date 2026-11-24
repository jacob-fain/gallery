import { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { isAdminSubdomain } from './utils/subdomain';
import { lazyWithReload } from './utils/lazyWithReload';
import { getSettings } from './api/client';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Navbar from './components/Navbar/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/globals.css';

// Public pages - keep eager (small, always needed)
import Home from './pages/Home';
import Galleries from './pages/Galleries';
import Gallery from './pages/Gallery';
import AllPhotos from './pages/AllPhotos';
import NotFound from './pages/NotFound';

// Admin pages - lazy load (reduces initial bundle for public visitors)
const Login = lazyWithReload(() => import('./pages/admin/Login'));
const Dashboard = lazyWithReload(() => import('./pages/admin/Dashboard'));
const AdminGalleries = lazyWithReload(() => import('./pages/admin/Galleries'));
const Photos = lazyWithReload(() => import('./pages/admin/Photos'));
const Homepage = lazyWithReload(() => import('./pages/admin/Homepage'));
const Unassigned = lazyWithReload(() => import('./pages/admin/Unassigned'));
const Settings = lazyWithReload(() => import('./pages/admin/Settings'));
const AdminLayout = lazyWithReload(() => import('./components/Admin/AdminLayout/AdminLayout'));

function PublicApp() {
  return (
    <>
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/galleries" element={<Galleries />} />
          <Route path="/photos" element={<AllPhotos />} />
          <Route path="/g/:slug" element={<Gallery />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}

function AdminApp() {
  return (
    <AuthProvider>
      <Suspense fallback={<div className="loading">Loading...</div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <Routes>
                    <Route path="" element={<Dashboard />} />
                    <Route path="galleries" element={<AdminGalleries />} />
                    <Route path="galleries/:id/photos" element={<Photos />} />
                    <Route path="homepage" element={<Homepage />} />
                    <Route path="unassigned" element={<Unassigned />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="*" element={<NotFound linkLabel="Back to dashboard" />} />
                  </Routes>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

export default function App() {
  const isAdmin = isAdminSubdomain();

  // Fetch and apply site settings on load
  useEffect(() => {
    async function applySettings() {
      try {
        const settings = await getSettings();

        // Update document title
        if (settings.site_title) {
          document.title = settings.site_title;
        }

        // Update meta description
        if (settings.meta_description) {
          let metaDesc = document.querySelector('meta[name="description"]');
          if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.setAttribute('name', 'description');
            document.head.appendChild(metaDesc);
          }
          metaDesc.setAttribute('content', settings.meta_description);
        }
      } catch {
        // Silently fail - settings are not critical
      }
    }

    applySettings();
  }, []);

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          {isAdmin ? <AdminApp /> : <PublicApp />}
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
