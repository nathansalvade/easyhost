import { NavLink, Outlet } from 'react-router-dom';
import { Banners } from './Banners';

export function Layout() {
  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Main">
        <span className="brand">EasyHost</span>
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/add">Add</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <main className="content">
        <Banners />
        <Outlet />
      </main>
    </div>
  );
}
