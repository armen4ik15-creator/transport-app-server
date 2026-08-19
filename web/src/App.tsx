import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AdminRoute } from './components/AdminRoute';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ExpenseCreatePage } from './pages/ExpenseCreatePage';
import { ExpenseEditPage } from './pages/ExpenseEditPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { CashPage } from './pages/CashPage';
import { FinancesSummaryPage } from './pages/FinancesSummaryPage';
import { DriverCreatePage } from './pages/DriverCreatePage';
import { DriverDetailPage } from './pages/DriverDetailPage';
import { DriverEditPage } from './pages/DriverEditPage';
import { DriversPage } from './pages/DriversPage';
import { LoginPage } from './pages/LoginPage';
import { OrderCreatePage } from './pages/OrderCreatePage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrderEditPage } from './pages/OrderEditPage';
import { OrderTemplatesPage } from './pages/OrderTemplatesPage';
import { OrdersPage } from './pages/OrdersPage';
import { SalaryAccrualsPage } from './pages/SalaryAccrualsPage';
import { SalaryDebtsPage } from './pages/SalaryDebtsPage';
import { SalaryPaymentsPage } from './pages/SalaryPaymentsPage';
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
                <Route path="/drivers" element={<DriversPage />} />
                <Route path="/drivers/new" element={<DriverCreatePage />} />
                <Route path="/drivers/:id/edit" element={<DriverEditPage />} />
                <Route path="/drivers/:id" element={<DriverDetailPage />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/expenses/new" element={<ExpenseCreatePage />} />
                <Route path="/expenses/:id/edit" element={<ExpenseEditPage />} />
                <Route path="/cash" element={<CashPage />} />
                <Route path="/finances" element={<FinancesSummaryPage />} />
                <Route path="/salary" element={<SalaryAccrualsPage />} />
                <Route path="/salary/payments" element={<SalaryPaymentsPage />} />
                <Route path="/salary/debts" element={<SalaryDebtsPage />} />
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
