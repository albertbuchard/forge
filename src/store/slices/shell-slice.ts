import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { readStoredSelectedUserIds } from "@/features/shell/storage";

export type PendingRouteStatus = "idle" | "loading" | "ready";

export interface ShellState {
  collapseProgress: number;
  selectedUserIds: string[];
  displayedRouteKey: string;
  pendingRouteKey: string | null;
  pendingRouteStatus: PendingRouteStatus;
  routeReadyToCommit: boolean;
}

const initialState: ShellState = {
  collapseProgress: 0,
  selectedUserIds: readStoredSelectedUserIds(),
  displayedRouteKey: "",
  pendingRouteKey: null,
  pendingRouteStatus: "idle",
  routeReadyToCommit: false
};

const shellSlice = createSlice({
  name: "shell",
  initialState,
  reducers: {
    hydrateSelectedUserIds(state, action: PayloadAction<string[]>) {
      state.selectedUserIds = action.payload;
    },
    setSelectedUserIds(state, action: PayloadAction<string[]>) {
      state.selectedUserIds = action.payload;
    },
    setCollapseProgress(state, action: PayloadAction<number>) {
      state.collapseProgress = action.payload;
    },
    syncDisplayedRouteKey(state, action: PayloadAction<string>) {
      state.displayedRouteKey = action.payload;
      state.pendingRouteKey = null;
      state.pendingRouteStatus = "idle";
      state.routeReadyToCommit = false;
    },
    beginRouteHandoff(state, action: PayloadAction<string>) {
      if (state.displayedRouteKey === action.payload) {
        state.pendingRouteKey = null;
        state.pendingRouteStatus = "idle";
        state.routeReadyToCommit = false;
        return;
      }
      state.pendingRouteKey = action.payload;
      state.pendingRouteStatus = "loading";
      state.routeReadyToCommit = false;
    },
    setPendingRouteStatus(state, action: PayloadAction<PendingRouteStatus>) {
      state.pendingRouteStatus = action.payload;
    },
    setRouteReadyToCommit(state, action: PayloadAction<boolean>) {
      state.routeReadyToCommit = action.payload;
    },
    commitPendingRoute(state) {
      if (!state.pendingRouteKey) {
        return;
      }
      state.displayedRouteKey = state.pendingRouteKey;
      state.pendingRouteKey = null;
      state.pendingRouteStatus = "idle";
      state.routeReadyToCommit = false;
    },
    cancelPendingRoute(state) {
      state.pendingRouteKey = null;
      state.pendingRouteStatus = "idle";
      state.routeReadyToCommit = false;
    }
  }
});

export const {
  beginRouteHandoff,
  cancelPendingRoute,
  commitPendingRoute,
  hydrateSelectedUserIds,
  setCollapseProgress,
  setPendingRouteStatus,
  setRouteReadyToCommit,
  setSelectedUserIds,
  syncDisplayedRouteKey
} = shellSlice.actions;

export const shellReducer = shellSlice.reducer;
