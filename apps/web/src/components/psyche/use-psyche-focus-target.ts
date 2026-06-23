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
    ? "border-[color-mix(in_srgb,var(--info)_34%,var(--ui-border-subtle)_66%)] bg-[color-mix(in_srgb,var(--info)_12%,var(--ui-surface-1)_88%)] shadow-[var(--ui-shadow-soft)]"
    : "";
}
