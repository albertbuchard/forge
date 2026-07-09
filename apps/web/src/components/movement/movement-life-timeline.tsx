import { useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Database,
  Menu,
  MapPin,
  MoonStar,
  Plus,
  Route,
  Trash2
} from "lucide-react";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { FacetedTokenSearch } from "@/components/search/faceted-token-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import {
  createMovementUserBox,
  getMovementBoxDetail,
  createMovementPlace,
  deleteMovementUserBox,
  getMovementTimeline,
  invalidateAutomaticMovementBox,
  listMovementPlaces,
  patchMovementStay,
  preflightMovementUserBox,
  patchMovementUserBox
} from "@/lib/api";
import type {
  MovementKnownPlace,
  MovementTimelineSegment,
  MovementTimelineSleepOverlay
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  MovementPlaceEditorDialog,
  type MovementPlaceDraftSeed
} from "@/components/movement/movement-place-editor-dialog";
import {
  applySleepOverlayToMovementSegments
} from "@/components/movement/movement-sleep-overlay";
import {
  MovementTimelineHistoryCap,
  MovementTimelineRow,
  MovementTimelineViewportGrid,
  resolveStickyTimelineDay,
  timelineDangerActionClassName,
  timelineInfoBadgeClassName,
  timelineSelectedRingClassName,
  timelineSubtleBadgeClassName,
  timelineWarningActionClassName,
  timelineWarningBadgeClassName
} from "@/components/movement/movement-timeline-canvas";
import {
  MovementStayPlaceLabelDialog,
  MovementTimelineActionMenu,
  MovementTimelineDetailDialog,
  MovementTimelineEditDialog,
  MovementTimelineSelectionDialog,
  type MovementTimelineActionMenuItem
} from "@/components/movement/movement-timeline-dialogs";
import {
  GRID_ROW_HEIGHT,
  TIMELINE_PAGE_SIZE,
  TIMELINE_ROW_OVERSCAN_PX,
  buildDraft,
  buildMovementSegmentSearchText,
  buildMovementTimelineLayoutModel,
  buildMovementUserBoxPayloadInput,
  buildNewDraft,
  buildStayPlaceLabelOverridePayload,
  createMovementSegmentFilterOptions,
  displaySegmentTitle,
  distanceBetweenCoordinates,
  distanceLabel,
  formatDateTimeInput,
  formatDurationLabel,
  formatSegmentTimestamp,
  hasRecordedStay,
  matchesMovementSegmentFilters,
  movementPlaceSeedFromSegment,
  normalizeSearchText,
  parseDateTimeInput,
  removeSegmentFromTimelinePages,
  type TimelineDraft
} from "@/components/movement/movement-life-timeline-model";

type MovementLifeTimelineProps = {
  userIds?: string[];
};

