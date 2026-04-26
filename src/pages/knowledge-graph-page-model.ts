export function resolveKnowledgeGraphFocusInteraction({
  isMobile,
  currentFocusNodeId,
  nextNodeId
}: {
  isMobile: boolean;
  currentFocusNodeId: string | null;
  nextNodeId: string | null;
}) {
  if (!nextNodeId) {
    return {
      nextFocusNodeId: null,
      nextMobileSheetOpen: false,
      shouldUpdateFocus: currentFocusNodeId !== null
    };
  }

  if (!isMobile) {
    return {
      nextFocusNodeId: nextNodeId,
      nextMobileSheetOpen: false,
      shouldUpdateFocus: currentFocusNodeId !== nextNodeId
    };
  }

  if (currentFocusNodeId === nextNodeId) {
    return {
      nextFocusNodeId: nextNodeId,
      nextMobileSheetOpen: true,
      shouldUpdateFocus: false
    };
  }

  return {
    nextFocusNodeId: nextNodeId,
    nextMobileSheetOpen: false,
    shouldUpdateFocus: true
  };
}

const CLEAR_OVERLAY_REQUEST_KEY = "__clear__";

export function resolveKnowledgeGraphOverlaySyncAction({
  isMobile,
  focusNodeId,
  shellOverlayFocusNodeId,
  lastRequestedKey
}: {
  isMobile: boolean;
  focusNodeId: string | null;
  shellOverlayFocusNodeId: string | null;
  lastRequestedKey: string | null;
}) {
  const desiredFocusNodeId = isMobile ? null : focusNodeId;
  const desiredRequestKey = desiredFocusNodeId ?? CLEAR_OVERLAY_REQUEST_KEY;
  const currentRequestKey = shellOverlayFocusNodeId ?? CLEAR_OVERLAY_REQUEST_KEY;

  if (desiredRequestKey === currentRequestKey) {
    return {
      action: "none" as const,
      nextRequestedKey: desiredRequestKey
    };
  }

  if (lastRequestedKey === desiredRequestKey) {
    return {
      action: "none" as const,
      nextRequestedKey: desiredRequestKey
    };
  }

  return {
    action: desiredFocusNodeId ? ("set" as const) : ("clear" as const),
    nextRequestedKey: desiredRequestKey
  };
}
