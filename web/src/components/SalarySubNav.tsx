import { NavLink } from 'react-router-dom';

export function SalarySubNav() {
  return (
    <nav className="sub-nav card">
      <NavLink to="/salary" end className={({ isActive }) => (isActive ? 'active' : '')}>
        Начисления
      </NavLink>
      <NavLink to="/salary/payments" className={({ isActive }) => (isActive ? 'active' : '')}>
        Выплаты
      </NavLink>
      <NavLink to="/salary/debts" className={({ isActive }) => (isActive ? 'active' : '')}>
        Долги
      </NavLink>
    </nav>
  );
}
