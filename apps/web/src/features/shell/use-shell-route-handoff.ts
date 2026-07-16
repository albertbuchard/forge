import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  type ContextType,
  type ReactNode
} from "react";
import {
  UNSAFE_LocationContext,
  type Location as RouterLocation
} from "react-router-dom";
import {
  beginRouteHandoff,
  commitPendingRoute,
  syncDisplayedRouteKey
} from "@/store/slices/shell-slice";
import { useAppDispatch } from "@/store/typed-hooks";

type RouteRenderState = {
  key: string;
  node: ReactNode;
  location: RouterLocation;
};

type RouterLocationContext = ContextType<typeof UNSAFE_LocationContext>;

export function useShellRouteHandoff({
  routePathKey,
  routerLocation,
  outlet,
  routerLocationContext,
  optimisticLocation
}: {
  routePathKey: string;
  routerLocation: RouterLocation;
  outlet: ReactNode;
  routerLocationContext: RouterLocationContext;
  optimisticLocation: RouterLocation | null;
}) {
  const dispatch = useAppDispatch();
  const previousRoutePathKeyRef = useRef(routePathKey);
  const visibleRouterLocation = optimisticLocation ?? routerLocation;
  const currentRoute = useMemo<RouteRenderState>(
    () => ({
      key: routePathKey,
      node: outlet,
      location: routerLocation
    }),
    [outlet, routePathKey, routerLocation]
  );
  const displayedRouteRef = useRef<RouteRenderState>(currentRoute);
  if (outlet !== null) {
    displayedRouteRef.current = currentRoute;
  }
  const displayedRoute = useDeferredValue(displayedRouteRef.current);

  useEffect(() => {
    if (previousRoutePathKeyRef.current !== routePathKey) {
      dispatch(beginRouteHandoff(routePathKey));
      dispatch(commitPendingRoute());
      previousRoutePathKeyRef.current = routePathKey;
    }
    dispatch(syncDisplayedRouteKey(routePathKey));
  }, [dispatch, routePathKey]);

  const displayedLocationContext = routerLocationContext
    ? {
        ...routerLocationContext,
        location: displayedRoute.location
      }
    : null;

  return {
    displayedRoute,
    displayedLocationContext,
    pendingRoute: null,
    visibleLocation: visibleRouterLocation
  };
}
