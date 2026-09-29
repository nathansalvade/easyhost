import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { useAuth } from '../auth';

export const MIN_PASSWORD_LENGTH = 10;

export function strengthHint(password: string): string {
  if (password.length === 0) return '';
  if (password.length < MIN_PASSWORD_LENGTH) return `Too short: use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length < 14) return 'Good. A few more characters make it stronger.';
  return 'Strong.';
}

export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

export function SetupPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh, setNewRecoveryCode } = useAuth();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const { recoveryCode } = await api<{ recoveryCode: string }>('POST', '/api/auth/setup', { password });
      setNewRecoveryCode(recoveryCode);
      await refresh();
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <main className="center-page">
      <h1>Welcome to EasyHost</h1>
      <p className="hint">Create the password you'll use to manage your apps.</p>
      <form className="card" onSubmit={submit}>
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="hint">{strengthHint(password)}</p>
        <label htmlFor="confirm">Confirm password</label>
        <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <p><button className="primary" type="submit" disabled={busy}>Create password</button></p>
      </form>
    </main>
  );
}
