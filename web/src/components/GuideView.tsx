import { useState } from 'react';
import type { DeviceOs, Guide, GuideStep, SystemInfo } from '../api/types';
import { serverAddress } from '../lib/address';
import { DEVICE_LABELS, deviceOsFromUserAgent, fillPlaceholders, pickServerSteps, serverVariants } from '../lib/guide';
import { CopyButton } from './CopyButton';

function Steps({ steps }: { steps: GuideStep[] }) {
  const address = serverAddress();
  return (
    <ol>
      {steps.map((step, i) => (
        <li key={i}>
          <p>{fillPlaceholders(step.text, address)}</p>
          {step.command && (
            <div>
              <pre><code>{step.command}</code></pre>
              <CopyButton text={step.command} label="Copy command" />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

const DEVICE_ORDER: DeviceOs[] = ['router', 'windows', 'macos', 'linux', 'android', 'ios'];

export function GuideView({ guide, system, part = 'all' }: { guide: Guide; system?: SystemInfo; part?: 'all' | 'server' }) {
  const picked = system ? pickServerSteps(guide.server, system) : null;
  const [serverKey, setServerKey] = useState<string | null>(null);
  const variants = serverVariants(guide.server);
  const server = variants.find((v) => v.key === serverKey) ?? picked;

  const devices = DEVICE_ORDER.filter((os) => guide.devices?.[os]);
  const detected = deviceOsFromUserAgent(navigator.userAgent);
  const [device, setDevice] = useState<DeviceOs | undefined>(
    detected && devices.includes(detected) ? detected : devices[0],
  );

  return (
    <section>
      {part === 'all' && (
        <>
          <h2>After installing</h2>
          <Steps steps={guide.afterInstall} />
        </>
      )}
      {server && (
        <>
          <h2>{part === 'server' ? 'Before you install' : 'On the server'}</h2>
          <p className="hint">Steps for your server ({server.label})</p>
          <Steps steps={server.steps} />
          {variants.length > 1 && (
            <details>
              <summary>Show steps for another system</summary>
              <div className="tabs">
                {variants.map((v) => (
                  <button key={v.key} type="button" onClick={() => setServerKey(v.key)}>{v.label}</button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {part === 'all' && devices.length > 0 && device && (
        <>
          <h2>On your devices</h2>
          <div className="tabs" role="tablist">
            {devices.map((os) => (
              <button key={os} type="button" role="tab" aria-selected={os === device} onClick={() => setDevice(os)}>
                {DEVICE_LABELS[os]}
              </button>
            ))}
          </div>
          <Steps steps={guide.devices![device]!} />
        </>
      )}
    </section>
  );
}
