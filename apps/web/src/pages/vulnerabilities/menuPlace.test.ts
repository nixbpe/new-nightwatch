import { describe, expect, it } from "vitest";

import { MENU_HEIGHT, MENU_WIDTH, placeMenu, triggerInView } from "./menuPlace";

const viewport = { width: 1440, height: 900 };
const trigger = { left: 1205, right: 1330, top: 652, bottom: 684 };

describe("placeMenu", () => {
  it("puts the menu's right edge on the trigger's right edge, below it", () => {
    const place = placeMenu(trigger, viewport);
    expect(place.left + MENU_WIDTH).toBe(trigger.right);
    expect(place.top).toBe(trigger.bottom + 4);
  });

  it("keeps the menu inside the viewport on the right", () => {
    const place = placeMenu({ ...trigger, right: 1500 }, viewport);
    expect(place.left + MENU_WIDTH).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("keeps the menu inside the viewport on the left", () => {
    expect(placeMenu({ ...trigger, right: 50 }, viewport).left).toBe(8);
  });

  it("opens upward when there is no room below", () => {
    const low = { ...trigger, top: 860, bottom: 892 };
    expect(placeMenu(low, viewport).top).toBe(low.top - MENU_HEIGHT - 4);
  });
});

describe("triggerInView", () => {
  it("sees a button inside the viewport", () => {
    expect(triggerInView({ top: 300, bottom: 332 }, { height: 900 })).toBe(
      true,
    );
  });

  it("does not see a button under the sticky header or below the viewport", () => {
    expect(triggerInView({ top: 10, bottom: 42 }, { height: 900 })).toBe(false);
    expect(triggerInView({ top: 905, bottom: 937 }, { height: 900 })).toBe(
      false,
    );
  });
});
