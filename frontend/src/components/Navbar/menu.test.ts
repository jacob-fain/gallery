import { describe, expect, it } from 'vitest';
import { isMenuOpen, menuAction } from './menu';

describe('menuAction', () => {
  it('closes on Escape and returns focus to the button', () => {
    expect(menuAction({ type: 'keydown', key: 'Escape' })).toBe('closeAndRefocus');
  });

  it('ignores other keys', () => {
    expect(menuAction({ type: 'keydown', key: 'Tab' })).toBe('keep');
    expect(menuAction({ type: 'keydown', key: 'Enter' })).toBe('keep');
  });

  it('closes on a tap outside the menu and keeps it open on a tap inside', () => {
    expect(menuAction({ type: 'pointerdown', insideMenu: false })).toBe('close');
    expect(menuAction({ type: 'pointerdown', insideMenu: true })).toBe('keep');
  });

  it('closes when the viewport grows past the breakpoint', () => {
    expect(menuAction({ type: 'viewport', mobile: false })).toBe('close');
    expect(menuAction({ type: 'viewport', mobile: true })).toBe('keep');
  });
});

describe('isMenuOpen', () => {
  it('is closed until opened', () => {
    expect(isMenuOpen(null, 'abc')).toBe(false);
  });

  it('stays open at the location it was opened at', () => {
    expect(isMenuOpen('abc', 'abc')).toBe(true);
  });

  it('closes after any navigation', () => {
    expect(isMenuOpen('abc', 'def')).toBe(false);
  });
});
