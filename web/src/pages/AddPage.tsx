import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CatalogEntry } from '../api/types';
import { AppIcon } from '../components/AppIcon';
import { CustomImageForm } from '../components/CustomImageForm';
import { InstallDialog } from '../components/InstallDialog';
import { useCatalog } from '../lib/catalog';

const ALL = 'All';

export function AddPage() {
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [custom, setCustom] = useState(false);

  const installId = params.get('install');
  const selected = catalog?.find((c) => c.id === installId);
  const open = (entry: CatalogEntry) => setParams({ install: entry.id });
  const close = () => setParams({});

  if (!catalog) return <p>Loading…</p>;
  const categories = [ALL, ...new Set(catalog.map((c) => c.category))];
  const q = query.trim().toLowerCase();
  const shown = catalog.filter(
    (c) => (category === ALL || c.category === category) &&
      (!q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
  );

  return (
    <>
      <h1>Add an app</h1>
      {selected && <InstallDialog key={selected.id} entry={selected} onClose={close} />}
      {custom && <CustomImageForm onClose={() => setCustom(false)} />}
      <input type="search" placeholder="Search apps" aria-label="Search apps" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="tabs">
        {categories.map((c) => (
          <button key={c} type="button" aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      <div className="grid">
        {shown.map((entry) => (
          <div key={entry.id} className="card suggestion">
            <div className="row">
              <AppIcon iconUrl={entry.iconUrl} name={entry.name} />
              <strong>{entry.name}</strong>
            </div>
            <p className="hint">{entry.description}</p>
            <button type="button" className="primary" onClick={() => open(entry)}>Install</button>
          </div>
        ))}
      </div>
      {shown.length === 0 && <p className="hint">No apps match your search.</p>}
      <p><button type="button" onClick={() => setCustom(true)}>Install a custom image</button></p>
    </>
  );
}
