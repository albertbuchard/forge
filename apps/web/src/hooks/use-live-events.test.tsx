import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS,
  useLiveEvents
} from "./use-live-events";

class MockEventSource {
  static instance: MockEventSource | null = null;
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, Set<EventListener>>();

  constructor(public readonly url: string) {
    MockEventSource.instance = this;
    MockEventSource.instances.push(this);
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

  open() {
    this.onopen?.();
  }

  fail() {
    this.onerror?.();
  }
}

function Harness({ enabled = true }: { enabled?: boolean }) {
  useLiveEvents(enabled);
  useEffect(() => undefined, []);
  return null;
}

describe("useLiveEvents", () => {
  const originalEventSource = globalThis.EventSource;

  afterEach(() => {
    vi.useRealTimers();
    globalThis.EventSource = originalEventSource;
    MockEventSource.instance = null;
    MockEventSource.instances = [];
  });

  it("invalidates live queries and reconnects once after the bounded delay", () => {
    vi.useFakeTimers();
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    const view = render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );

    const stream = MockEventSource.instance;
    expect(stream?.url).toBe("/api/v1/events/stream");

    stream?.emit("snapshot");
    stream?.emit("activity");

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["forge-snapshot"]
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-context"]
    });

    stream?.fail();
    expect(stream?.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS - 1);
    expect(MockEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockEventSource.instances).toHaveLength(2);

    view.unmount();
  });

  it("backs off failed retries, resets after opening, and never duplicates a pending retry", () => {
    vi.useFakeTimers();
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );

    const first = MockEventSource.instances[0]!;
    first.fail();
    first.fail();
    vi.advanceTimersByTime(LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(2);

    const second = MockEventSource.instances[1]!;
    second.fail();
    vi.advanceTimersByTime(LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(3);

    const third = MockEventSource.instances[2]!;
    third.open();
    third.fail();
    vi.advanceTimersByTime(LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(4);

    view.unmount();
  });

  it("cancels both an active stream and a pending retry when disabled or unmounted", () => {
    vi.useFakeTimers();
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );

    const first = MockEventSource.instances[0]!;
    first.fail();
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness enabled={false} />
      </QueryClientProvider>
    );
    vi.advanceTimersByTime(LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS * 4);
    expect(MockEventSource.instances).toHaveLength(1);

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness enabled />
      </QueryClientProvider>
    );
    const second = MockEventSource.instances[1]!;
    expect(second.closed).toBe(false);
    view.unmount();
    expect(second.closed).toBe(true);
    vi.advanceTimersByTime(LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS * 4);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("waits for authenticated shell bootstrap before opening the stream", () => {
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Harness enabled={false} />
      </QueryClientProvider>
    );

    expect(MockEventSource.instance).toBeNull();

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness enabled />
      </QueryClientProvider>
    );
    expect(MockEventSource.instance?.url).toBe("/api/v1/events/stream");
  });
});
