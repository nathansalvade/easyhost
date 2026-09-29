import { detectSystem, parseOsRelease } from './system';

const samples: Record<string, string> = {
  ubuntu: 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"\n',
  debian: 'PRETTY_NAME="Debian GNU/Linux 12"\nID=debian\n',
  fedora: 'NAME="Fedora Linux"\nID=fedora\nVERSION_ID=40\n',
  mint: 'NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\n',
  raspbian: 'ID=raspbian\nID_LIKE=debian\n',
};

describe('parseOsRelease', () => {
  it.each([
    ['ubuntu', ['ubuntu', 'debian']],
    ['debian', ['debian']],
    ['fedora', ['fedora']],
    ['mint', ['linuxmint', 'ubuntu', 'debian']],
    ['raspbian', ['raspbian', 'debian']],
  ])('%s', (name, expected) => {
    expect(parseOsRelease(samples[name])).toEqual(expected);
  });

  it('accepts single-quoted values and CRLF line endings', () => {
    expect(parseOsRelease("ID='opensuse-leap'\r\nID_LIKE='suse opensuse'\r\n")).toEqual(['opensuse-leap', 'suse', 'opensuse']);
  });

  it('returns an empty list for unknown content', () => {
    expect(parseOsRelease('garbage')).toEqual([]);
  });
});

describe('detectSystem', () => {
  const readPackageJson = () => JSON.stringify({ version: '0.2.0' });

  it('reports linux with distros', () => {
    expect(detectSystem({ platform: 'linux', readOsRelease: () => samples.ubuntu, readPackageJson })).toEqual({
      os: 'linux',
      distros: ['ubuntu', 'debian'],
      version: '0.2.0',
    });
  });

  it('falls back to no distros when /etc/os-release cannot be read', () => {
    const readOsRelease = () => {
      throw new Error('ENOENT');
    };
    expect(detectSystem({ platform: 'linux', readOsRelease, readPackageJson }).distros).toEqual([]);
  });

  it.each([
    ['win32', 'windows'],
    ['darwin', 'macos'],
    ['freebsd', 'other'],
  ] as const)('maps %s to %s', (platform, os) => {
    expect(detectSystem({ platform, readOsRelease: () => '', readPackageJson })).toMatchObject({ os, distros: [] });
  });
});
