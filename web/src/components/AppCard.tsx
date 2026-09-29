import { Link, useNavigate } from 'react-router-dom';
import type { AppView } from '../api/types';
import { appAddress } from '../lib/address';
import { AppIcon } from './AppIcon';
import { CopyButton } from './CopyButton';
import { StatusBadge } from './StatusBadge';

export function AppCard({ app, iconUrl }: { app: AppView; iconUrl?: string }) {
  const navigate = useNavigate();
  const address = appAddress(app);
  return (
    <div className="card app-card" onClick={() => navigate(`/apps/${app.id}`)}>
      <div className="row">
        <AppIcon iconUrl={iconUrl} name={app.name} />
        <div>
          {/* A real link too, so the app page is reachable by keyboard. */}
          <Link to={`/apps/${app.id}`} onClick={(e) => e.stopPropagation()}>
            <strong>{app.name}</strong>
          </Link>
          <div><StatusBadge status={app.status} /></div>
        </div>
      </div>
      <span className="hint">{address}</span>
      <div className="actions">
        <a className="button" href={address} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open</a>
        <CopyButton text={address} />
      </div>
    </div>
  );
}
