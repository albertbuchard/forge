import { useEffect, useState } from "react";

export function useDelayedFlag(active: boolean, delayMs = 800) {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }

    const timeout = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [active, delayMs]);

  return delayed;
}
