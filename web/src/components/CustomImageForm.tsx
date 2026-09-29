import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { nameProblem } from '../lib/names';

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** "/app/data" → "app-data": a safe folder name derived from the path inside the app. */
export function volumeNameFor(containerPath: string): string {
  return containerPath.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data';
}

export function CustomImageForm({ onClose }: { onClose(): void }) {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [hostPort, setHostPort] = useState<number | ''>(8080);
  const [containerPort, setContainerPort] = useState<number | ''>('');
  const [env, setEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const filledEnv = env.filter((e) => e.key || e.value);
    const filledFolders = folders.filter(Boolean);
    const problem =
      nameProblem(name) ??
      (!image ? 'Enter the image to install.' : null) ??
      (hostPort === '' ? 'Enter a port.' : null) ??
      (filledEnv.some((e) => !ENV_KEY.test(e.key)) ? 'Setting names can use letters, numbers and underscores, and cannot start with a number.' : null) ??
      (filledFolders.some((f) => !f.startsWith('/')) ? 'Folder paths inside the app start with /, for example /data.' : null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await api('POST', '/api/apps', {
        name,
        image,
        hostPort,
        ...(containerPort !== '' ? { containerPort } : {}),
        ...(filledEnv.length ? { env: Object.fromEntries(filledEnv.map((e) => [e.key, e.value])) } : {}),
        ...(filledFolders.length
          ? { volumes: filledFolders.map((containerPath) => ({ name: volumeNameFor(containerPath), containerPath })) }
          : {}),
      });
      navigate('/');
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  const num = (v: string): number | '' => (v === '' ? '' : Number(v));
  return (
    // Any edit clears a message about the previous attempt.
    <form className="card" onSubmit={submit} onChange={() => setError(null)} aria-label="Install a custom image">
      <h2>Install a custom image</h2>
      <p className="hint">For apps not in the catalog. You need the image name from the app's documentation.</p>
      <label htmlFor="c-name">App name</label>
      <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="c-image">Image</label>
      <input id="c-image" placeholder="publisher/app:1.0" value={image} onChange={(e) => setImage(e.target.value)} />
      <label htmlFor="c-host">Port on the server</label>
      <input id="c-host" type="number" value={hostPort} onChange={(e) => setHostPort(num(e.target.value))} />
      <label htmlFor="c-container">Port inside the app</label>
      <input id="c-container" type="number" placeholder="Same as above" value={containerPort} onChange={(e) => setContainerPort(num(e.target.value))} />

      <h2>Settings (optional)</h2>
      <p className="hint">Environment variables from the app's documentation, such as TZ.</p>
      {env.map((row, i) => (
        <div key={i} className="actions">
          <input aria-label={`Setting ${i + 1} name`} placeholder="NAME" value={row.key}
            onChange={(e) => setEnv(env.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
          <input aria-label={`Setting ${i + 1} value`} placeholder="value" value={row.value}
            onChange={(e) => setEnv(env.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
        </div>
      ))}
      <button type="button" onClick={() => setEnv([...env, { key: '', value: '' }])}>Add setting</button>

      <h2>Folders to keep (optional)</h2>
      <p className="hint">Folders inside the app whose files should survive restarts and reinstalls, such as /data. EasyHost stores them in the app's data folder.</p>
      {folders.map((folder, i) => (
        <input key={i} aria-label={`Folder ${i + 1}`} placeholder="/data" value={folder}
          onChange={(e) => setFolders(folders.map((f, j) => (j === i ? e.target.value : f)))} />
      ))}
      <button type="button" onClick={() => setFolders([...folders, ''])}>Add folder</button>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>Install image</button>
      </div>
    </form>
  );
}
