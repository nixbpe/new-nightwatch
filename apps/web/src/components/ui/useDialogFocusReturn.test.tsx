import { cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDialogFocusReturn } from "./useDialogFocusReturn";

const roots: HTMLElement[] = [];

afterEach(() => {
  cleanup();
  for (const root of roots) root.remove();
  roots.length = 0;
  vi.restoreAllMocks();
});

function fixture() {
  const root = document.createElement("div");
  const dialog = createRef<HTMLElement>();
  const initialFocus = createRef<HTMLElement>();
  const fallbackFocus = createRef<HTMLElement>();
  dialog.current = document.createElement("div");
  initialFocus.current = document.createElement("input");
  fallbackFocus.current = document.createElement("button");
  const otherControl = document.createElement("input");
  const opener = document.createElement("button");
  const outside = document.createElement("button");
  dialog.current.append(initialFocus.current, otherControl);
  root.append(dialog.current, opener, fallbackFocus.current, outside);
  document.body.append(root);
  roots.push(root);
  return { dialog, initialFocus, fallbackFocus, otherControl, opener, outside };
}

describe("useDialogFocusReturn", () => {
  it("focuses the initial control and leaves other controls inside alone", () => {
    const f = fixture();
    renderHook(() => {
      useDialogFocusReturn(f.dialog, f.initialFocus, f.opener, f.fallbackFocus);
    });
    expect(f.initialFocus.current).toHaveFocus();
    f.otherControl.focus();
    expect(f.otherControl).toHaveFocus();
  });

  it("contains escaped focus using the current dialog and initial-control refs", () => {
    const f = fixture();
    renderHook(() => {
      useDialogFocusReturn(f.dialog, f.initialFocus, f.opener, f.fallbackFocus);
    });
    f.outside.focus();
    expect(f.initialFocus.current).toHaveFocus();

    const replacement = document.createElement("div");
    const input = document.createElement("input");
    replacement.append(input);
    f.outside.after(replacement);
    f.dialog.current = replacement;
    f.initialFocus.current = input;
    input.focus();
    expect(input).toHaveFocus();
    f.otherControl.focus();
    expect(input).toHaveFocus();
  });

  it("checks opener connectivity at cleanup and returns to a connected opener", () => {
    const f = fixture();
    f.opener.remove();
    const { unmount } = renderHook(() => {
      useDialogFocusReturn(f.dialog, f.initialFocus, f.opener, f.fallbackFocus);
    });
    f.outside.after(f.opener);
    unmount();
    expect(f.opener).toHaveFocus();
  });

  it("returns to the fallback when the opener disconnects while open", () => {
    const f = fixture();
    const { unmount } = renderHook(() => {
      useDialogFocusReturn(f.dialog, f.initialFocus, f.opener, f.fallbackFocus);
    });
    f.opener.remove();
    unmount();
    expect(f.fallbackFocus.current).toHaveFocus();
  });

  it.each(["cleared", "replaced"])(
    "keeps the mount fallback snapshot when its ref is %s",
    (change) => {
      const f = fixture();
      const fallback = f.fallbackFocus.current;
      const { unmount } = renderHook(() => {
        useDialogFocusReturn(f.dialog, f.initialFocus, null, f.fallbackFocus);
      });
      f.fallbackFocus.current = change === "cleared" ? null : f.outside;
      unmount();
      expect(fallback).toHaveFocus();
    },
  );

  it("does not refocus, return focus or reinstall listeners on ordinary rerenders", () => {
    const f = fixture();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const returnFocus = vi.spyOn(f.opener, "focus");
    const { rerender } = renderHook(() => {
      useDialogFocusReturn(f.dialog, f.initialFocus, f.opener, f.fallbackFocus);
    });
    f.otherControl.focus();
    rerender();
    expect(f.otherControl).toHaveFocus();
    expect(returnFocus).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === "focusin")).toHaveLength(
      1,
    );
    expect(
      remove.mock.calls.filter(([type]) => type === "focusin"),
    ).toHaveLength(0);
  });

  it("removes the same listener before returning focus and stops containing after unmount", () => {
    const f = fixture();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const returnFocus = vi.spyOn(f.opener, "focus");
    const { unmount } = renderHook(() => {
      useDialogFocusReturn(f.dialog, f.initialFocus, f.opener, f.fallbackFocus);
    });
    const listener = add.mock.calls.find(([type]) => type === "focusin")?.[1];
    expect(listener).toBeTypeOf("function");
    unmount();
    expect(remove).toHaveBeenCalledWith("focusin", listener);
    expect(returnFocus).toHaveBeenCalledOnce();
    expect(f.opener).toHaveFocus();
    f.outside.focus();
    expect(f.outside).toHaveFocus();
    const removalIndex = remove.mock.calls.findIndex(
      ([type]) => type === "focusin",
    );
    expect(remove.mock.invocationCallOrder[removalIndex]).toBeLessThan(
      returnFocus.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
