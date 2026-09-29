import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import type { AppDetailView, RemoveResult } from '../api/types';
import { AppIcon } from '../components/AppIcon';
import { CopyButton } from '../components/CopyButton';
import { GuideView } from '../components/GuideView';
import { LogViewer } from '../components/LogViewer';
import { RemoveDialog } from '../components/RemoveDialog';
import { StatusBadge } from '../components/StatusBadge';
import { appAddress } from '../lib/address';
import { useCatalog } from '../lib/catalog';
import { useSystem } from '../lib/guide';
import { usePolling } from '../lib/use-polling';

function Secret({ label, value }: { label: string; value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="actions" style={{ alignItems: 'center' }}>
      <span>{label}:</span>
      <code>{shown ? value : '••••••••••••'}</code>
      <button type="button" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      <CopyButton text={value} />
    </div>
  );
}

export function AppDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: app, error, reload } = usePolling(() => api<AppDetailView>('GET', `/api/apps/${id}`), 5000);
  const catalog = useCatalog();
  const system = useSystem();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!app) return error ? <p className="error" role="alert">{messageFor(error)}</p> : <p>Loading…</p>;

  const entry = catalog?.find((c) => c.id === app.catalogId);
  const address = appAddress(app);

  const run = async (action: 'start' | 'stop') => {
    setBusy(true);
    setActionError(null);
    try {
      await api('POST', `/api/apps/${id}/${action}`);
      await reload();
    } catch (err) {
      setActionError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (deleteData: boolean) => {
    setBusy(true);
    try {
      const result = await api<RemoveResult>('DELETE', `/api/apps/${id}?deleteData=${deleteData}`);
      const notice = deleteData && !result.dataDeleted
        ? `${app.name} was removed, but its data folder couldn't be deleted: ${result.dataPath}`
        : `${app.name} was removed.`;
      navigate('/', { state: { notice } });
    } catch (err) {
      setActionError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <AppIcon iconUrl={entry?.iconUrl} name={app.name} />
        <h1 style={{ margin: 0 }}>{app.name}</h1>
        <StatusBadge status={app.status} />
      </div>

      {app.status === 'ERROR' && (
        <p className="notice" role="alert">
          {app.lastError ?? "This app isn't working. Try Start; if that doesn't help, remove it and install it again."}
        </p>
      )}
      {actionError && <p className="error" role="alert">{actionError}</p>}

      <section className="card">
        <p>{address}</p>
        <div className="actions">
          <a className="button primary" href={address} target="_blank" rel="noreferrer">Open</a>
          <CopyButton text={address} />
          {app.status === 'RUNNING'
            ? <button type="button" disabled={busy} onClick={() => void run('stop')}>Stop</button>
            : <button type="button" disabled={busy || app.status === 'PENDING'} onClick={() => void run('start')}>Start</button>}
          <button type="button" className="danger" onClick={() => setRemoving(true)}>Remove</button>
        </div>
        {app.secrets.map((s) => <Secret key={s.name} label={s.label} value={s.value} />)}
      </section>

      {removing && (
        <RemoveDialog appName={app.name} dataPath={app.dataPath} busy={busy} onCancel={() => setRemoving(false)} onConfirm={(d) => void remove(d)} />
      )}

      {entry && <GuideView guide={entry.guide} system={system} />}

      <LogViewer appId={app.id} />

      <section>
        <h2>Data</h2>
        <p className="hint">This app's files are kept on the server in:</p>
        <ul>{app.volumes.map((v) => <li key={v.name}><code>{v.hostPath}</code></li>)}</ul>
      </section>

      <details>
        <summary>Advanced details</summary>
        <p className="hint">Image {app.image} · port {app.hostPort} → {app.containerPort}</p>
      </details>
    </>
  );
}
