// Must match the max-width in Navbar.module.css that swaps the links for the
// menu button.
export const MOBILE_NAV_QUERY = '(max-width: 480px)';

export type MenuEvent =
  | { type: 'keydown'; key: string }
  | { type: 'pointerdown'; insideMenu: boolean }
  | { type: 'viewport'; mobile: boolean };

export type MenuAction = 'keep' | 'close' | 'closeAndRefocus';

/** What an event does to the open menu. */
export function menuAction(event: MenuEvent): MenuAction {
  switch (event.type) {
    case 'keydown':
      // Escape hands focus back to the button so keyboard users are not left
      // on a hidden element.
      return event.key === 'Escape' ? 'closeAndRefocus' : 'keep';
    case 'pointerdown':
      // The menu button counts as inside: its own click toggles the menu, and
      // closing here first would reopen it on the same tap.
      return event.insideMenu ? 'keep' : 'close';
    case 'viewport':
      return event.mobile ? 'keep' : 'close';
  }
}

/**
 * The menu is open only while the location it was opened at is current, so
 * any navigation closes it without an effect.
 */
export function isMenuOpen(openedAtKey: string | null, locationKey: string): boolean {
  return openedAtKey !== null && openedAtKey === locationKey;
}
