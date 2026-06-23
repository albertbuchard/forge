import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit";
import {
  hydrateSelectedUserIds,
  setSelectedUserIds
} from "@/store/slices/shell-slice";
import { writeStoredSelectedUserIds } from "@/features/shell/storage";

export const listenerMiddleware = createListenerMiddleware();

listenerMiddleware.startListening({
  matcher: isAnyOf(hydrateSelectedUserIds, setSelectedUserIds),
  effect: async (action) => {
    if (Array.isArray(action.payload)) {
      writeStoredSelectedUserIds(
        action.payload.filter((entry): entry is string => typeof entry === "string")
      );
    }
  }
});
