import type { AppStatus } from '../api/types';

export const STATUS_LABELS: Record<AppStatus, string> = {
  RUNNING: 'Running',
  STOPPED: 'Stopped',
  PENDING: 'Installing…',
  ERROR: 'Problem',
};

export function StatusBadge({ status }: { status: AppStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>;
}
