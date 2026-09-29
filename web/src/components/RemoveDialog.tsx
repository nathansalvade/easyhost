import { useState } from 'react';

export function RemoveDialog({ appName, dataPath, onCancel, onConfirm, busy }: {
  appName: string;
  dataPath: string;
  onCancel(): void;
  onConfirm(deleteData: boolean): void;
  busy: boolean;
}) {
  const [deleteData, setDeleteData] = useState(false);
  return (
    <div className="card" role="dialog" aria-label={`Remove ${appName}`}>
      <p><strong>Remove {appName}?</strong></p>
      <p>The app will stop and be removed. Your data stays in {dataPath}, so installing it again later picks up where you left off.</p>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
        Delete data too
      </label>
      {deleteData && <p className="error">The data folder will be permanently deleted. This can't be undone.</p>}
      <div className="actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger" disabled={busy} onClick={() => onConfirm(deleteData)}>Remove app</button>
      </div>
    </div>
  );
}
