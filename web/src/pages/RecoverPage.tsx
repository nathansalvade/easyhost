import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { useAuth } from '../auth';
import { passwordProblem } from './SetupPage';

export function RecoverPage() {
  const [code, setCode] = useState('');
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
      const { recoveryCode } = await api<{ recoveryCode: string }>('POST', '/api/auth/recover', {
        recoveryCode: code,
        newPassword: password,
      });
      setNewRecoveryCode(recoveryCode);
      await refresh();
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <main className="center-page">
      <h1>Reset your password</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="code">Recovery code</label>
        <input id="code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <p className="hint">The code you saved when you set up EasyHost. Dashes and capitals don't matter.</p>
        <label htmlFor="new">New password</label>
        <input id="new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor="confirm">Confirm new password</label>
        <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <p><button className="primary" type="submit" disabled={busy}>Reset password</button></p>
        <Link to="/login">Back to log in</Link>
      </form>
    </main>
  );
}
