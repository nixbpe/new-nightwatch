import { useCallback, useEffect, useState } from "react";

// Counts down whole seconds so the button can say how long is left; `secondsLeft` is 0 when a resend is allowed.
export function useResendCooldown(durationMs = 60_000) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (until === 0) {
      return;
    }
    const tick = () => {
      const current = Date.now();
      if (current >= until) {
        setUntil(0);
        return;
      }
      setNow(current);
    };
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [until]);

  const start = useCallback(() => {
    const current = Date.now();
    setNow(current);
    setUntil(current + durationMs);
  }, [durationMs]);

  return {
    secondsLeft: until === 0 ? 0 : Math.max(1, Math.ceil((until - now) / 1000)),
    start,
  };
}
