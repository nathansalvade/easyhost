import { useEffect, useState } from 'react';

type Health = 'ok' | 'docker-down' | 'unreachable' | 'unknown';

export function Banners() {
  const [health, setHealth] = useState<Health>('unknown');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/health');
        const body = (await res.json()) as { docker?: boolean };
        if (!cancelled) setHealth(body.docker ? 'ok' : 'docker-down');
      } catch {
        if (!cancelled) setHealth('unreachable');
      }
    };
    void check();
    const timer = setInterval(() => void check(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (health === 'unreachable') {
    return <div className="banner" role="alert">Can't reach EasyHost. Check that the server is on. Retrying…</div>;
  }
  if (health === 'docker-down') {
    return <div className="banner" role="alert">Docker isn't running on the server, so apps can't start.</div>;
  }
  return null;
}
