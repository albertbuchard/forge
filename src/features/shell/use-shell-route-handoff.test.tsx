import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";
import type { Location } from "react-router-dom";
import { createAppStore } from "@/store/store";
import { useShellRouteHandoff } from "@/features/shell/use-shell-route-handoff";

function buildLocation(pathname: string): Location {
  return {
    pathname,
    search: "",
    hash: "",
    state: null,
    key: pathname,
    unstable_mask: undefined
  };
}

function createWrapper() {
  const store = createAppStore();
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
}

describe("useShellRouteHandoff", () => {
  it("keeps the current route mounted until the pending route is ready", () => {
    vi.useFakeTimers();

    const firstLocation = buildLocation("/overview");
    const secondLocation = buildLocation("/goals");
    const wrapper = createWrapper();

    const { result, rerender } = renderHook(
      (props: {
        routePathKey: string;
        routerLocation: Location;
        outlet: ReactNode;
        externalFetching: number;
        routeReady: boolean;
      }) =>
        useShellRouteHandoff({
          ...props,
          routerLocationContext: {
            location: props.routerLocation,
            navigationType: "PUSH"
          }
        }),
      {
        initialProps: {
          routePathKey: "/overview",
          routerLocation: firstLocation,
          outlet: <div>Overview route</div>,
          externalFetching: 0,
          routeReady: true
        },
        wrapper
      }
    );

    rerender({
      routePathKey: "/goals",
      routerLocation: secondLocation,
      outlet: <div>Goals route</div>,
      externalFetching: 1,
      routeReady: false
    });

    expect(result.current.displayedRoute.key).toBe("/overview");
    expect(result.current.pendingRoute?.key).toBe("/goals");
    expect(result.current.visibleLocation.pathname).toBe("/overview");

    rerender({
      routePathKey: "/goals",
      routerLocation: secondLocation,
      outlet: <div>Goals route</div>,
      externalFetching: 0,
      routeReady: true
    });

    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(result.current.displayedRoute.key).toBe("/goals");
    expect(result.current.pendingRoute).toBeNull();
    expect(result.current.visibleLocation.pathname).toBe("/goals");

    vi.useRealTimers();
  });
});
