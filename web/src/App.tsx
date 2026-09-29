import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { SetupPage } from './pages/SetupPage';
import { RecoveryCodePage } from './pages/RecoveryCodePage';
import { LoginPage, safeNext } from './pages/LoginPage';
import { RecoverPage } from './pages/RecoverPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { Layout } from './components/Layout';
import { AppDetailPage } from './pages/AppDetailPage';

export function App() {
  const { status, newRecoveryCode, setNewRecoveryCode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!status) return <p className="center-page">Loading…</p>;

  if (status.setupRequired) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!status.authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="*" element={<Navigate to={`/login?next=${next}`} replace />} />
      </Routes>
    );
  }

  if (newRecoveryCode) {
    const done = () => {
      setNewRecoveryCode(null);
      navigate('/', { replace: true });
    };
    return <RecoveryCodePage code={newRecoveryCode} onContinue={done} />;
  }

  return (
    <Routes>
      <Route path="/recovery-code" element={<RecoveryCodePage />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      {/* Logging in lands here once the status says authenticated: go where the user was headed. */}
      <Route
        path="/login"
        element={<Navigate to={safeNext(new URLSearchParams(location.search).get('next'))} replace />}
      />
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/apps/:id" element={<AppDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
