import { combineReducers } from "@reduxjs/toolkit";
import { forgeApi } from "@/store/api/forge-api";
import { knowledgeGraphDiagnosticsReducer } from "@/store/slices/knowledge-graph-diagnostics-slice";
import { shellReducer } from "@/store/slices/shell-slice";

export const rootReducer = combineReducers({
  shell: shellReducer,
  knowledgeGraphDiagnostics: knowledgeGraphDiagnosticsReducer,
  [forgeApi.reducerPath]: forgeApi.reducer
});

export type RootState = ReturnType<typeof rootReducer>;
