import { QueryClient } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { getOrCreateForgeRuntime, type ForgeRuntimeHost } from "./app-runtime";

describe("Forge app runtime", () => {
  it("reuses the query client and React root when the entrypoint reloads", () => {
    const host: ForgeRuntimeHost = {};
    const rootElement = document.createElement("div");
    const queryClient = new QueryClient();
    const reactRoot = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
    const createQueryClient = vi.fn(() => queryClient);
    const createRoot = vi.fn(() => reactRoot);

    const first = getOrCreateForgeRuntime(host, rootElement, {
      createQueryClient,
      createRoot
    });
    const second = getOrCreateForgeRuntime(host, rootElement, {
      createQueryClient,
      createRoot
    });

    expect(first).toEqual({ queryClient, reactRoot });
    expect(second).toEqual(first);
    expect(createQueryClient).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledTimes(1);
  });

  it("creates a new React root when the document root element changes", () => {
    const host: ForgeRuntimeHost = {};
    const queryClient = new QueryClient();
    const firstRoot = {} as Root;
    const secondRoot = {} as Root;
    const createRoot = vi
      .fn<(element: HTMLElement) => Root>()
      .mockReturnValueOnce(firstRoot)
      .mockReturnValueOnce(secondRoot);

    const first = getOrCreateForgeRuntime(host, document.createElement("div"), {
      createQueryClient: () => queryClient,
      createRoot
    });
    const second = getOrCreateForgeRuntime(
      host,
      document.createElement("div"),
      { createQueryClient: () => queryClient, createRoot }
    );

    expect(first.queryClient).toBe(second.queryClient);
    expect(first.reactRoot).toBe(firstRoot);
    expect(second.reactRoot).toBe(secondRoot);
    expect(createRoot).toHaveBeenCalledTimes(2);
  });
});
