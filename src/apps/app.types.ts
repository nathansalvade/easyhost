import type { DataOwner, FixedPort, Volume } from '../catalog/catalog.schema';

export type AppStatus = 'PENDING' | 'RUNNING' | 'STOPPED' | 'ERROR';

export interface CreateAppInput {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  env?: Record<string, string>;
  catalogId?: string;
  volumes?: Volume[];
  /** Only used while installing, to hand the data folders to a non-root image user. */
  dataOwner?: DataOwner;
  fixedPorts?: FixedPort[];
  secrets?: Record<string, string>;
}

export interface LogsInput {
  tail: number;
}
