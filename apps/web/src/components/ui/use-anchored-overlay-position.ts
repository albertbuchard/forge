import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type RefObject
} from "react";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type AnchorBounds = {
  left: number;
  top: number;
  bottom: number;
  width: number;
};

export function resolveAnchoredOverlayStyle(input: {
  anchor: AnchorBounds;
  viewportWidth: number;
  viewportHeight: number;
  viewportLeft?: number;
  viewportTop?: number;
  offset: number;
  margin: number;
  preferredMaxHeight: number;
  minHeight: number;
}): CSSProperties {
  const viewportLeft = input.viewportLeft ?? 0;
  const viewportTop = input.viewportTop ?? 0;
  const viewportRight = viewportLeft + input.viewportWidth;
  const viewportBottom = viewportTop + input.viewportHeight;
  const availableWidth = Math.max(0, input.viewportWidth - input.margin * 2);
  const width = Math.min(Math.max(0, input.anchor.width), availableWidth);
  const minLeft = viewportLeft + input.margin;
  const maxLeft = Math.max(minLeft, viewportRight - input.margin - width);
  const left = clamp(input.anchor.left, minLeft, maxLeft);
  const availableBelow = Math.max(
    0,
    viewportBottom - input.anchor.bottom - input.offset - input.margin
  );
  const availableAbove = Math.max(
    0,
    input.anchor.top - viewportTop - input.offset - input.margin
  );
  const placeAbove =
    availableBelow < input.minHeight && availableAbove > availableBelow;
  const availableHeight = placeAbove ? availableAbove : availableBelow;
  const maxHeight = Math.min(input.preferredMaxHeight, availableHeight);
  const minTop = viewportTop + input.margin;
  const maxTop = Math.max(minTop, viewportBottom - input.margin - maxHeight);
  const requestedTop = placeAbove
    ? input.anchor.top - input.offset - maxHeight
    : input.anchor.bottom + input.offset;
  const top = clamp(requestedTop, minTop, maxTop);

  return {
    position: "fixed",
    left,
    top,
    width,
    maxHeight
  };
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
    setStyle(
      resolveAnchoredOverlayStyle({
        anchor: rect,
        viewportWidth,
        viewportHeight,
        viewportLeft,
        viewportTop,
        offset,
        margin,
        preferredMaxHeight,
        minHeight
      })
    );
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
