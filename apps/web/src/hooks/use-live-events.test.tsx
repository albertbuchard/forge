import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveEvents } from "./use-live-events";

class MockEventSource {
  static instance: MockEventSource | null = null;

  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, Set<EventListener>>();

  constructor(public readonly url: string) {
    MockEventSource.instance = this;
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener(new Event(type)));
  }
}

function Harness() {
  useLiveEvents();
  useEffect(() => undefined, []);
  return null;
}

describe("useLiveEvents", () => {
  const originalEventSource = globalThis.EventSource;

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    MockEventSource.instance = null;
  });

  it("invalidates snapshot and task-context queries on live events and closes on error", () => {
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

    const view = render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );

    const stream = MockEventSource.instance;
    expect(stream?.url).toBe("/api/v1/events/stream");

    stream?.emit("snapshot");
    stream?.emit("activity");

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["forge-snapshot"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["task-context"] });

    stream?.onerror?.();
    expect(stream?.closed).toBe(true);

    view.unmount();
  });
});
