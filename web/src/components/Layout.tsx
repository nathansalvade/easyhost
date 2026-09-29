import { NavLink, Outlet } from 'react-router-dom';

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
        <Outlet />
      </main>
    </div>
  );
}
