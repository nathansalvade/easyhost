import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CopyButton } from '../components/CopyButton';

/**
 * Shown with props right after setup or recovery (see App), or through the
 * /recovery-code route with `state: { code, next }` (new code from Settings).
 */
export function RecoveryCodePage(props: { code?: string; onContinue?: () => void }) {
  const navigate = useNavigate();
  const state = useLocation().state as { code?: string; next?: string } | null;
  const code = props.code ?? state?.code;
  if (!code) return <Navigate to="/" replace />;
  const next = state?.next ?? '/';
  const onContinue = props.onContinue ?? (() => navigate(next, { replace: true }));

  const download = () => {
    const blob = new Blob([`EasyHost recovery code\n\n${code}\n\nUse it on the "Forgot password?" page if you lose your password.\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'easyhost-recovery-code.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="center-page">
      <h1>Your recovery code</h1>
      <div className="card">
        <p className="code">{code}</p>
        <div className="actions">
          <CopyButton text={code} />
          <button type="button" onClick={download}>Download</button>
        </div>
      </div>
      <p className="notice">
        We strongly recommend saving this code somewhere safe, like a password manager or a printed page. It is the
        only way to get back into EasyHost if you forget your password, and it won't be shown again.
      </p>
      <button className="primary" type="button" onClick={onContinue}>Continue</button>
    </main>
  );
}
