import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from "react";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useAnchoredOverlayPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  options?: {
    offset?: number;
    margin?: number;
    preferredMaxHeight?: number;
    minHeight?: number;
  }
) {
  const offset = options?.offset ?? 8;
  const margin = options?.margin ?? 12;
  const preferredMaxHeight = options?.preferredMaxHeight ?? 320;
  const minHeight = options?.minHeight ?? 160;
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") {
      setStyle(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const width = Math.min(rect.width, viewportWidth - margin * 2);
    const maxLeft = viewportLeft + viewportWidth - margin - width;
    const left = clamp(rect.left, viewportLeft + margin, maxLeft);
    const availableBelow =
      viewportTop + viewportHeight - rect.bottom - offset - margin;
    const availableAbove = rect.top - viewportTop - offset - margin;
    const placeAbove =
      availableBelow < minHeight && availableAbove > availableBelow;
    const availableHeight = Math.max(
      minHeight,
      placeAbove ? availableAbove : availableBelow
    );
    const maxHeight = Math.min(preferredMaxHeight, availableHeight);
    const top = placeAbove
      ? Math.max(viewportTop + margin, rect.top - offset - maxHeight)
      : rect.bottom + offset;

    setStyle({
      position: "fixed",
      left,
      top,
      width,
      maxHeight
    });
  }, [anchorRef, margin, minHeight, offset, preferredMaxHeight]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      setStyle(null);
      return;
    }

    let frame = 0;
    const scheduleUpdate = () => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updatePosition();
      });
    };

    updatePosition();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    visualViewport?.addEventListener("resize", scheduleUpdate);
    visualViewport?.addEventListener("scroll", scheduleUpdate);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      visualViewport?.removeEventListener("resize", scheduleUpdate);
      visualViewport?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [open, updatePosition]);

  return style;
}
