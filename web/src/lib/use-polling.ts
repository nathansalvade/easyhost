import { useCallback, useEffect, useRef, useState } from 'react';

export function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(undefined);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void reload();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs]);

  return { data, error, reload };
}
