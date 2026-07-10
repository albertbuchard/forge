import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationType, type Location } from "react-router-dom";
import { createAppStore } from "@/store/store";
import { useShellRouteHandoff } from "@/features/shell/use-shell-route-handoff";

function buildLocation(pathname: string): Location {
  return {
    pathname,
    search: "",
    hash: "",
    state: null,
    key: pathname,
    mask: undefined
  };
}

function createWrapper() {
  const store = createAppStore();
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
}

describe("useShellRouteHandoff", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the clicked route loading surface before a lazy outlet resolves", () => {
    vi.useFakeTimers();
    const firstLocation = buildLocation("/overview");
    const secondLocation = buildLocation("/sports");
    const wrapper = createWrapper();
    const overviewOutlet = <div>Overview route</div>;
    const sportsOutlet = <div>Sports route</div>;
    const sportsLoading = <div>Opening Sports</div>;

    const { result, rerender } = renderHook(
      (props: {
        routePathKey: string;
        routerLocation: Location;
        outlet: ReactNode;
        externalFetching: number;
        routeReady: boolean;
        destinationLoadingNode: ReactNode;
        optimisticLocation: Location | null;
        optimisticRoutePathKey: string | null;
      }) =>
        useShellRouteHandoff({
          ...props,
          routerLocationContext: {
            location: props.routerLocation,
            navigationType: NavigationType.Push
          }
        }),
      {
        initialProps: {
          routePathKey: "/overview",
          routerLocation: firstLocation,
          outlet: overviewOutlet,
          externalFetching: 0,
          routeReady: true,
          destinationLoadingNode: <div>Opening Overview</div>,
          optimisticLocation: null,
          optimisticRoutePathKey: null
        },
        wrapper
      }
    );

    rerender({
      routePathKey: "/sports",
      routerLocation: secondLocation,
      outlet: overviewOutlet,
      externalFetching: 1,
      routeReady: false,
      destinationLoadingNode: sportsLoading,
      optimisticLocation: null,
      optimisticRoutePathKey: null
    });

    expect(result.current.displayedRoute.key).toBe("/sports");
    expect(result.current.displayedRoute.node).toBe(sportsLoading);
    expect(result.current.pendingRoute).toBeNull();
    expect(result.current.visibleLocation.pathname).toBe("/sports");

    act(() => {
      vi.advanceTimersByTime(120);
    });

    rerender({
      routePathKey: "/sports",
      routerLocation: secondLocation,
      outlet: sportsOutlet,
      externalFetching: 0,
      routeReady: true,
      destinationLoadingNode: sportsLoading,
      optimisticLocation: null,
      optimisticRoutePathKey: null
    });

    expect(result.current.displayedRoute.node).toBe(sportsOutlet);
  });

  it("uses an optimistic nav destination before router state catches up", () => {
    const overviewLocation = buildLocation("/overview");
    const sportsLocation = buildLocation("/sports");
    const wrapper = createWrapper();
    const overviewOutlet = <div>Overview route</div>;
    const sportsLoading = <div>Opening Sports</div>;

    const { result } = renderHook(
      () =>
        useShellRouteHandoff({
          routePathKey: "/overview",
          routerLocation: overviewLocation,
          outlet: overviewOutlet,
          routerLocationContext: {
            location: overviewLocation,
            navigationType: NavigationType.Push
          },
          externalFetching: 0,
          routeReady: true,
          destinationLoadingNode: sportsLoading,
          optimisticLocation: sportsLocation,
          optimisticRoutePathKey: "/sports"
        }),
      { wrapper }
    );

    expect(result.current.displayedRoute.key).toBe("/sports");
    expect(result.current.displayedRoute.node).toBe(sportsLoading);
    expect(result.current.visibleLocation.pathname).toBe("/sports");
  });
});
