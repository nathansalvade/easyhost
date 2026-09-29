import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { useAuth } from '../auth';
import { useSystem } from '../lib/guide';
import { passwordProblem } from './SetupPage';

export function SettingsPage() {
  const system = useSystem();
  const navigate = useNavigate();
  const { markLoggedOut } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [codePassword, setCodePassword] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(next, confirm);
    if (problem) return setPwMessage({ ok: false, text: problem });
    try {
      await api('POST', '/api/auth/password', { currentPassword: current, newPassword: next });
      setPwMessage({ ok: true, text: 'Password changed. Other devices have been logged out.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setPwMessage({ ok: false, text: messageFor(err) });
    }
  };

  const newRecoveryCode = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { recoveryCode } = await api<{ recoveryCode: string }>('POST', '/api/auth/recovery-code', { password: codePassword });
      navigate('/recovery-code', { state: { code: recoveryCode, next: '/settings' } });
    } catch (err) {
      setCodeError(messageFor(err));
    }
  };

  const logout = async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    markLoggedOut();
  };

  return (
    <>
      <h1>Settings</h1>

      <form className="card" onSubmit={changePassword}>
        <h2>Change password</h2>
        <label htmlFor="s-current">Current password</label>
        <input id="s-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label htmlFor="s-new">New password</label>
        <input id="s-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label htmlFor="s-confirm">Confirm new password</label>
        <input id="s-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {pwMessage && <p className={pwMessage.ok ? 'hint' : 'error'} role="status">{pwMessage.text}</p>}
        <p><button className="primary" type="submit">Change password</button></p>
      </form>

      <form className="card" onSubmit={newRecoveryCode} style={{ marginTop: '1rem' }}>
        <h2>Recovery code</h2>
        <p className="hint">Lost your recovery code? Create a new one. The old one stops working.</p>
        <label htmlFor="s-code-pw">Confirm with your password</label>
        <input id="s-code-pw" type="password" autoComplete="current-password" value={codePassword} onChange={(e) => setCodePassword(e.target.value)} />
        {codeError && <p className="error" role="alert">{codeError}</p>}
        <p><button type="submit">New recovery code</button></p>
      </form>

      <section style={{ marginTop: '1rem' }}>
        <button type="button" onClick={() => void logout()}>Log out</button>
        {system?.version && <p className="hint">EasyHost version {system.version}</p>}
      </section>
    </>
  );
}
