import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { formatWait, messageFor } from '../api/messages';
import { useAuth } from '../auth';

/**
 * Only paths inside EasyHost. "//host" and "/\\host" are read by browsers
 * as links to another site, so they fall back to Home (no open redirect).
 */
export function safeNext(next: string | null): string {
  return next && /^\/(?![/\\])/.test(next) ? next : '/';
}

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/auth/login', { password });
      // App then leaves /login for safeNext(?next=) by itself.
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_ATTEMPTS') {
        setWaitSeconds(Number(err.details.retryAfterSeconds ?? 30));
      }
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const waiting = waitSeconds > 0;
  return (
    <main className="center-page">
      <h1>Log in</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && !waiting && <p className="error" role="alert">{error}</p>}
        <p>
          <button className="primary" type="submit" disabled={busy || waiting}>
            {waiting ? `Try again in ${formatWait(waitSeconds)}` : 'Log in'}
          </button>
        </p>
        <Link to="/recover">Forgot password?</Link>
      </form>
    </main>
  );
}
