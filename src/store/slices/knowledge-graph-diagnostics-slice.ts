import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  KNOWLEDGE_GRAPH_EVENT_RING_LIMIT,
  KNOWLEDGE_GRAPH_SNAPSHOT_RING_LIMIT,
  type KnowledgeGraphDiagnosticsEvent,
  type KnowledgeGraphDiagnosticsSnapshot,
  type KnowledgeGraphDiagnosticsStatus
} from "@/lib/knowledge-graph-dev-diagnostics";

export interface KnowledgeGraphDiagnosticsState {
  panelOpen: boolean;
  latestStatus: KnowledgeGraphDiagnosticsStatus | null;
  recentEvents: KnowledgeGraphDiagnosticsEvent[];
  recentSnapshots: KnowledgeGraphDiagnosticsSnapshot[];
}

const initialState: KnowledgeGraphDiagnosticsState = {
  panelOpen: false,
  latestStatus: null,
  recentEvents: [],
  recentSnapshots: []
};

function appendBounded<T>(items: T[], next: T, limit: number) {
  const appended = [next, ...items];
  if (appended.length <= limit) {
    return appended;
  }
  return appended.slice(0, limit);
}

const knowledgeGraphDiagnosticsSlice = createSlice({
  name: "knowledgeGraphDiagnostics",
  initialState,
  reducers: {
    setKnowledgeGraphDiagnosticsPanelOpen(
      state,
      action: PayloadAction<boolean>
    ) {
      state.panelOpen = action.payload;
    },
    setKnowledgeGraphDiagnosticsStatus(
      state,
      action: PayloadAction<KnowledgeGraphDiagnosticsStatus | null>
    ) {
      state.latestStatus = action.payload;
    },
    recordKnowledgeGraphDiagnosticsEvent(
      state,
      action: PayloadAction<KnowledgeGraphDiagnosticsEvent>
    ) {
      state.recentEvents = appendBounded(
        state.recentEvents,
        action.payload,
        KNOWLEDGE_GRAPH_EVENT_RING_LIMIT
      );
    },
    recordKnowledgeGraphDiagnosticsSnapshot(
      state,
      action: PayloadAction<KnowledgeGraphDiagnosticsSnapshot>
    ) {
      state.recentSnapshots = appendBounded(
        state.recentSnapshots,
        action.payload,
        KNOWLEDGE_GRAPH_SNAPSHOT_RING_LIMIT
      );
    },
    resetKnowledgeGraphDiagnostics(state) {
      state.latestStatus = null;
      state.recentEvents = [];
      state.recentSnapshots = [];
      state.panelOpen = false;
    }
  }
});

export const {
  recordKnowledgeGraphDiagnosticsEvent,
  recordKnowledgeGraphDiagnosticsSnapshot,
  resetKnowledgeGraphDiagnostics,
  setKnowledgeGraphDiagnosticsPanelOpen,
  setKnowledgeGraphDiagnosticsStatus
} = knowledgeGraphDiagnosticsSlice.actions;

export const knowledgeGraphDiagnosticsReducer =
  knowledgeGraphDiagnosticsSlice.reducer;
