import { appAddress, serverAddress } from './address';

describe('address helpers', () => {
  it('uses the hostname the browser used, the app port and its open path', () => {
    expect(appAddress({ hostPort: 8096, openPath: '/' }, { hostname: '192.168.1.50' })).toBe('http://192.168.1.50:8096');
    expect(appAddress({ hostPort: 8082, openPath: '/admin' }, { hostname: '192.168.1.50' })).toBe('http://192.168.1.50:8082/admin');
  });

  it('keeps IPv6 brackets in URLs and strips them for display', () => {
    expect(appAddress({ hostPort: 80, openPath: '/' }, { hostname: '[fd00::5]' })).toBe('http://[fd00::5]:80');
    expect(serverAddress({ hostname: '[fd00::5]' })).toBe('fd00::5');
  });
});
