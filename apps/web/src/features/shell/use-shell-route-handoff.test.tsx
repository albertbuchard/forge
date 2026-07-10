import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
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
  it("shows the router outlet immediately without an artificial reveal delay", () => {
    const firstLocation = buildLocation("/overview");
    const secondLocation = buildLocation("/sports");
    const wrapper = createWrapper();
    const overviewOutlet = <div>Overview route</div>;
    const sportsOutlet = <div>Sports route</div>;

    const { result, rerender } = renderHook(
      (props: {
        routePathKey: string;
        routerLocation: Location;
        outlet: ReactNode;
        optimisticLocation: Location | null;
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
          optimisticLocation: null
        },
        wrapper
      }
    );

    rerender({
      routePathKey: "/sports",
      routerLocation: secondLocation,
      outlet: sportsOutlet,
      optimisticLocation: null
    });

    expect(result.current.displayedRoute.key).toBe("/sports");
    expect(result.current.displayedRoute.node).toBe(sportsOutlet);
    expect(result.current.pendingRoute).toBeNull();
    expect(result.current.visibleLocation.pathname).toBe("/sports");
  });

  it("updates shell navigation optimistically without replacing visible content", () => {
    const overviewLocation = buildLocation("/overview");
    const sportsLocation = buildLocation("/sports");
    const wrapper = createWrapper();
    const overviewOutlet = <div>Overview route</div>;

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
          optimisticLocation: sportsLocation
        }),
      { wrapper }
    );

    expect(result.current.displayedRoute.key).toBe("/overview");
    expect(result.current.displayedRoute.node).toBe(overviewOutlet);
    expect(result.current.displayedLocationContext?.location.pathname).toBe(
      "/overview"
    );
    expect(result.current.visibleLocation.pathname).toBe("/sports");
  });
});
