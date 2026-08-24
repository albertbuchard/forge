import { describe, expect, it, vi } from "vitest";

import { installVitePreloadRecovery } from "@/lib/vite-preload-recovery";

function recoveryTarget() {
  const events = new EventTarget();
  const values = new Map<string, string>();
  const reload = vi.fn();
  const sessionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    }
  } satisfies Storage;
  const target = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    sessionStorage,
    location: { reload }
  } as unknown as Window;
  return { events, reload, target };
}

describe("Vite preload recovery", () => {
  it("reloads once for a transient module miss and prevents a reload loop", () => {
    const { events, reload, target } = recoveryTarget();
    let now = 1_000;
    const uninstall = installVitePreloadRecovery(target, () => now);

    const firstFailure = new Event("vite:preloadError", {
      cancelable: true
    });
    events.dispatchEvent(firstFailure);
    expect(firstFailure.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    now += 10_000;
    const repeatedFailure = new Event("vite:preloadError", {
      cancelable: true
    });
    events.dispatchEvent(repeatedFailure);
    expect(repeatedFailure.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    now += 60_000;
    const laterFailure = new Event("vite:preloadError", {
      cancelable: true
    });
    events.dispatchEvent(laterFailure);
    expect(laterFailure.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);

    uninstall();
  });
});
