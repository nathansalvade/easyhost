import { deviceOsFromUserAgent, fillPlaceholders, pickServerSteps, serverVariants } from './guide';

const server = {
  linux: { default: [{ text: 'default' }], ubuntu: [{ text: 'ubuntu' }], fedora: [{ text: 'fedora' }] },
  windows: [{ text: 'windows' }],
  macos: [{ text: 'macos' }],
};

describe('pickServerSteps', () => {
  it.each([
    [{ os: 'linux', distros: ['ubuntu', 'debian'] }, 'ubuntu'],
    [{ os: 'linux', distros: ['linuxmint', 'ubuntu', 'debian'] }, 'ubuntu'],
    [{ os: 'linux', distros: ['debian'] }, 'default'],
    [{ os: 'linux', distros: [] }, 'default'],
    [{ os: 'windows', distros: [] }, 'windows'],
    [{ os: 'macos', distros: [] }, 'macos'],
  ] as const)('%j → %s', (system, text) => {
    expect(pickServerSteps(server, { ...system, distros: [...system.distros], version: '1' })!.steps[0].text).toBe(text);
  });

  it('returns null when the app has no server steps', () => {
    expect(pickServerSteps(undefined, { os: 'linux', distros: [], version: '1' })).toBeNull();
  });

  it('lists every variant with a readable label', () => {
    expect(serverVariants(server).map((v) => v.label)).toEqual(['Linux', 'Ubuntu', 'Fedora', 'Windows', 'macOS']);
  });
});

describe('deviceOsFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'ios'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['curl/8.0', null],
  ])('%s → %s', (ua, os) => {
    expect(deviceOsFromUserAgent(ua)).toBe(os);
  });
});

it('fills {serverAddress}', () => {
  expect(fillPlaceholders('Set DNS to {serverAddress}.', '192.168.1.50')).toBe('Set DNS to 192.168.1.50.');
});
