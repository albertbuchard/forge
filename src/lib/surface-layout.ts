export type SurfaceLayoutItem = {
  id: string;
  width: number;
  height: number;
  hidden?: boolean;
};

const STORAGE_PREFIX = "forge.surface-layout";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function sanitizeItem(item: SurfaceLayoutItem): SurfaceLayoutItem | null {
  if (!item || typeof item.id !== "string" || item.id.trim().length === 0) {
    return null;
  }

  return {
    id: item.id,
    width: clamp(Number(item.width) || 4, 2, 12),
    height: clamp(Number(item.height) || 2, 1, 6),
    hidden: Boolean(item.hidden)
  };
}

export function readSurfaceLayout(
  surfaceId: string,
  defaults: SurfaceLayoutItem[]
) {
  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}.${surfaceId}`);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return defaults;
    }

    const saved = parsed
      .map((entry) => sanitizeItem(entry as SurfaceLayoutItem))
      .filter((entry): entry is SurfaceLayoutItem => entry !== null);

    const savedById = new Map(saved.map((entry) => [entry.id, entry]));
    const merged: SurfaceLayoutItem[] = [];

    for (const fallback of defaults) {
      merged.push(savedById.get(fallback.id) ?? fallback);
      savedById.delete(fallback.id);
    }

    for (const leftover of savedById.values()) {
      merged.push(leftover);
    }

    return merged;
  } catch {
    return defaults;
  }
}

export function writeSurfaceLayout(
  surfaceId: string,
  layout: SurfaceLayoutItem[]
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}.${surfaceId}`,
      JSON.stringify(layout)
    );
  } catch {
    return;
  }
}

export function mergeSurfaceLayout(
  layout: SurfaceLayoutItem[],
  defaults: SurfaceLayoutItem[]
) {
  const knownIds = new Set(defaults.map((item) => item.id));
  const nextLayout = layout.filter((item) => knownIds.has(item.id));
  const missing = defaults.filter(
    (item) => !nextLayout.some((entry) => entry.id === item.id)
  );
  return [...nextLayout, ...missing];
}
