export type AppStatus = 'PENDING' | 'RUNNING' | 'STOPPED' | 'ERROR';

export interface CreateAppInput {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  env?: Record<string, string>;
}

export interface LogsInput {
  tail: number;
}
