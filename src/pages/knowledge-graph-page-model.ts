export function resolveKnowledgeGraphFocusInteraction({
  isMobile,
  currentFocusNodeId,
  mobileSheetOpen,
  nextNodeId
}: {
  isMobile: boolean;
  currentFocusNodeId: string | null;
  mobileSheetOpen: boolean;
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
