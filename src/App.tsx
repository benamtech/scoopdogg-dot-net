import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Nav from './components/Nav';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import BookPage from './pages/BookPage';
import AboutPage from './pages/AboutPage';
import CityPage from './pages/CityPage';
import CityServicePage from './pages/CityServicePage';
import ContactPage from './pages/ContactPage';
import ServicesPage from './pages/ServicesPage';
import ServicePage from './pages/ServicePage';
import AreasPage from './pages/AreasPage';
import ResourcesPage from './pages/ResourcesPage';
import ArticlePage from './pages/ArticlePage';
import ReviewsPage from './pages/ReviewsPage';
import GalleryPage from './pages/GalleryPage';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminLeadsPage from './pages/admin/AdminLeadsPage';
import AdminLeadDetailPage from './pages/admin/AdminLeadDetailPage';
import AdminMessagesPage from './pages/admin/AdminMessagesPage';
import AdminMessageDetailPage from './pages/admin/AdminMessageDetailPage';

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function AppRoutes() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/leads"
          element={
            <ProtectedRoute>
              <AdminLeadsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/leads/:id"
          element={
            <ProtectedRoute>
              <AdminLeadDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/messages"
          element={
            <ProtectedRoute>
              <AdminMessagesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/messages/:id"
          element={
            <ProtectedRoute>
              <AdminMessageDetailPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    );
  }

  return (
    <PublicLayout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/book" element={<BookPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/:service" element={<ServicePage />} />
        <Route path="/areas" element={<AreasPage />} />
        <Route path="/areas/westlake" element={<Navigate to="/areas/westlake-village" replace />} />
        <Route path="/areas/:city/:service" element={<CityServicePage />} />
        <Route path="/areas/:city" element={<CityPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/resources/:slug" element={<ArticlePage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
      </Routes>
    </PublicLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AppRoutes />
    </BrowserRouter>
  );
}
