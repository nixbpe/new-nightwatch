import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const EDGE = 8;

/**
 * A short text that opens on hover, keyboard focus (Tab) and touch, and closes on Escape,
 * blur, leaving and a touch elsewhere. The control it wraps keeps its own accessible name
 * (the same text as `aria-label`), so the bubble is hidden from assistive technology
 * instead of being read twice. The bubble's padding touches its anchor, so the pointer can
 * move onto it without closing it (WCAG 1.4.13). It is drawn in a portal at fixed coordinates because a table
 * scrolls inside its own container and would clip it. The surface is Surface with Text and a
 * hairline edge: the design system has no darker tooltip token.
 */
export function Tooltip({
  label,
  children,
  wide = false,
  "data-testid": testId,
}: {
  label: string;
  children: ReactNode;
  /** Long explanations wrap at 280 px; a short label stays on one line. */
  wide?: boolean;
  "data-testid"?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || anchor.current === null || bubble.current === null) {
      setPlace(null);
      return;
    }
    const target = anchor.current.getBoundingClientRect();
    const size = bubble.current.getBoundingClientRect();
    const below = target.top - size.height < EDGE;
    const centered = target.left + target.width / 2 - size.width / 2;
    setPlace({
      below,
      left: Math.max(
        EDGE,
        Math.min(centered, window.innerWidth - size.width - EDGE),
      ),
      top: below ? target.bottom : target.top - size.height,
    });
  }, [open, label]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        anchor.current?.contains(event.target) === false
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("pointerdown", away);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      // The first Escape closes the tooltip only, not the dialog around it.
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <span
      ref={anchor}
      className="inline-flex"
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      onFocus={(event) => {
        // Focus that a script gives back after a mouse click (a closed dialog's opener) is
        // not a keyboard visit, so it does not open the tooltip.
        if (event.target.matches(":focus-visible")) setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") setOpen(true);
      }}
      onKeyDown={onKeyDown}
    >
      {children}
      {open
        ? createPortal(
            <span
              ref={bubble}
              id={id}
              data-testid={testId ?? "tooltip"}
              data-placement={place?.below === true ? "below" : "above"}
              aria-hidden="true"
              style={{
                position: "fixed",
                left: place?.left ?? 0,
                top: place?.top ?? 0,
                visibility: place === null ? "hidden" : "visible",
              }}
              className={`z-[60] ${place?.below === true ? "pt-2" : "pb-2"}`}
            >
              <span
                className={`block rounded-md border border-foreground/10 bg-surface px-2 py-1 text-xs leading-relaxed text-foreground ${wide ? "w-max max-w-[280px]" : "whitespace-nowrap"}`}
              >
                {label}
              </span>
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
