import { DEVICE_TTL_MS, TrustedDevices } from './trusted-devices';

describe('TrustedDevices', () => {
  it('trusts issued tokens only, until they expire', () => {
    let now = 0;
    const devices = new TrustedDevices(() => now);
    const token = devices.issue();
    expect(devices.has(token)).toBe(true);
    expect(devices.has('forged')).toBe(false);
    expect(devices.has(undefined)).toBe(false);
    now = DEVICE_TTL_MS + 1;
    expect(devices.has(token)).toBe(false);
  });

  it('forgets the oldest device beyond its cap', () => {
    const devices = new TrustedDevices(Date.now, 2);
    const first = devices.issue();
    const second = devices.issue();
    const third = devices.issue();
    expect([devices.has(first), devices.has(second), devices.has(third)]).toEqual([false, true, true]);
  });

  it('forgets every device on clear', () => {
    const devices = new TrustedDevices();
    const token = devices.issue();
    devices.clear();
    expect(devices.has(token)).toBe(false);
  });
});
