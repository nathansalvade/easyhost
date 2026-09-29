import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuideView } from './GuideView';

const guide = {
  afterInstall: [{ text: 'Open it.' }],
  server: {
    linux: { default: [{ text: 'Nothing to do.' }], ubuntu: [{ text: 'Turn off the stub:', command: 'sudo sed -i x' }] },
    windows: [{ text: 'Windows server step.' }],
  },
  devices: {
    router: [{ text: 'Set the router DNS to {serverAddress}.' }],
    windows: [{ text: 'Windows device step.' }],
    ios: [{ text: 'iPhone step with {serverAddress}.' }],
  },
};

describe('GuideView', () => {
  it('shows the server variant matching the reported system, with copyable commands', () => {
    render(<GuideView guide={guide} system={{ os: 'linux', distros: ['ubuntu', 'debian'], version: '1' }} />);
    expect(screen.getByText(/steps for your server \(ubuntu\)/i)).toBeInTheDocument();
    expect(screen.getByText('sudo sed -i x')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to do.')).not.toBeInTheDocument();
  });

  it('preselects the viewer\'s device and lets them switch, filling in the server address', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    render(<GuideView guide={guide} system={{ os: 'linux', distros: [], version: '1' }} />);
    expect(screen.getByRole('tab', { name: 'Windows' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Windows device step.')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Router (recommended)', 'Windows', 'iPhone / iPad']);
    await userEvent.click(screen.getByRole('tab', { name: 'iPhone / iPad' }));
    expect(screen.getByText('iPhone step with localhost.')).toBeInTheDocument();
  });

  it('shows only the server part in server mode', () => {
    render(<GuideView guide={guide} system={{ os: 'windows', distros: [], version: '1' }} part="server" />);
    expect(screen.getByText('Windows server step.')).toBeInTheDocument();
    expect(screen.queryByText('Open it.')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
