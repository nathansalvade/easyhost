import { render, screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { Banners } from './Banners';

describe('Banners', () => {
  it('says when Docker is not running', async () => {
    mockApi([{ method: 'GET', path: '/health', body: { ok: true, docker: false } }]);
    render(<Banners />);
    expect(await screen.findByText(/docker isn't running on the server/i)).toBeInTheDocument();
  });

  it('says when the server cannot be reached, and clears once it is back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<Banners />);
    expect(await screen.findByText(/can't reach easyhost/i)).toBeInTheDocument();
    mockApi([{ method: 'GET', path: '/health', body: { ok: true, docker: true } }]);
    await vi.advanceTimersByTimeAsync(10_000);
    // Reading the response body resolves after the timer tick.
    await vi.waitFor(() => expect(screen.queryByText(/can't reach easyhost/i)).not.toBeInTheDocument());
  });

  it('shows nothing when everything is fine', async () => {
    const api = mockApi([{ method: 'GET', path: '/health', body: { ok: true, docker: true } }]);
    const { container } = render(<Banners />);
    await vi.waitFor(() => expect(api.calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});
