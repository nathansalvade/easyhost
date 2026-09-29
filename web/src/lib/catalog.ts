import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CatalogEntry } from '../api/types';

export function useCatalog(): CatalogEntry[] | undefined {
  const [entries, setEntries] = useState<CatalogEntry[]>();
  useEffect(() => {
    api<CatalogEntry[]>('GET', '/api/catalog').then(setEntries).catch(() => setEntries([]));
  }, []);
  return entries;
}
