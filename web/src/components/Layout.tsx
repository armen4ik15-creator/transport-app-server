import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Layout() {
  const { user, driver, signOut } = useAuth();
  const isAdmin = user?.role === 'admin';

  const displayName =
    user?.full_name?.trim() ||
    driver?.full_name?.trim() ||
    user?.email ||
    'Пользователь';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="brand">РеестрПро Web</h1>
          <p className="muted small">
            {displayName}
            {driver?.car_number ? ` · ${driver.car_number}` : ''}
            {isAdmin ? ' · админ' : ' · водитель'}
          </p>
        </div>
        <nav className="app-nav">
          <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
            Заказы
          </NavLink>
          <NavLink to="/trips" className={({ isActive }) => (isActive ? 'active' : '')}>
            Рейсы
          </NavLink>
          {isAdmin ? (
            <>
              <NavLink to="/drivers" className={({ isActive }) => (isActive ? 'active' : '')}>
                Водители
              </NavLink>
              <NavLink to="/expenses" className={({ isActive }) => (isActive ? 'active' : '')}>
                Расходы
              </NavLink>
              <NavLink to="/cash" className={({ isActive }) => (isActive ? 'active' : '')}>
                Касса
              </NavLink>
              <NavLink to="/finances" className={({ isActive }) => (isActive ? 'active' : '')}>
                Сводка
              </NavLink>
              <NavLink to="/salary" className={({ isActive }) => (isActive ? 'active' : '')}>
                Зарплата
              </NavLink>
              <NavLink to="/order-templates" className={({ isActive }) => (isActive ? 'active' : '')}>
                Шаблоны
              </NavLink>
            </>
          ) : null}
          <button type="button" className="btn-secondary" onClick={signOut}>
            Выйти
          </button>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