export function MovementLifeTimeline({ userIds = [] }: MovementLifeTimelineProps) {
  const queryClient = useQueryClient();
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const dataListRef = useRef<HTMLDivElement | null>(null);
  const actionMenuButtonRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const autoSelectedRef = useRef(false);
  const prependAnchorRef = useRef<{ count: number; size: number } | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectionDialogOpen, setSelectionDialogOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [draftById, setDraftById] = useState<Record<string, TimelineDraft>>({});
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<TimelineDraft | null>(null);
  const [detailSegmentId, setDetailSegmentId] = useState<string | null>(null);
  const [placeLabelSegmentId, setPlaceLabelSegmentId] = useState<string | null>(null);
  const [placeLabelDialogOpen, setPlaceLabelDialogOpen] = useState(false);
  const [placeEditorOpen, setPlaceEditorOpen] = useState(false);
  const [placeSeed, setPlaceSeed] = useState<MovementPlaceDraftSeed | null>(null);
  const [placeSeedSegmentId, setPlaceSeedSegmentId] = useState<string | null>(null);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [reopenDataModalOnEditClose, setReopenDataModalOnEditClose] = useState(false);
  const [sleepOverlayVisible, setSleepOverlayVisible] = useState(false);
  const [segmentQuery, setSegmentQuery] = useState("");
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const syncScrollMetrics = () => {
    const element = scrollParentRef.current;
    if (!element) {
      return;
    }
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
  };

  const timelineQuery = useInfiniteQuery({
    queryKey: ["forge-movement-life-timeline", ...userIds],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      getMovementTimeline({
        before: pageParam ?? undefined,
        limit: TIMELINE_PAGE_SIZE,
        userIds
      }).then((response) => response.movement),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false
  });

  const dataTimelineQuery = useInfiniteQuery({
    queryKey: ["forge-movement-life-timeline-data", ...userIds],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      getMovementTimeline({
        before: pageParam ?? undefined,
        includeInvalid: true,
        limit: TIMELINE_PAGE_SIZE,
        userIds
      }).then((response) => response.movement),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false
  });

  const segmentsDescending = useMemo(
    () => timelineQuery.data?.pages.flatMap((page) => page.segments) ?? [],
    [timelineQuery.data]
  );
  const dataSegmentsDescending = useMemo(
    () => dataTimelineQuery.data?.pages.flatMap((page) => page.segments) ?? [],
    [dataTimelineQuery.data]
  );
  const invalidSegmentCount = useMemo(
    () =>
      timelineQuery.data?.pages.reduce(
        (count, page) => Math.max(count, page.invalidSegmentCount ?? 0),
        0
      ) ?? 0,
    [timelineQuery.data]
  );
  const segments = useMemo(
    () => [...segmentsDescending].reverse(),
    [segmentsDescending]
  );
  const dataSegments = useMemo(
    () => [...dataSegmentsDescending].reverse(),
    [dataSegmentsDescending]
  );
  const sleepOverlays = useMemo(() => {
    const byId = new Map<string, MovementTimelineSleepOverlay>();
    for (const page of timelineQuery.data?.pages ?? []) {
      for (const overlay of page.sleepOverlays ?? []) {
        byId.set(overlay.id, overlay);
      }
    }
    return [...byId.values()].sort(
      (left, right) =>
        new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
    );
  }, [timelineQuery.data]);
  const sleepDisplaySegments = useMemo(
    () => applySleepOverlayToMovementSegments(segments, sleepOverlays),
    [segments, sleepOverlays]
  );
  const displaySegments = useMemo(
    () =>
      sleepOverlayVisible
        ? sleepDisplaySegments
        : segments,
    [segments, sleepDisplaySegments, sleepOverlayVisible]
  );
  const renderedSleepSegments = useMemo(
    () =>
      sleepDisplaySegments.filter(
        (segment) => segment.syncSource === "sleep overlay"
      ),
    [sleepDisplaySegments]
  );
  const mostRelevantSleepSegmentId = renderedSleepSegments.at(-1)?.id ?? null;
  const detailSegment = useMemo(
    () => displaySegments.find((segment) => segment.id === detailSegmentId) ?? null,
    [detailSegmentId, displaySegments]
  );
  const selectedSegment = useMemo(
    () => displaySegments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [displaySegments, selectedSegmentId]
  );
  const detailQuery = useQuery({
    queryKey: ["forge-movement-box-detail", detailSegment?.boxId ?? null, ...userIds],
    queryFn: async () =>
      detailSegment?.boxId
        ? (await getMovementBoxDetail(detailSegment.boxId, userIds)).movement
        : null,
    enabled: Boolean(detailSegment?.boxId)
  });
  const placeLabelSegment = useMemo(
    () => segments.find((segment) => segment.id === placeLabelSegmentId) ?? null,
    [placeLabelSegmentId, segments]
  );
  const movementPlacesQuery = useQuery({
    queryKey: ["forge-movement-places", ...userIds],
    queryFn: async () => (await listMovementPlaces(userIds)).places,
    retry: false,
    refetchOnWindowFocus: false
  });
  const timelineLayout = useMemo(
    () =>
      buildMovementTimelineLayoutModel({
        segments: displaySegments,
        viewportHeight
      }),
    [displaySegments, viewportHeight]
  );
  const timelineItemById = useMemo(
    () =>
      new Map(
        timelineLayout.items.map((item) => [item.segment.id, item] as const)
      ),
    [timelineLayout.items]
  );
  const visibleTimelineItems = useMemo(() => {
    const visibleStart = Math.max(0, scrollTop - TIMELINE_ROW_OVERSCAN_PX);
    const visibleEnd =
      scrollTop +
      Math.max(viewportHeight, GRID_ROW_HEIGHT * 8) +
      TIMELINE_ROW_OVERSCAN_PX;
    return timelineLayout.items.filter((item) => {
      if (item.segment.id === selectedSegmentId) {
        return true;
      }
      return item.boxBottom >= visibleStart && item.boxTop <= visibleEnd;
    });
  }, [scrollTop, selectedSegmentId, timelineLayout.items, viewportHeight]);
  const stickyDayLabel = useMemo(
    () => resolveStickyTimelineDay(timelineLayout, scrollTop, viewportHeight),
    [scrollTop, timelineLayout, viewportHeight]
  );
  const openActionMenu = () => {
    const rect = actionMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      setActionMenuOpen((current) => !current);
      return;
    }
    setActionMenuAnchor({
      top: rect.bottom + 10,
      right: Math.max(12, window.innerWidth - rect.right)
    });
    setActionMenuOpen((current) => !current);
  };
  const actionMenuItems = useMemo<MovementTimelineActionMenuItem[]>(
    () => [
      {
        id: "add-box",
        label: "Add box",
        description: "Create a user-defined stay, move, or missing-data interval.",
        icon: Plus,
        onSelect: () => setCreatingDraft(buildNewDraft("stay", segments.at(-1) ?? null))
      },
      {
        id: "sleep",
        label: sleepOverlayVisible ? "Hide sleep" : "Show sleep",
        description: "Toggle sleep overlays without rewriting the movement boxes.",
        icon: MoonStar,
        onSelect: () =>
          setSleepOverlayVisible((current) => {
            const nextValue = !current;
            if (nextValue && mostRelevantSleepSegmentId) {
              setSelectedSegmentId(mostRelevantSleepSegmentId);
              setSelectionDialogOpen(true);
            }
            return nextValue;
          })
      },
      {
        id: "view-data",
        label: "View data",
        description: "Open the canonical loaded records and raw-data filters.",
        icon: Database,
        onSelect: () => setDataModalOpen(true)
      }
    ],
    [mostRelevantSleepSegmentId, segments, sleepOverlayVisible]
  );

  const scrollToTimelineItem = (
    segmentId: string,
    behavior: ScrollBehavior = "smooth"
  ) => {
    const element = scrollParentRef.current;
    const item = timelineItemById.get(segmentId);
    if (!element || !item) {
      return;
    }
    const targetTop = Math.max(
      0,
      item.boxTop - element.clientHeight / 2 + item.displayHeight / 2
    );
    if (typeof element.scrollTo === "function") {
      element.scrollTo({
        top: targetTop,
        behavior
      });
      return;
    }
    element.scrollTop = targetTop;
  };

  useEffect(() => {
    if (!dataModalOpen) {
      return;
    }
    if (!dataTimelineQuery.hasNextPage || dataTimelineQuery.isFetchingNextPage) {
      return;
    }
    void dataTimelineQuery.fetchNextPage();
  }, [
    dataModalOpen,
    dataTimelineQuery.fetchNextPage,
    dataTimelineQuery.hasNextPage,
    dataTimelineQuery.isFetchingNextPage
  ]);

  useEffect(() => {
    const latest = displaySegments.at(-1);
    if (!autoSelectedRef.current && latest) {
      autoSelectedRef.current = true;
      setSelectedSegmentId(latest.id);
    }
  }, [displaySegments]);

  useEffect(() => {
    if (!initializedRef.current && displaySegments.length > 0) {
      initializedRef.current = true;
      requestAnimationFrame(() => {
        const latestId = displaySegments[displaySegments.length - 1]?.id;
        if (latestId) {
          scrollToTimelineItem(latestId, "auto");
        }
        requestAnimationFrame(() => {
          syncScrollMetrics();
        });
      });
      return;
    }

    if (
      prependAnchorRef.current &&
      displaySegments.length > prependAnchorRef.current.count &&
      scrollParentRef.current
    ) {
      const anchor = prependAnchorRef.current;
      prependAnchorRef.current = null;
      requestAnimationFrame(() => {
        const scrollElement = scrollParentRef.current;
        if (!scrollElement) {
          return;
        }
        const delta = timelineLayout.totalHeight - anchor.size;
        scrollElement.scrollTop += delta;
        syncScrollMetrics();
      });
    }
  }, [displaySegments.length, timelineLayout.totalHeight, timelineItemById]);

  useEffect(() => {
    const element = scrollParentRef.current;
    if (!element) {
      return;
    }
    const updateViewport = () => {
      syncScrollMetrics();
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (!selectedSegmentId) {
      return;
    }
    const segment = segments.find((entry) => entry.id === selectedSegmentId);
    if (!segment) {
      return;
    }
    setDraftById((current) =>
      current[selectedSegmentId]
        ? current
        : {
            ...current,
            [selectedSegmentId]: buildDraft(segment)
          }
    );
  }, [segments, selectedSegmentId]);

  useEffect(() => {
    if (!selectedSegmentId) {
      return;
    }
    if (!displaySegments.some((segment) => segment.id === selectedSegmentId)) {
      setSelectedSegmentId(displaySegments.at(-1)?.id ?? null);
      setSelectionDialogOpen(false);
    }
  }, [displaySegments, selectedSegmentId]);

  useEffect(() => {
    if (!sleepOverlayVisible || !mostRelevantSleepSegmentId) {
      return;
    }
    const targetIndex = displaySegments.findIndex(
      (segment) => segment.id === mostRelevantSleepSegmentId
    );
    if (targetIndex < 0) {
      return;
    }
    setSelectedSegmentId(mostRelevantSleepSegmentId);
    requestAnimationFrame(() => {
      const targetId = displaySegments[targetIndex]?.id;
      if (targetId) {
        scrollToTimelineItem(targetId);
      }
    });
  }, [displaySegments, mostRelevantSleepSegmentId, sleepOverlayVisible, timelineItemById]);

  const invalidateMovementProjectionQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["forge-movement-life-timeline"]
      }),
      queryClient.invalidateQueries({
        queryKey: ["forge-movement-life-timeline-data"]
      }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-box-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-month"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-places"] }),
      queryClient.invalidateQueries({
        queryKey: ["forge-psyche-self-observation-calendar"]
      })
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (input: {
      segment: MovementTimelineSegment | null;
      draft: TimelineDraft;
      creating: boolean;
    }) => {
      const { segment, draft, creating } = input;
      const payload = buildMovementUserBoxPayloadInput(draft, segment);

      if (creating) {
        await createMovementUserBox(payload, userIds);
        return;
      }

      if (!segment) {
        throw new Error("No movement box selected.");
      }
      if (segment.sourceKind !== "user_defined") {
        throw new Error(
          "Automatic movement boxes are immutable. Invalidate them into missing data or create a user-defined override instead."
        );
      }

      await patchMovementUserBox(
        segment.boxId,
        {
          ...payload,
          metadata: { updatedFrom: "movement-life-timeline" }
        },
        userIds
      );
    },
    onSuccess: invalidateMovementProjectionQueries
  });

  const persistPlaceLabelOverride = async (
    segment: MovementTimelineSegment,
    place: Pick<MovementKnownPlace, "label">
  ) => {
    if (segment.kind !== "stay") {
      throw new Error("Only stays can be linked to a saved place.");
    }

    const payload = buildStayPlaceLabelOverridePayload(segment, place.label);
    if (segment.sourceKind === "user_defined") {
      await patchMovementUserBox(
        segment.boxId,
        {
          ...payload,
          metadata: { updatedFrom: "movement-life-timeline-place-label" }
        },
        userIds
      );
      return;
    }

    await createMovementUserBox(
      {
        ...payload,
        metadata: { createdFrom: "movement-life-timeline-place-label" }
      },
      userIds
    );
  };

  const persistRecordedStayPlaceLink = async (
    segment: Extract<MovementTimelineSegment, { kind: "stay" }> & {
      stay: NonNullable<Extract<MovementTimelineSegment, { kind: "stay" }>["stay"]>;
    },
    place: Pick<MovementKnownPlace, "externalUid" | "label">
  ) => {
    if (segment.rawStayIds.length === 0) {
      throw new Error("This stay has no raw stay ids to relabel.");
    }
    await Promise.all(
      segment.rawStayIds.map((stayId) =>
        patchMovementStay(stayId, {
          placeExternalUid: place.externalUid,
          placeLabel: place.label
        })
      )
    );
  };

  const confirmDistantPlaceSelection = (
    segment: MovementTimelineSegment,
    place: MovementKnownPlace
  ) => {
    const seed = movementPlaceSeedFromSegment(segment);
    if (!seed) {
      return true;
    }
    const distanceMeters = distanceBetweenCoordinates(
      seed.latitude,
      seed.longitude,
      place.latitude,
      place.longitude
    );
    if (distanceMeters <= 100) {
      return true;
    }
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return true;
    }
    return window.confirm(
      `"${place.label}" is ${distanceLabel(
        distanceMeters
      )} away from this stay's recorded center. Link it anyway?`
    );
  };

  const placeMutation = useMutation({
    mutationFn: async (input: {
      segment: MovementTimelineSegment | null;
      id?: string;
      label: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      categoryTags: string[];
    }) => {
      const { segment, ...placeInput } = input;
      const response = await createMovementPlace(placeInput, userIds);
      if (segment && hasRecordedStay(segment)) {
        await persistRecordedStayPlaceLink(segment, response.place);
      }
      return response;
    },
    onSuccess: invalidateMovementProjectionQueries
  });

  const assignPlaceMutation = useMutation({
    mutationFn: async (input: {
      segment: MovementTimelineSegment;
      place: MovementKnownPlace;
    }) => {
      const { segment, place } = input;
      if (!confirmDistantPlaceSelection(segment, place)) {
        return { assigned: false };
      }
      if (hasRecordedStay(segment)) {
        await persistRecordedStayPlaceLink(segment, place);
        return { assigned: true };
      }
      if (segment.kind !== "stay") {
        throw new Error("Only stays can be linked to a saved place.");
      }
      await persistPlaceLabelOverride(segment, place);
      return { assigned: true };
    },
    onSuccess: async (result) => {
      if (result.assigned) {
        await invalidateMovementProjectionQueries();
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (segment: MovementTimelineSegment) => {
      if (segment.sourceKind === "user_defined") {
        await deleteMovementUserBox(segment.boxId, userIds);
        return;
      }
      await invalidateAutomaticMovementBox(
        segment.boxId,
        {
          title: "User invalidated automatic movement",
          subtitle: `Overrides ${displaySegmentTitle(segment)} with missing data.`
        },
        userIds
      );
    },
    onSuccess: async (_, segment) => {
      setSelectedSegmentId((current) => (current === segment.id ? null : current));
      setSelectionDialogOpen(false);
      setEditingSegmentId((current) => (current === segment.id ? null : current));
      queryClient.setQueryData(
        ["forge-movement-life-timeline", ...userIds],
        (current: { pages: Array<{ segments: MovementTimelineSegment[] }>; pageParams: unknown[] } | undefined) =>
          removeSegmentFromTimelinePages(current, segment.id)
      );
      queryClient.setQueryData(
        ["forge-movement-life-timeline-data", ...userIds],
        (current: { pages: Array<{ segments: MovementTimelineSegment[] }>; pageParams: unknown[] } | undefined) =>
          removeSegmentFromTimelinePages(current, segment.id)
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-movement-life-timeline"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["forge-movement-life-timeline-data"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-month"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-selection"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-self-observation-calendar"]
        })
      ]);
    }
  });

  const segmentFilterOptions = useMemo(
    () => createMovementSegmentFilterOptions(dataSegments),
    [dataSegments]
  );

  const filteredSegments = useMemo(() => {
    const normalizedQuery = normalizeSearchText(segmentQuery);
    return [...dataSegments]
      .sort(
        (left, right) =>
          new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime()
      )
      .filter((segment) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          buildMovementSegmentSearchText(segment).includes(normalizedQuery);
        return matchesQuery && matchesMovementSegmentFilters(segment, selectedFilterIds);
      });
  }, [dataSegments, segmentQuery, selectedFilterIds]);

  const dataResultSummary = useMemo(() => {
    if (dataSegments.length === 0) {
      return "No movement records loaded yet.";
    }
    if (
      filteredSegments.length === dataSegments.length &&
      segmentQuery.trim().length === 0 &&
      selectedFilterIds.length === 0
    ) {
      return `${dataSegments.length} loaded movement records visible`;
    }
    return `${filteredSegments.length} of ${dataSegments.length} loaded records visible`;
  }, [
    dataSegments.length,
    filteredSegments.length,
    segmentQuery,
    selectedFilterIds.length
  ]);

  const dataListVirtualizer = useVirtualizer({
    count: filteredSegments.length,
    getScrollElement: () => dataListRef.current,
    estimateSize: () => 136,
    overscan: 8
  });

  const editingSegment = editingSegmentId
    ? segments.find((segment) => segment.id === editingSegmentId) ?? null
    : null;
  const editingDraft = editingSegment
    ? (draftById[editingSegment.id] ?? buildDraft(editingSegment))
    : null;
  const isCreating = creatingDraft !== null;
  const activeDraft = creatingDraft ?? editingDraft;
  const visibleRangeStart = segments[0]?.startedAt ?? null;
  const visibleRangeEnd = segments[segments.length - 1]?.endedAt ?? null;
  const preflightQuery = useQuery({
    queryKey: [
      "forge-movement-user-box-preflight",
      editingSegment?.boxId ?? "create",
      activeDraft?.kind ?? null,
      activeDraft?.startedAtInput ?? null,
      activeDraft?.endedAtInput ?? null,
      visibleRangeStart,
      visibleRangeEnd,
      ...userIds
    ],
    enabled:
      activeDraft !== null &&
      parseDateTimeInput(activeDraft.startedAtInput) !== null &&
      parseDateTimeInput(activeDraft.endedAtInput) !== null,
    queryFn: async () => {
      if (!activeDraft) {
        return null;
      }
      const payload = buildMovementUserBoxPayloadInput(activeDraft, editingSegment);
      const response = await preflightMovementUserBox(
        {
          ...payload,
          excludeBoxId:
            editingSegment?.sourceKind === "user_defined"
              ? editingSegment.boxId
              : null,
          rangeStart: visibleRangeStart,
          rangeEnd: visibleRangeEnd
        },
        userIds
      );
      return response.preflight;
    }
  });

  const openPlaceLabelDialog = (segment: MovementTimelineSegment) => {
    if (!hasRecordedStay(segment)) {
      return;
    }
    setPlaceLabelSegmentId(segment.id);
    setPlaceLabelDialogOpen(true);
  };

  const openPlaceCreateFromLabelDialog = (
    segment: MovementTimelineSegment,
    labelHint: string
  ) => {
    const seed = movementPlaceSeedFromSegment(segment);
    if (!seed) {
      return;
    }
    setPlaceLabelDialogOpen(false);
    setPlaceLabelSegmentId(segment.id);
    setPlaceSeed({
      ...seed,
      label: labelHint.trim() || seed.label
    });
    setPlaceSeedSegmentId(segment.id);
    setPlaceEditorOpen(true);
  };

  const handleScroll = () => {
    const element = scrollParentRef.current;
    if (!element) {
      return;
    }
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
    if (!timelineQuery.hasNextPage || timelineQuery.isFetchingNextPage) {
      return;
    }
    if (element.scrollTop <= 960) {
      prependAnchorRef.current = {
        count: displaySegments.length,
        size: timelineLayout.totalHeight
      };
      void timelineQuery.fetchNextPage();
    }
  };

  if (timelineQuery.isPending) {
    return (
      <SurfaceSkeleton
        eyebrow="Movement"
        title="Loading life timeline"
        description="Reconstructing the longer road of stays, moves, and places."
        columns={1}
        blocks={6}
      />
    );
  }

  if (timelineQuery.isError) {
    return (
      <ErrorState
        eyebrow="Movement"
        error={timelineQuery.error}
        onRetry={() => void timelineQuery.refetch()}
      />
    );
  }

  const contentHeight = timelineLayout.totalHeight;
  return (
    <section className="grid gap-4">
      <Card className="overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-3 sm:rounded-[34px] sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div className="font-label text-[11px] uppercase tracking-[0.22em] text-[var(--ui-ink-muted)]">
            Movement
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {invalidSegmentCount > 0 ? (
              <Badge className={cn("hidden sm:inline-flex", timelineWarningBadgeClassName)}>
                {invalidSegmentCount} invalid hidden
              </Badge>
            ) : null}
            <Badge className="hidden bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)] sm:inline-flex">
              {displaySegments.length} visible
            </Badge>
            <div ref={actionMenuButtonRef}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={actionMenuOpen}
                aria-haspopup="dialog"
                className={cn(
                  "h-9 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-3)] hover:text-[var(--ui-ink-strong)]",
                  actionMenuOpen ? timelineSelectedRingClassName : ""
                )}
                onClick={openActionMenu}
              >
                <Menu className="size-4" />
                Actions
              </Button>
            </div>
          </div>
        </div>
        <MovementTimelineActionMenu
          open={actionMenuOpen}
          anchor={actionMenuAnchor}
          items={actionMenuItems}
          onClose={() => setActionMenuOpen(false)}
        />
        {sleepOverlayVisible && renderedSleepSegments.length === 0 ? (
          <p className="mb-3 px-1 text-sm text-[color-mix(in_srgb,var(--warning)_72%,var(--ui-ink-strong)_28%)]">
            No sleep session overlaps the currently loaded timeline range yet.
            Scroll further back to load older history.
          </p>
        ) : null}
        <div
          ref={scrollParentRef}
          onScroll={handleScroll}
          className="relative h-[82vh] overflow-auto rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)]"
        >
          <MovementTimelineViewportGrid
            layout={timelineLayout}
            scrollTop={scrollTop}
            viewportHeight={viewportHeight}
          />
          {stickyDayLabel ? (
            <div className="pointer-events-none sticky top-3 z-50 flex h-0 justify-center">
              <div className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-soft)] backdrop-blur-xl">
                {stickyDayLabel}
              </div>
            </div>
          ) : null}

          <div
            className="relative"
            style={{ height: `${contentHeight}px` }}
          >
            {timelineLayout.historyHeaderHeight > 0 ? (
              <div
                className="absolute inset-x-0 top-0"
                style={{ height: `${timelineLayout.historyHeaderHeight}px` }}
              >
                <MovementTimelineHistoryCap segment={displaySegments[0] ?? null} />
              </div>
            ) : null}
            {visibleTimelineItems.map((itemLayout) => {
              const segment = itemLayout.segment;
              return (
                <MovementTimelineRow
                  key={segment.id}
                  layout={itemLayout}
                  selected={selectedSegmentId === segment.id}
                  onToggle={() =>
                    {
                      setSelectedSegmentId(segment.id);
                      setSelectionDialogOpen(true);
                    }
                  }
                />
              );
            })}
          </div>
        </div>
      </Card>
      <MovementTimelineEditDialog
        open={editingSegment !== null || creatingDraft !== null}
        segment={editingSegment}
        draft={activeDraft}
        creating={isCreating}
        saving={saveMutation.isPending}
        preflight={preflightQuery.data ?? null}
        preflightLoading={preflightQuery.isFetching}
        onDraftChange={(nextDraft) => {
          if (isCreating) {
            setCreatingDraft(nextDraft);
            return;
          }
          if (!editingSegment) {
            return;
          }
          setDraftById((current) => ({
            ...current,
            [editingSegment.id]: nextDraft
          }));
        }}
        onFitMissing={() => {
          const preflight = preflightQuery.data;
          if (!preflight?.nearestMissingStartedAt || !preflight.nearestMissingEndedAt) {
            return;
          }
          const nextDraft = {
            ...(activeDraft ?? buildNewDraft("stay", editingSegment)),
            startedAtInput: formatDateTimeInput(preflight.nearestMissingStartedAt),
            endedAtInput: formatDateTimeInput(preflight.nearestMissingEndedAt)
          };
          if (isCreating) {
            setCreatingDraft(nextDraft);
            return;
          }
          if (!editingSegment) {
            return;
          }
          setDraftById((current) => ({
            ...current,
            [editingSegment.id]: nextDraft
          }));
        }}
        onSave={() => {
          if (!activeDraft) {
            return;
          }
          void saveMutation.mutateAsync(
            {
              segment: editingSegment,
              draft: activeDraft,
              creating: isCreating
            },
            {
            onSuccess: () => {
              setEditingSegmentId(null);
              setCreatingDraft(null);
              if (reopenDataModalOnEditClose) {
                setReopenDataModalOnEditClose(false);
                setDataModalOpen(true);
              }
            }
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSegmentId(null);
            setCreatingDraft(null);
            if (reopenDataModalOnEditClose) {
              setReopenDataModalOnEditClose(false);
              setDataModalOpen(true);
            }
          }
        }}
      />
      <MovementTimelineSelectionDialog
        open={selectionDialogOpen && selectedSegment !== null}
        onOpenChange={(open) => {
          setSelectionDialogOpen(open);
        }}
        segment={selectedSegment}
        onEdit={() => {
          if (!selectedSegment?.editable) {
            return;
          }
          setEditingSegmentId(selectedSegment.id);
          setSelectionDialogOpen(false);
        }}
        onOpenDetail={() => {
          if (!selectedSegment) {
            return;
          }
          setDetailSegmentId(selectedSegment.id);
          setSelectionDialogOpen(false);
        }}
        onDefinePlace={() => {
          if (!selectedSegment) {
            return;
          }
          openPlaceLabelDialog(selectedSegment);
          setSelectionDialogOpen(false);
        }}
      />
      <MovementTimelineDetailDialog
        open={detailSegment !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSegmentId(null);
          }
        }}
        segment={detailSegment}
        detail={detailQuery.data ?? null}
        loading={detailQuery.isFetching}
        onEdit={() => {
          if (!detailSegment || !detailSegment.editable) {
            return;
          }
          setEditingSegmentId(detailSegment.id);
          setDetailSegmentId(null);
        }}
        onDefinePlace={() => {
          if (!detailSegment) {
            return;
          }
          openPlaceLabelDialog(detailSegment);
        }}
      />
      <MovementStayPlaceLabelDialog
        open={placeLabelDialogOpen}
        onOpenChange={(open) => {
          setPlaceLabelDialogOpen(open);
          if (!open) {
            setPlaceLabelSegmentId(null);
          }
        }}
        segment={placeLabelSegment}
        places={movementPlacesQuery.data ?? []}
        loading={movementPlacesQuery.isFetching}
        onSelectPlace={async (place) => {
          if (!placeLabelSegment) {
            return false;
          }
          const result = await assignPlaceMutation.mutateAsync({
            segment: placeLabelSegment,
            place
          });
          return result.assigned;
        }}
        onCreatePlace={(segment, labelHint) => {
          openPlaceCreateFromLabelDialog(segment, labelHint);
        }}
      />
      <MovementPlaceEditorDialog
        open={placeEditorOpen}
        onOpenChange={(open) => {
          setPlaceEditorOpen(open);
          if (!open) {
            setPlaceSeed(null);
            setPlaceSeedSegmentId(null);
          }
        }}
        place={null}
        seed={placeSeed}
        onSave={async (input) => {
          await placeMutation.mutateAsync({
            ...input,
            segment:
              segments.find((segment) => segment.id === placeSeedSegmentId) ?? null
          });
        }}
      />
      <SheetScaffold
        open={dataModalOpen}
        onOpenChange={(open) => {
          setDataModalOpen(open);
          if (!open) {
            if (!reopenDataModalOnEditClose) {
              setSegmentQuery("");
              setSelectedFilterIds([]);
            }
          }
        }}
        eyebrow="Movement data"
        title="View data"
        description="Search and inspect canonical stays, trips, and missing intervals without changing the raw movement evidence."
      >
        <div className="grid gap-4">
          <FacetedTokenSearch
            title=""
            description=""
            query={segmentQuery}
            onQueryChange={setSegmentQuery}
            options={segmentFilterOptions}
            selectedOptionIds={selectedFilterIds}
            onSelectedOptionIdsChange={setSelectedFilterIds}
            resultSummary={dataResultSummary}
            placeholder="Search movement labels, places, times, tags, or add time and kind filters"
            emptyStateMessage="Keep typing or pick filters to narrow the movement history."
          />

          <Card className="grid min-w-0 gap-3">
            <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Canonical boxes
                </div>
                <div className="max-w-3xl break-words text-sm leading-6 text-[var(--ui-ink-muted)]">
                  This list shows the canonical movement boxes projected by Forge. Automatic boxes are derived from immutable raw phone measurements. User-defined boxes override the projection without mutating raw movement data.
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-medium)]"
                  onClick={() => {
                    setReopenDataModalOnEditClose(true);
                    setDataModalOpen(false);
                    setCreatingDraft(buildNewDraft("stay", filteredSegments.at(-1) ?? null));
                  }}
                >
                  Add box
                </Button>
                <Badge tone="meta">{dataResultSummary}</Badge>
                {invalidSegmentCount > 0 ? (
                  <Badge className={timelineWarningBadgeClassName}>
                    {invalidSegmentCount} invalid hidden included
                  </Badge>
                ) : null}
                {dataTimelineQuery.hasNextPage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-medium)]"
                    pending={dataTimelineQuery.isFetchingNextPage}
                    pendingLabel="Loading…"
                    onClick={() => void dataTimelineQuery.fetchNextPage()}
                  >
                    Load older
                  </Button>
                ) : null}
              </div>
            </div>

              <div
                ref={dataListRef}
                className="h-[36rem] overflow-y-auto rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]"
              >
                {filteredSegments.length === 0 ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm leading-6 text-[var(--ui-ink-muted)]">
                    No movement record matches the current search. Clear filters or load older timeline history.
                  </div>
                ) : (
                  <div
                    className="relative w-full"
                    style={{ height: `${dataListVirtualizer.getTotalSize()}px` }}
                  >
                    {dataListVirtualizer.getVirtualItems().map((virtualRow) => {
                      const segment = filteredSegments[virtualRow.index]!;
                      return (
                        <div
                          key={`${segment.kind}:${segment.id}:${segment.startedAt}:${segment.endedAt}:${virtualRow.index}`}
                          ref={dataListVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="absolute left-0 top-0 w-full px-3 py-2"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <div className="flex items-start gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2.5">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left transition hover:opacity-100"
                              onClick={() => {
                                if (!segment.editable) {
                                  return;
                                }
                                setReopenDataModalOnEditClose(true);
                                setDataModalOpen(false);
                                setEditingSegmentId(segment.id);
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-[var(--ui-ink-strong)]">
                                    {segment.kind === "stay" ? (
                                      <MapPin className="size-3.5 shrink-0 text-[var(--primary)]" />
                                    ) : segment.kind === "missing" ? (
                                      <Database className="size-3.5 shrink-0 text-[var(--ui-ink-medium)]" />
                                    ) : (
                                      <Route className="size-3.5 shrink-0 text-[var(--primary)]" />
                                    )}
                                    <span className="truncate text-sm font-medium">
                                      {displaySegmentTitle(segment)}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                                    {formatSegmentTimestamp(segment.startedAt)} →{" "}
                                    {formatSegmentTimestamp(segment.endedAt)}
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                    <Badge tone={segment.kind === "trip" ? "signal" : "meta"}>
                                      {segment.kind === "trip"
                                        ? "Move"
                                        : segment.kind === "missing"
                                          ? "Missing"
                                          : "Stay"}
                                    </Badge>
                                  <Badge
                                    className={
                                      segment.sourceKind === "user_defined"
                                        ? "bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                                        : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                                    }
                                  >
                                    {segment.sourceKind === "user_defined"
                                      ? segment.origin === "user_invalidated"
                                        ? "User invalidated"
                                        : "User-defined"
                                      : "Automatic"}
                                  </Badge>
                                  <Badge tone="meta">
                                    {formatDurationLabel(segment.durationSeconds)}
                                  </Badge>
                                  {segment.origin === "continued_stay" ? (
                                    <Badge className={timelineInfoBadgeClassName}>
                                      Continued stay
                                    </Badge>
                                  ) : null}
                                  {segment.origin === "repaired_gap" ? (
                                    <Badge className={timelineWarningBadgeClassName}>
                                      Repaired
                                    </Badge>
                                  ) : null}
                                  {segment.kind === "missing" ? (
                                    <Badge className={timelineSubtleBadgeClassName}>
                                      Missing
                                    </Badge>
                                  ) : null}
                                  {segment.isInvalid ? (
                                    <Badge className={timelineWarningBadgeClassName}>
                                      Invalid
                                    </Badge>
                                  ) : null}
                                  {segment.placeLabel ? (
                                    <Badge tone="default">{segment.placeLabel}</Badge>
                                  ) : null}
                                  {segment.overrideCount > 0 ? (
                                    <Badge className={timelineWarningBadgeClassName}>
                                      Overrides {segment.overrideCount}
                                    </Badge>
                                  ) : null}
                                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                                    Raw stays {segment.rawStayIds.length}
                                  </Badge>
                                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                                    Raw trips {segment.rawTripIds.length}
                                  </Badge>
                                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                                    Raw points {segment.rawPointCount}
                                  </Badge>
                                  {segment.hasLegacyCorrections ? (
                                    <Badge className={timelineWarningBadgeClassName}>
                                      Legacy corrections
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-8 shrink-0 rounded-full border px-2.5",
                                segment.sourceKind === "user_defined"
                                  ? timelineDangerActionClassName
                                  : timelineWarningActionClassName
                              )}
                              pending={
                                deleteMutation.isPending &&
                                deleteMutation.variables?.id === segment.id
                              }
                              pendingLabel=""
                              onClick={() => {
                                const confirmed = window.confirm(
                                  segment.sourceKind === "user_defined"
                                    ? `Delete ${displaySegmentTitle(segment)} and remove this user-defined box from every synced surface?`
                                    : `Invalidate ${displaySegmentTitle(segment)} into missing data and hide the automatic box everywhere?`
                                );
                                if (!confirmed) {
                                  return;
                                }
                                void deleteMutation.mutateAsync(segment);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
        </div>
      </SheetScaffold>
    </section>
  );
}
