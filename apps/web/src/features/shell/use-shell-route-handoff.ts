import {
  useEffect,
  useRef,
  useState,
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
  optimisticLocation,
  optimisticRoutePathKey,
  destinationLoadingNode
}: {
  routePathKey: string;
  routerLocation: RouterLocation;
  outlet: ReactNode;
  routerLocationContext: RouterLocationContext;
  externalFetching: number;
  routeReady: boolean;
  destinationLoadingNode: ReactNode;
  optimisticLocation: RouterLocation | null;
  optimisticRoutePathKey: string | null;
}) {
  const dispatch = useAppDispatch();
  const previousRoutePathKeyRef = useRef(routePathKey);
  const [outletRevealKey, setOutletRevealKey] = useState(routePathKey);
  const visibleRoutePathKey = optimisticRoutePathKey ?? routePathKey;
  const visibleRouterLocation = optimisticLocation ?? routerLocation;
  const routeAwaitingReveal =
    optimisticRoutePathKey !== null || outletRevealKey !== routePathKey;

  useEffect(() => {
    if (optimisticRoutePathKey !== null || outletRevealKey === routePathKey) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setOutletRevealKey(routePathKey);
    }, 120);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [optimisticRoutePathKey, outletRevealKey, routePathKey]);

  const displayedRoute: RouteRenderState = {
    key: visibleRoutePathKey,
    node: routeAwaitingReveal ? destinationLoadingNode : outlet,
    location: visibleRouterLocation
  };

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
