import * as fs from 'fs';
import * as path from 'path';

export type ServerOs = 'linux' | 'windows' | 'macos' | 'other';

export interface SystemInfo {
  os: ServerOs;
  distros: string[];
  version: string;
}

function readValue(content: string, key: string): string | undefined {
  const line = content.split('\n').find((l) => l.startsWith(`${key}=`));
  // os-release allows double- or single-quoted values.
  return line?.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
}

export function parseOsRelease(content: string): string[] {
  const id = readValue(content, 'ID');
  const idLike = readValue(content, 'ID_LIKE');
  return [id, ...(idLike ? idLike.split(/\s+/) : [])]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
}

export function detectSystem({
  platform = process.platform,
  readOsRelease = () => fs.readFileSync('/etc/os-release', 'utf8'),
  readPackageJson = () => fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
}: {
  platform?: NodeJS.Platform;
  readOsRelease?: () => string;
  readPackageJson?: () => string;
} = {}): SystemInfo {
  const os: ServerOs =
    platform === 'linux' ? 'linux' : platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'other';
  let distros: string[] = [];
  if (os === 'linux') {
    try {
      distros = parseOsRelease(readOsRelease());
    } catch {
      distros = [];
    }
  }
  const version = (JSON.parse(readPackageJson()) as { version: string }).version;
  return { os, distros, version };
}
