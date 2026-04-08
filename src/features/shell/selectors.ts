import { createSelector } from "@reduxjs/toolkit";
import { forgeApi } from "@/store/api/forge-api";
import type { RootState } from "@/store/root-reducer";

export const selectShellState = (state: RootState) => state.shell;

export const selectSelectedUserIds = createSelector(
  selectShellState,
  (shell) => shell.selectedUserIds
);

export const selectCollapseProgress = createSelector(
  selectShellState,
  (shell) => shell.collapseProgress
);

export const selectRouteHandoffState = createSelector(
  selectShellState,
  (shell) => ({
    displayedRouteKey: shell.displayedRouteKey,
    pendingRouteKey: shell.pendingRouteKey,
    pendingRouteStatus: shell.pendingRouteStatus,
    routeReadyToCommit: shell.routeReadyToCommit
  })
);

export const selectPendingRtkRequestCount = createSelector(
  (state: RootState) => state[forgeApi.reducerPath],
  (apiState) => {
    const queryCount = Object.values(apiState.queries).filter(
      (entry) => entry?.status === "pending"
    ).length;
    const mutationCount = Object.values(apiState.mutations).filter(
      (entry) => entry?.status === "pending"
    ).length;
    return queryCount + mutationCount;
  }
);
