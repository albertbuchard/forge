import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ForgeApiError } from "./api-error";
import {
  createForgeQueryClient,
  getOrCreateForgeRuntime,
  shouldRetryForgeQuery,
  type ForgeRuntimeHost
} from "./app-runtime";

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

  it("never retries terminal API failures or aborted navigation", () => {
    for (const status of [401, 403, 404, 409]) {
      expect(
        shouldRetryForgeQuery(
          0,
          new ForgeApiError({
            status,
            code: "terminal",
            message: "Terminal request failure.",
            requestPath: "/api/v1/example"
          })
        )
      ).toBe(false);
    }
    expect(
      shouldRetryForgeQuery(0, new DOMException("Canceled", "AbortError"))
    ).toBe(false);
  });

  it("bounds network and server retries to two after the first attempt", () => {
    for (const error of [
      new TypeError("Network unavailable"),
      new ForgeApiError({
        status: 503,
        code: "temporarily_unavailable",
        message: "Try later.",
        requestPath: "/api/v1/example"
      })
    ]) {
      expect(shouldRetryForgeQuery(0, error)).toBe(true);
      expect(shouldRetryForgeQuery(1, error)).toBe(true);
      expect(shouldRetryForgeQuery(2, error)).toBe(false);
    }
  });

  it("aborts a delayed route query when its observer moves to another lesson", async () => {
    const queryClient = createForgeQueryClient();
    let firstSignal: AbortSignal | null = null;
    const firstQuery = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          firstSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          });
        })
    );
    const secondQuery = vi.fn().mockResolvedValue("lesson-b");
    const observer = new QueryObserver(queryClient, {
      queryKey: ["course-lesson", "lesson-a"],
      queryFn: firstQuery
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => expect(firstQuery).toHaveBeenCalledOnce());
    observer.setOptions({
      queryKey: ["course-lesson", "lesson-b"],
      queryFn: secondQuery
    });

    await vi.waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
      expect(secondQuery).toHaveBeenCalledOnce();
      expect(observer.getCurrentResult().data).toBe("lesson-b");
    });
    expect(firstQuery).toHaveBeenCalledOnce();
    unsubscribe();
    queryClient.clear();
  });
});
