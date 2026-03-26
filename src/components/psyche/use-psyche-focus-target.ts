import { useEffect } from "react";

function escapeFocusValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function usePsycheFocusTarget(focusId: string | null) {
  useEffect(() => {
    if (!focusId || typeof document === "undefined") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-psyche-focus-id="${escapeFocusValue(focusId)}"]`);
      if (!target) {
        return;
      }

      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusId]);
}

export function psycheFocusClass(isFocused: boolean) {
  return isFocused
    ? "border-[rgba(125,211,252,0.28)] bg-[linear-gradient(180deg,rgba(125,211,252,0.14),rgba(255,255,255,0.06))] shadow-[0_24px_60px_rgba(56,189,248,0.14)]"
    : "";
}
