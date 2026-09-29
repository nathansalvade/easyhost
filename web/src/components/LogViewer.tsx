import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import { messageFor } from '../api/messages';

export function LogViewer({ appId }: { appId: string }) {
  const [logs, setLogs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    try {
      setLogs(await api<string>('GET', `/api/apps/${appId}/logs?tail=200`));
      setError(null);
    } catch (err) {
      // No container yet (still installing, or the install failed before creating one).
      if (err instanceof ApiError && err.code === 'NOT_INSTALLED') {
        setLogs('');
        setError(null);
      } else {
        setError(messageFor(err));
      }
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [auto, load]);

  return (
    <section>
      <h2>Logs</h2>
      <div className="actions">
        <button type="button" onClick={() => void load()}>Refresh</button>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', margin: 0, fontWeight: 400 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Refresh automatically
        </label>
      </div>
      {error ? <p className="error">{error}</p> : <pre>{logs || 'No log lines yet.'}</pre>}
    </section>
  );
}
