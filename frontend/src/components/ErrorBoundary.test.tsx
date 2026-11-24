// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

const { reportClientError } = vi.hoisted(() => ({ reportClientError: vi.fn() }));
vi.mock('../utils/clientErrors', () => ({ reportClientError }));

function Broken(): never {
  throw new Error('render failed');
}

const renderInBoundary = (child: ReactNode) =>
  render(
    <MemoryRouter>
      <ErrorBoundary>{child}</ErrorBoundary>
    </MemoryRouter>
  );

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    reportClientError.mockReset();
  });

  it('renders its children when nothing throws', () => {
    renderInBoundary(<p>Page content</p>);
    expect(screen.getByText('Page content')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it('replaces a child that throws with a reload screen', async () => {
    // React reports the caught error to the console; the test expects it.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });

    renderInBoundary(<Broken />);

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    expect(screen.getByText('Reloading the page usually fixes this.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reports the caught error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderInBoundary(<Broken />);
    expect(reportClientError).toHaveBeenCalledWith('boundary', expect.objectContaining({ message: 'render failed' }));
  });
});
