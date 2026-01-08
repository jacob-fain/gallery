import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { isAdminSubdomain } from './utils/subdomain';
import { AuthProvider } from './contexts/AuthContext';
import Navbar from './components/Navbar/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Galleries from './pages/Galleries';
import Gallery from './pages/Gallery';
import Login from './pages/admin/Login';
import Dashboard from './pages/admin/Dashboard';
import AdminGalleries from './pages/admin/Galleries';
import Photos from './pages/admin/Photos';
import AdminLayout from './components/Admin/AdminLayout/AdminLayout';
import './styles/globals.css';

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
                </Routes>
              </AdminLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default function App() {
  const isAdmin = isAdminSubdomain();

  return (
    <BrowserRouter>
      {isAdmin ? <AdminApp /> : <PublicApp />}
    </BrowserRouter>
  );
}
