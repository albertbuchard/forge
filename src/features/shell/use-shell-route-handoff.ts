import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Location as RouterLocation } from "react-router-dom";
import {
  beginRouteHandoff,
  commitPendingRoute,
  setPendingRouteStatus,
  setRouteReadyToCommit,
  syncDisplayedRouteKey
} from "@/store/slices/shell-slice";
import { useAppDispatch } from "@/store/typed-hooks";

type RouteRenderState = {
  key: string;
  node: ReactNode;
  location: RouterLocation;
};

type PendingRouteRenderState = RouteRenderState & {
  baselineFetching: number;
};

export function useShellRouteHandoff({
  routePathKey,
  routerLocation,
  outlet,
  routerLocationContext,
  externalFetching,
  routeReady
}: {
  routePathKey: string;
  routerLocation: RouterLocation;
  outlet: ReactNode;
  routerLocationContext: any;
  externalFetching: number;
  routeReady: boolean;
}) {
  const dispatch = useAppDispatch();
  const handoffTimerRef = useRef<number | null>(null);
  const previousFetchingRef = useRef(externalFetching);
  const [displayedRoute, setDisplayedRoute] = useState<RouteRenderState>({
    key: routePathKey,
    node: outlet,
    location: routerLocation
  });
  const [pendingRoute, setPendingRoute] = useState<PendingRouteRenderState | null>(
    null
  );

  useEffect(() => {
    dispatch(syncDisplayedRouteKey(displayedRoute.key));
  }, [dispatch, displayedRoute.key]);

  useEffect(() => {
    previousFetchingRef.current = externalFetching;
  }, [externalFetching]);

  useEffect(() => {
    if (routePathKey === displayedRoute.key && pendingRoute === null) {
      setDisplayedRoute((current) =>
        current.node === outlet && current.location === routerLocation
          ? current
          : {
              ...current,
              node: outlet,
              location: routerLocation
            }
      );
      return;
    }

    if (routePathKey !== displayedRoute.key) {
      dispatch(beginRouteHandoff(routePathKey));
      setPendingRoute((current) => {
        if (current?.key === routePathKey && current.node === outlet) {
          return current;
        }
        return {
          key: routePathKey,
          node: outlet,
          location: routerLocation,
          baselineFetching: previousFetchingRef.current
        };
      });
    }
  }, [dispatch, displayedRoute.key, outlet, pendingRoute, routePathKey, routerLocation]);

  useEffect(() => {
    if (!pendingRoute) {
      dispatch(setPendingRouteStatus("idle"));
      dispatch(setRouteReadyToCommit(false));
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
      return;
    }

    const readyToCommit =
      routeReady && externalFetching <= pendingRoute.baselineFetching;
    dispatch(setPendingRouteStatus(readyToCommit ? "ready" : "loading"));
    dispatch(setRouteReadyToCommit(readyToCommit));

    if (!readyToCommit) {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
      return;
    }

    if (handoffTimerRef.current !== null) {
      return;
    }

    handoffTimerRef.current = window.setTimeout(() => {
      setDisplayedRoute({
        key: pendingRoute.key,
        node: pendingRoute.node,
        location: pendingRoute.location
      });
      setPendingRoute(null);
      dispatch(commitPendingRoute());
      handoffTimerRef.current = null;
    }, 140);

    return () => {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
    };
  }, [dispatch, externalFetching, pendingRoute, routeReady]);

  useEffect(() => {
    return () => {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
      }
    };
  }, []);

  const visibleLocation = pendingRoute ? displayedRoute.location : routerLocation;
  const displayedLocationContext = routerLocationContext
    ? {
        ...routerLocationContext,
        location: displayedRoute.location
      }
    : null;

  return {
    displayedRoute,
    displayedLocationContext,
    pendingRoute,
    visibleLocation
  };
}
