import { useEffect, useMemo, useState, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { isAdminSubdomain } from './utils/subdomain';
import { lazyWithReload } from './utils/lazyWithReload';
import { getSettings } from './api/client';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Navbar from './components/Navbar/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import PageTitle from './components/PageTitle';
import ScrollRestorer from './components/ScrollRestorer';
import { DEFAULT_SITE_TITLE, SiteTitleContext } from './contexts/siteTitle';
import './styles/globals.css';

// Public pages - keep eager (small, always needed)
import Home from './pages/Home';
import Galleries from './pages/Galleries';
import NotFound from './pages/NotFound';

// The photo grid pages carry the lightbox and the masonry layout, which the
// homepage and the galleries list do not need.
const Gallery = lazyWithReload(() => import('./pages/Gallery'));
const AllPhotos = lazyWithReload(() => import('./pages/AllPhotos'));

// Admin pages - lazy load (reduces initial bundle for public visitors)
const Login = lazyWithReload(() => import('./pages/admin/Login'));
const Dashboard = lazyWithReload(() => import('./pages/admin/Dashboard'));
const AdminGalleries = lazyWithReload(() => import('./pages/admin/Galleries'));
const Photos = lazyWithReload(() => import('./pages/admin/Photos'));
const Homepage = lazyWithReload(() => import('./pages/admin/Homepage'));
const Unassigned = lazyWithReload(() => import('./pages/admin/Unassigned'));
const Settings = lazyWithReload(() => import('./pages/admin/Settings'));
const AdminLayout = lazyWithReload(() => import('./components/Admin/AdminLayout/AdminLayout'));

export function PublicApp() {
  return (
    <>
      <ScrollRestorer />
      <Navbar />
      <main className="main-content">
        <Suspense fallback={<div className="loading">Loading...</div>}>
          <Routes>
            <Route path="/" element={<><PageTitle /><Home /></>} />
            <Route path="/galleries" element={<><PageTitle page="Galleries" /><Galleries /></>} />
            <Route path="/photos" element={<><PageTitle page="Photos" /><AllPhotos /></>} />
            <Route path="/g/:slug" element={<Gallery />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </>
  );
}

function AdminApp() {
  return (
    <AuthProvider>
      {/* robots.txt also refuses crawlers on this host; this covers a page reached by link. */}
      <meta name="robots" content="noindex" />
      <Suspense fallback={<div className="loading">Loading...</div>}>
        <Routes>
          <Route path="/login" element={<><PageTitle page="Sign in" /><Login /></>} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <Routes>
                    <Route path="" element={<><PageTitle page="Dashboard" /><Dashboard /></>} />
                    <Route path="galleries" element={<><PageTitle page="Galleries" /><AdminGalleries /></>} />
                    <Route path="galleries/:id/photos" element={<><PageTitle page="Photos" /><Photos /></>} />
                    <Route path="homepage" element={<><PageTitle page="Homepage" /><Homepage /></>} />
                    <Route path="unassigned" element={<><PageTitle page="Unassigned" /><Unassigned /></>} />
                    <Route path="settings" element={<><PageTitle page="Settings" /><Settings /></>} />
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
  const [siteTitle, setSiteTitle] = useState(DEFAULT_SITE_TITLE);
  const siteTitleValue = useMemo(() => ({ siteTitle, setSiteTitle }), [siteTitle]);

  // Fetch and apply site settings on load
  useEffect(() => {
    async function applySettings() {
      try {
        const settings = await getSettings();

        if (settings.site_title) {
          setSiteTitle(settings.site_title);
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
      <SiteTitleContext.Provider value={siteTitleValue}>
        <ErrorBoundary>
          <BrowserRouter>
            {isAdmin ? <AdminApp /> : <PublicApp />}
          </BrowserRouter>
        </ErrorBoundary>
      </SiteTitleContext.Provider>
    </ThemeProvider>
  );
}
