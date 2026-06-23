import { useEffect, useRef } from "react";
import { recordSessionEvent } from "@/lib/api";

export function useShellSessionTelemetry(enabled: boolean) {
  const sessionIdRef = useRef(
    `forge_session_${Math.random().toString(36).slice(2, 10)}`
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let interacted = false;
    let dwellSent = false;
    let scrollSent = false;

    const markInteraction = () => {
      interacted = true;
    };

    const sendEvent = (
      eventType: string,
      metrics: Record<string, string | number | boolean | null>
    ) =>
      recordSessionEvent({
        sessionId: sessionIdRef.current,
        eventType,
        metrics
      }).catch(() => undefined);

    void sendEvent("session_started", {
      visible: document.visibilityState === "visible",
      interacted: false
    });

    const dwellTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible" && interacted && !dwellSent) {
        dwellSent = true;
        void sendEvent("dwell_120_seconds", {
          visible: true,
          interacted: true
        });
      }
    }, 120_000);

    const onScroll = () => {
      const denominator = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const progress = Math.round((window.scrollY / denominator) * 100);
      if (progress >= 75 && interacted && !scrollSent) {
        scrollSent = true;
        void sendEvent("scroll_depth_75", {
          visible: document.visibilityState === "visible",
          interacted: true,
          scrollDepth: progress
        });
      }
    };

    window.addEventListener("pointerdown", markInteraction);
    window.addEventListener("keydown", markInteraction);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.clearTimeout(dwellTimer);
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      window.removeEventListener("scroll", onScroll);
    };
  }, [enabled]);
}
