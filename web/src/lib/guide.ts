import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DeviceOs, Guide, GuideStep, SystemInfo } from '../api/types';

type Variant = { key: string; label: string; steps: GuideStep[] };

const DISTRO_LABELS: Record<string, string> = {
  default: 'Linux', ubuntu: 'Ubuntu', debian: 'Debian', fedora: 'Fedora', arch: 'Arch Linux', raspbian: 'Raspberry Pi OS',
};

export const DEVICE_LABELS: Record<DeviceOs, string> = {
  router: 'Router (recommended)',
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  android: 'Android',
  ios: 'iPhone / iPad',
};

export function serverVariants(server: Guide['server']): Variant[] {
  if (!server) return [];
  const linux = Object.entries(server.linux ?? {}).map(([key, steps]) => ({
    key: `linux:${key}`,
    label: DISTRO_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
    steps,
  }));
  const others: Variant[] = [];
  if (server.windows) others.push({ key: 'windows', label: 'Windows', steps: server.windows });
  if (server.macos) others.push({ key: 'macos', label: 'macOS', steps: server.macos });
  return [...linux, ...others];
}

export function pickServerSteps(server: Guide['server'], system: SystemInfo): Variant | null {
  const variants = serverVariants(server);
  if (variants.length === 0) return null;
  const find = (key: string) => variants.find((v) => v.key === key);
  if (system.os === 'windows' || system.os === 'macos') return find(system.os) ?? variants[0];
  for (const distro of system.distros) {
    const match = distro !== 'default' ? find(`linux:${distro}`) : undefined;
    if (match) return match;
  }
  return find('linux:default') ?? variants[0];
}

export function deviceOsFromUserAgent(userAgent: string): Exclude<DeviceOs, 'router'> | null {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return null;
}

export function fillPlaceholders(text: string, serverAddress: string): string {
  return text.split('{serverAddress}').join(serverAddress);
}

export function useSystem(): SystemInfo | undefined {
  const [system, setSystem] = useState<SystemInfo>();
  useEffect(() => {
    api<SystemInfo>('GET', '/api/system').then(setSystem).catch(() => setSystem({ os: 'other', distros: [], version: '' }));
  }, []);
  return system;
}
