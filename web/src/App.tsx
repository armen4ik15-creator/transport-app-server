import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AdminRoute } from './components/AdminRoute';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { OrderCreatePage } from './pages/OrderCreatePage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrderEditPage } from './pages/OrderEditPage';
import { OrderTemplatesPage } from './pages/OrderTemplatesPage';
import { OrdersPage } from './pages/OrdersPage';
import { TripsPage } from './pages/TripsPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/orders" replace />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route element={<AdminRoute />}>
                <Route path="/orders/new" element={<OrderCreatePage />} />
                <Route path="/orders/:id/edit" element={<OrderEditPage />} />
                <Route path="/order-templates" element={<OrderTemplatesPage />} />
              </Route>
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/trips" element={<TripsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
