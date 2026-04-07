import { useEffect, useState } from "react";

export type SurfaceMode = "default" | "custom";

function storageKey(surfaceId: string) {
  return `forge.surface-mode.${surfaceId}`;
}

export function readSurfaceMode(surfaceId: string): SurfaceMode {
  if (typeof window === "undefined") {
    return "default";
  }
  const value = window.localStorage.getItem(storageKey(surfaceId));
  return value === "custom" ? "custom" : "default";
}

export function useSurfaceMode(surfaceId: string) {
  const [mode, setMode] = useState<SurfaceMode>(() =>
    readSurfaceMode(surfaceId)
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey(surfaceId), mode);
  }, [mode, surfaceId]);

  return { mode, setMode };
}
