import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  close: vi.fn(),
  downloadAndInstall: vi.fn(),
  getVersion: vi.fn(),
  relaunch: vi.fn()
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => mocks.getVersion(...args)
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => mocks.check(...args)
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => mocks.relaunch(...args)
}));

import {
  checkDesktopUpdate,
  installDesktopUpdate
} from "@/lib/desktop-distribution";

describe("signed desktop distribution", () => {
  beforeEach(() => {
    mocks.getVersion.mockResolvedValue("0.3.55");
    mocks.close.mockResolvedValue(undefined);
    mocks.relaunch.mockResolvedValue(undefined);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true
    });
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("reports web, current, available, and unconfigured update states truthfully", async () => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    await expect(checkDesktopUpdate()).resolves.toEqual({ kind: "web" });

    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true
    });
    mocks.check.mockResolvedValueOnce(null);
    await expect(checkDesktopUpdate()).resolves.toEqual({
      kind: "current",
      currentVersion: "0.3.55"
    });

    mocks.check.mockResolvedValueOnce({
      version: "0.3.56",
      date: "2026-08-12T12:00:00.000Z",
      body: "Signed update",
      close: mocks.close
    });
    await expect(checkDesktopUpdate()).resolves.toEqual({
      kind: "available",
      currentVersion: "0.3.55",
      version: "0.3.56",
      date: "2026-08-12T12:00:00.000Z",
      notes: "Signed update"
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);

    mocks.check.mockRejectedValueOnce(new Error("missing signed updater endpoint"));
    await expect(checkDesktopUpdate()).resolves.toEqual({
      kind: "unconfigured",
      currentVersion: "0.3.55",
      message: "missing signed updater endpoint"
    });
  });

  it("rechecks the exact version before install, reports progress, and relaunches only after success", async () => {
    mocks.downloadAndInstall.mockImplementation(
      async (listener: (event: Record<string, unknown>) => void) => {
        listener({ event: "Started", data: { contentLength: 10 } });
        listener({ event: "Progress", data: { chunkLength: 4 } });
        listener({ event: "Progress", data: { chunkLength: 6 } });
      }
    );
    mocks.check.mockResolvedValueOnce({
      version: "0.3.56",
      close: mocks.close,
      downloadAndInstall: mocks.downloadAndInstall
    });
    const progress: Array<[number, number | null]> = [];
    await installDesktopUpdate("0.3.56", (downloaded, total) =>
      progress.push([downloaded, total])
    );
    expect(progress).toEqual([
      [0, 10],
      [4, 10],
      [10, 10]
    ]);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.check.mockResolvedValueOnce({
      version: "0.3.57",
      close: mocks.close
    });
    await expect(installDesktopUpdate("0.3.56", vi.fn())).rejects.toThrow(
      "available update changed"
    );
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});
