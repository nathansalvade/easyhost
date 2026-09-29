import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AuthProvider } from '../auth';

export function renderApp(path = '/') {
  // Only advance fake timers when a test enabled them; with real timers this is a no-op.
  const user = userEvent.setup({ advanceTimers: (ms) => (vi.isFakeTimers() ? vi.advanceTimersByTime(ms) : undefined) });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { user };
}
