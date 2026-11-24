// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Footer from './Footer';

const linkNames = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('Footer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the current year and the coffee link when no other link is configured', () => {
    vi.useFakeTimers({ now: new Date('2031-03-01T12:00:00Z'), toFake: ['Date'] });
    render(<Footer />);

    expect(screen.getByText('© 2031 Jacob Fain')).toBeTruthy();
    expect(linkNames()).toEqual(['Buy me a coffee']);
    const coffee = screen.getByRole('link', { name: 'Buy me a coffee' });
    expect(coffee.getAttribute('href')).toBe('https://buymeacoffee.com/jacobfain');
    expect(coffee.getAttribute('target')).toBe('_blank');
    expect(coffee.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('adds Instagram and Email, in that order, before the coffee link', () => {
    render(<Footer instagramUrl="https://www.instagram.com/jacobfain" contactEmail="hello@jacobfain.com" />);

    expect(linkNames()).toEqual(['Instagram', 'Email', 'Buy me a coffee']);
    expect(screen.getByRole('link', { name: 'Instagram' }).getAttribute('href')).toBe(
      'https://www.instagram.com/jacobfain'
    );
    const email = screen.getByRole('link', { name: 'Email' });
    expect(email.getAttribute('href')).toBe('mailto:hello@jacobfain.com');
    expect(email.getAttribute('target')).toBeNull();
  });

  it('shows only the links that are configured', () => {
    const { unmount } = render(<Footer instagramUrl="" contactEmail="hello@jacobfain.com" />);
    expect(linkNames()).toEqual(['Email', 'Buy me a coffee']);
    unmount();

    render(<Footer instagramUrl="https://instagram.com/jacobfain" />);
    expect(linkNames()).toEqual(['Instagram', 'Buy me a coffee']);
  });

  it('hides the separators from assistive technology', () => {
    const { container } = render(<Footer instagramUrl="https://instagram.com/jacobfain" />);
    const dots = [...container.querySelectorAll('footer span')].filter((s) => s.textContent === '·');
    expect(dots).toHaveLength(2);
    for (const dot of dots) expect(dot.getAttribute('aria-hidden')).toBe('true');
  });
});
