import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import type { AppView, CatalogEntry } from '../api/types';
import { useSystem } from '../lib/guide';
import { nameProblem, suggestName } from '../lib/names';
import { AppIcon } from './AppIcon';
import { GuideView } from './GuideView';

export function InstallDialog({ entry, onClose }: { entry: CatalogEntry; onClose(): void }) {
  const [name, setName] = useState(entry.id);
  const [port, setPort] = useState<number | ''>('');
  const [portTouched, setPortTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const system = useSystem();
  const navigate = useNavigate();

  // Prefill a name no installed app uses yet (jellyfin, jellyfin-2, ...), like the server would.
  useEffect(() => {
    api<AppView[]>('GET', '/api/apps')
      .then((apps) => {
        const taken = new Set(apps.map((a) => a.name));
        let free = entry.id;
        for (let n = 2; taken.has(free); n++) free = `${entry.id}-${n}`;
        setName((current) => (current === entry.id ? free : current));
      })
      .catch(() => undefined);
  }, [entry.id]);

  useEffect(() => {
    api<{ port: number }>('GET', `/api/ports/suggest?preferred=${entry.defaultHostPort}`)
      .then(({ port: p }) => setPort((current) => (current === '' ? p : current)))
      .catch(() => undefined);
  }, [entry.defaultHostPort]);

  const problem = nameProblem(name);
  const suggestion = problem ? suggestName(name) : null;

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/apps', {
        catalogId: entry.id,
        name,
        ...(portTouched && port !== '' ? { hostPort: port } : {}),
      });
      navigate('/');
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <div className="card suggestion" role="dialog" aria-label={`Install ${entry.name}`}>
      <div className="row">
        <AppIcon iconUrl={entry.iconUrl} name={entry.name} />
        <strong>{entry.name}</strong>
      </div>
      <p className="hint">{entry.description}</p>
      {entry.guide.server && <GuideView guide={entry.guide} system={system} part="server" />}
      <label htmlFor="install-name">Name</label>
      <input id="install-name" value={name} onChange={(e) => setName(e.target.value)} />
      {problem && (
        <p className="error">
          {problem}{' '}
          {suggestion && suggestion !== name && (
            <button type="button" onClick={() => setName(suggestion)}>Use {suggestion}</button>
          )}
        </p>
      )}
      <details>
        <summary>Advanced</summary>
        <label htmlFor="install-port">Port</label>
        <input
          id="install-port"
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => {
            setPortTouched(true);
            setPort(e.target.value === '' ? '' : Number(e.target.value));
          }}
        />
        <p className="hint">The app will open at this port on your server. Leave it as suggested unless you need a specific one.</p>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={busy || problem !== null} onClick={() => void install()}>
          Install {entry.name}
        </button>
      </div>
    </div>
  );
}
