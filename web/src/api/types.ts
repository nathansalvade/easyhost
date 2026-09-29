export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
}

export type AppStatus = 'PENDING' | 'RUNNING' | 'STOPPED' | 'ERROR';

export interface AppView {
  id: string;
  name: string;
  image: string;
  status: AppStatus;
  hostPort: number;
  containerPort: number;
  catalogId: string | null;
  lastError: string | null;
  openPath: string;
  fixedPorts: Array<{ containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }>;
  dataPath: string;
  volumes: Array<{ name: string; containerPath: string; hostPath: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AppDetailView extends AppView {
  secrets: Array<{ name: string; label: string; value: string }>;
}

export interface GuideStep {
  text: string;
  command?: string;
}

export type DeviceOs = 'router' | 'windows' | 'macos' | 'linux' | 'android' | 'ios';

export interface Guide {
  afterInstall: GuideStep[];
  server?: {
    linux?: { default: GuideStep[]; [distro: string]: GuideStep[] };
    windows?: GuideStep[];
    macos?: GuideStep[];
  };
  devices?: Partial<Record<DeviceOs, GuideStep[]>>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: 'Media' | 'Files' | 'Smart home' | 'Network' | 'Monitoring';
  iconUrl: string;
  defaultHostPort: number;
  openPath?: string;
  guide: Guide;
}

export interface SystemInfo {
  os: 'linux' | 'windows' | 'macos' | 'other';
  distros: string[];
  version: string;
}

export interface RemoveResult {
  dataPath: string;
  dataDeleted: boolean;
}
