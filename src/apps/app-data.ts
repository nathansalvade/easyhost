import * as fs from 'fs';
import * as path from 'path';
import type { DataOwner, Volume } from '../catalog/catalog.schema';

const SAFE_ID = /^[A-Za-z0-9]+$/;

export interface AppDataStoreOptions {
  rm?: typeof fs.promises.rm;
  chown?: typeof fs.promises.chown;
  chmod?: typeof fs.promises.chmod;
  platform?: NodeJS.Platform;
}

export class AppDataStore {
  private readonly appsRoot: string;
  private readonly rm: typeof fs.promises.rm;
  private readonly chown: typeof fs.promises.chown;
  private readonly chmod: typeof fs.promises.chmod;
  private readonly platform: NodeJS.Platform;

  constructor(
    dataDir: string,
    {
      rm = fs.promises.rm,
      chown = fs.promises.chown,
      chmod = fs.promises.chmod,
      platform = process.platform,
    }: AppDataStoreOptions = {},
  ) {
    this.appsRoot = path.resolve(dataDir, 'apps');
    this.rm = rm;
    this.chown = chown;
    this.chmod = chmod;
    this.platform = platform;
  }

  appDir(appId: string): string {
    if (!SAFE_ID.test(appId)) {
      throw new Error(`Refusing unsafe app id for data folder: ${JSON.stringify(appId)}`);
    }
    const dir = path.resolve(this.appsRoot, appId);
    if (path.dirname(dir) !== this.appsRoot) {
      throw new Error(`Data folder escapes ${this.appsRoot}`);
    }
    return dir;
  }

  async ensure(
    appId: string,
    volumes: Volume[],
    owner?: DataOwner,
  ): Promise<Array<{ hostPath: string; containerPath: string }>> {
    const dir = this.appDir(appId);
    await this.lockAppsRoot();
    return Promise.all(
      volumes.map(async (volume) => {
        const hostPath = path.join(dir, volume.name);
        await fs.promises.mkdir(hostPath, { recursive: true });
        if (owner) await this.handOver(hostPath, owner);
        return { hostPath, containerPath: volume.containerPath };
      }),
    );
  }

  /**
   * Only EasyHost's own user may enter DATA_DIR/apps (called at startup and
   * before each install). Docker resolves bind
   * mounts as its daemon user, so containers still reach their folders, but
   * other local accounts can never reach a folder opened by `handOver`.
   * chmod is explicit because mkdir's mode is narrowed by the umask only.
   */
  async lockAppsRoot(): Promise<void> {
    await fs.promises.mkdir(this.appsRoot, { recursive: true, mode: 0o700 });
    try {
      await fs.promises.chmod(this.appsRoot, 0o700);
    } catch (err) {
      // Owned by another user (e.g. created by an earlier run as root): keep
      // installing rather than fail every app, but say what to fix.
      console.warn(
        `Could not make ${this.appsRoot} private (${(err as NodeJS.ErrnoException).code}). ` +
          'Make it owned by the user running EasyHost with mode 700.',
      );
    }
  }

  /**
   * Some images run as a fixed non-root user (File Browser: 1000:1000). On
   * Linux a bind-mounted folder keeps its host owner, so a folder created by
   * EasyHost would be read-only for that user. Give it to the user; if
   * EasyHost may not chown (it is not root), open just this folder instead.
   * Docker Desktop (Windows, macOS) maps permissions itself.
   */
  private async handOver(hostPath: string, owner: DataOwner): Promise<void> {
    if (this.platform !== 'linux') return;
    try {
      await this.chown(hostPath, owner.uid, owner.gid);
    } catch (err) {
      console.warn(
        `Could not give ${hostPath} to user ${owner.uid}:${owner.gid} (${(err as NodeJS.ErrnoException).code}); ` +
          'making it writable for all users so the app can save its data.',
      );
      await this.chmod(hostPath, 0o777);
    }
  }

  async remove(appId: string): Promise<{ deleted: boolean; path: string }> {
    const dir = this.appDir(appId);
    try {
      await this.rm(dir, { recursive: true, force: true });
      return { deleted: true, path: dir };
    } catch (err) {
      console.error(err);
      return { deleted: false, path: dir };
    }
  }
}
