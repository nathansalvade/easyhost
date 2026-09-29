import * as path from 'path';
import type { App } from '@prisma/client';
import type { Catalog, FixedPort, Volume } from '../catalog/catalog';
import type { AppDataStore } from './app-data';

export interface ViewContext {
  catalog: Catalog;
  dataStore: AppDataStore;
}

export interface AppView {
  id: string;
  name: string;
  image: string;
  status: string;
  hostPort: number;
  containerPort: number;
  catalogId: string | null;
  lastError: string | null;
  openPath: string;
  fixedPorts: FixedPort[];
  dataPath: string;
  volumes: Array<Volume & { hostPath: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppDetailView extends AppView {
  secrets: Array<{ name: string; label: string; value: string }>;
}

export function toAppView(app: App, { catalog, dataStore }: ViewContext): AppView {
  const entry = app.catalogId ? catalog.get(app.catalogId) : undefined;
  const dataPath = dataStore.appDir(app.id);
  const volumes = JSON.parse(app.volumes) as Volume[];
  return {
    id: app.id,
    name: app.name,
    image: app.image,
    status: app.status,
    hostPort: app.hostPort,
    containerPort: app.containerPort,
    catalogId: app.catalogId,
    lastError: app.lastError,
    openPath: entry?.openPath ?? '/',
    fixedPorts: JSON.parse(app.fixedPorts) as FixedPort[],
    dataPath,
    volumes: volumes.map((v) => ({ ...v, hostPath: path.join(dataPath, v.name) })),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

export function toAppDetailView(app: App, ctx: ViewContext): AppDetailView {
  const entry = app.catalogId ? ctx.catalog.get(app.catalogId) : undefined;
  const values = JSON.parse(app.secrets) as Record<string, string>;
  const secrets = Object.entries(values).map(([name, value]) => ({
    name,
    value,
    label: entry?.generatedSecrets.find((s) => s.name === name)?.label ?? name,
  }));
  return { ...toAppView(app, ctx), secrets };
}
