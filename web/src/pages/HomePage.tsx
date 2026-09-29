import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import type { AppView } from '../api/types';
import { AppCard } from '../components/AppCard';
import { AppIcon } from '../components/AppIcon';
import { useCatalog } from '../lib/catalog';
import { usePolling } from '../lib/use-polling';

const SUGGESTED = ['jellyfin', 'nextcloud', 'home-assistant', 'pihole'];

export function HomePage() {
  const { data: apps, error } = usePolling(() => api<AppView[]>('GET', '/api/apps'), 5000);
  const catalog = useCatalog();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const iconOf = (catalogId: string | null) => catalog?.find((c) => c.id === catalogId)?.iconUrl;

  return (
    <>
      <h1>Home</h1>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error !== undefined && !apps && <p className="error" role="alert">{messageFor(error)}</p>}
      {apps && apps.length === 0 && (
        <section>
          <p><strong>You don't have any apps yet.</strong> Pick one to get started, or browse everything in Add.</p>
          <div className="grid">
            {SUGGESTED.map((id) => catalog?.find((c) => c.id === id)).filter(Boolean).map((entry) => (
              <div key={entry!.id} className="card suggestion">
                <div className="row">
                  <AppIcon iconUrl={entry!.iconUrl} name={entry!.name} />
                  <strong>{entry!.name}</strong>
                </div>
                <p className="hint">{entry!.description}</p>
                <Link className="button primary" to={`/add?install=${entry!.id}`} aria-label={`Install ${entry!.name}`}>Install</Link>
              </div>
            ))}
          </div>
          <p><Link to="/add">Browse all apps</Link></p>
        </section>
      )}
      {apps && apps.length > 0 && (
        <div className="grid">
          {apps.map((app) => <AppCard key={app.id} app={app} iconUrl={iconOf(app.catalogId)} />)}
        </div>
      )}
    </>
  );
}
