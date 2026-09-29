import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppDataStore } from './app-data';

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost data é '));
  tempDirs.push(dir);
  return dir;
}

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe('AppDataStore', () => {
  it('creates one folder per volume under DATA_DIR/apps/<id>', async () => {
    const dataDir = tempDataDir();
    const store = new AppDataStore(dataDir);
    const mounts = await store.ensure('abc123', [
      { name: 'config', containerPath: '/config' },
      { name: 'media', containerPath: '/media' },
    ]);
    expect(mounts).toEqual([
      { hostPath: path.join(dataDir, 'apps', 'abc123', 'config'), containerPath: '/config' },
      { hostPath: path.join(dataDir, 'apps', 'abc123', 'media'), containerPath: '/media' },
    ]);
    expect(fs.statSync(mounts[1].hostPath).isDirectory()).toBe(true);
  });

  it('deletes only the app folder', async () => {
    const dataDir = tempDataDir();
    const store = new AppDataStore(dataDir);
    await store.ensure('keep1', [{ name: 'config', containerPath: '/config' }]);
    await store.ensure('drop1', [{ name: 'config', containerPath: '/config' }]);
    await expect(store.remove('drop1')).resolves.toEqual({ deleted: true, path: path.join(dataDir, 'apps', 'drop1') });
    expect(fs.existsSync(path.join(dataDir, 'apps', 'drop1'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'apps', 'keep1'))).toBe(true);
  });

  it.each(['..', '../x', 'a/b', 'a\\b', '', '.'])('refuses the unsafe id %p', (id) => {
    const store = new AppDataStore(tempDataDir());
    expect(() => store.appDir(id)).toThrow();
  });

  describe('folders for images that run as a fixed user', () => {
    const owner = { uid: 1000, gid: 1000 };
    const volumes = [{ name: 'files', containerPath: '/srv' }];

    it('gives each folder to that user on Linux', async () => {
      const dataDir = tempDataDir();
      const chown = jest.fn().mockResolvedValue(undefined);
      const chmod = jest.fn().mockResolvedValue(undefined);
      const [mount] = await new AppDataStore(dataDir, { chown, chmod, platform: 'linux' }).ensure('own1', volumes, owner);
      expect(chown).toHaveBeenCalledWith(mount.hostPath, 1000, 1000);
      expect(chmod).not.toHaveBeenCalled();
    });

    it('opens the folder to all users when EasyHost may not change its owner', async () => {
      const dataDir = tempDataDir();
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const chown = jest.fn().mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
      const chmod = jest.fn().mockResolvedValue(undefined);
      const [mount] = await new AppDataStore(dataDir, { chown, chmod, platform: 'linux' }).ensure('own2', volumes, owner);
      expect(chmod).toHaveBeenCalledWith(mount.hostPath, 0o777);
    });

    it.each(['win32', 'darwin'] as const)('leaves permissions to Docker Desktop on %s', async (platform) => {
      const chown = jest.fn();
      const chmod = jest.fn();
      await new AppDataStore(tempDataDir(), { chown, chmod, platform }).ensure('own3', volumes, owner);
      expect(chown).not.toHaveBeenCalled();
      expect(chmod).not.toHaveBeenCalled();
    });

    it('changes nothing when the image runs as root', async () => {
      const chown = jest.fn();
      await new AppDataStore(tempDataDir(), { chown, platform: 'linux' }).ensure('own4', volumes);
      expect(chown).not.toHaveBeenCalled();
    });
  });

  it('reports a deletion failure instead of throwing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const dataDir = tempDataDir();
    const rm = jest.fn().mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
    const store = new AppDataStore(dataDir, { rm });
    await store.ensure('busy1', [{ name: 'config', containerPath: '/config' }]);
    await expect(store.remove('busy1')).resolves.toEqual({ deleted: false, path: path.join(dataDir, 'apps', 'busy1') });
  });
});
