export const MENU_WIDTH = 208;
export const MENU_HEIGHT = 76;
const EDGE = 8;
const GAP = 4;

/**
 * Where a fixed menu goes: its right edge on the trigger's right edge, kept inside the
 * viewport, and below the trigger unless that leaves no room, then above it.
 */
export function placeMenu(
  trigger: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(
    EDGE,
    Math.min(trigger.right - MENU_WIDTH, viewport.width - MENU_WIDTH - EDGE),
  );
  const below = viewport.height - trigger.bottom >= MENU_HEIGHT + EDGE;
  return {
    left,
    top: below ? trigger.bottom + GAP : trigger.top - MENU_HEIGHT - GAP,
  };
}

/** The app header sticks to the top of the page; a button under it is out of sight. */
const STICKY_HEADER = 56;

/** Whether the trigger can still be seen, so the menu does not float apart from it. */
export function triggerInView(
  trigger: { top: number; bottom: number },
  viewport: { height: number },
): boolean {
  return trigger.bottom > STICKY_HEADER && trigger.top < viewport.height;
}
