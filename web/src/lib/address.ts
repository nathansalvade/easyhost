export function appAddress(app: { hostPort: number; openPath: string }, location: { hostname: string } = window.location): string {
  const path = app.openPath && app.openPath !== '/' ? app.openPath : '';
  return `http://${location.hostname}:${app.hostPort}${path}`;
}

export function serverAddress(location: { hostname: string } = window.location): string {
  return location.hostname.replace(/^\[|\]$/g, '');
}
