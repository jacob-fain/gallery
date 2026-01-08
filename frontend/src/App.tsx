import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { isAdminSubdomain } from './utils/subdomain';
import { getSettings } from './api/client';
import { AuthProvider } from './contexts/AuthContext';
import Navbar from './components/Navbar/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import './styles/globals.css';

// Public pages - keep eager (small, always needed)
import Home from './pages/Home';
import Galleries from './pages/Galleries';
import Gallery from './pages/Gallery';

// Admin pages - lazy load (reduces initial bundle for public visitors)
const Login = lazy(() => import('./pages/admin/Login'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminGalleries = lazy(() => import('./pages/admin/Galleries'));
const Photos = lazy(() => import('./pages/admin/Photos'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const AdminLayout = lazy(() => import('./components/Admin/AdminLayout/AdminLayout'));

function PublicApp() {
  return (
    <>
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/galleries" element={<Galleries />} />
          <Route path="/g/:slug" element={<Gallery />} />
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
                    <Route path="settings" element={<Settings />} />
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
    <BrowserRouter>
      {isAdmin ? <AdminApp /> : <PublicApp />}
    </BrowserRouter>
  );
}
