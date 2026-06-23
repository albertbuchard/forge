import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { forgeApi } from "@/store/api/forge-api";
import { listenerMiddleware } from "@/store/listener-middleware";
import { rootReducer } from "@/store/root-reducer";

export function createAppStore() {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false
      }).concat(listenerMiddleware.middleware, forgeApi.middleware)
  });

  setupListeners(store.dispatch);
  return store;
}

export const appStore = createAppStore();

export type AppStore = typeof appStore;
export type AppDispatch = AppStore["dispatch"];
