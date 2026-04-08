import { combineReducers } from "@reduxjs/toolkit";
import { forgeApi } from "@/store/api/forge-api";
import { shellReducer } from "@/store/slices/shell-slice";

export const rootReducer = combineReducers({
  shell: shellReducer,
  [forgeApi.reducerPath]: forgeApi.reducer
});

export type RootState = ReturnType<typeof rootReducer>;
