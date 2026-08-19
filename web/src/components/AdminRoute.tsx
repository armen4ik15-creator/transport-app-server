import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function AdminRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="muted">Загрузка…</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/orders" replace />;
  }

  return <Outlet />;
}
