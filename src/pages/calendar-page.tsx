import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardPaste,
  Clock3,
  Copy,
  Link2,
  MoreHorizontal,
  PencilLine,
  RefreshCcw,
  Scissors,
  ShieldBan,
  Sparkles,
  Trash2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CalendarEventFlowDialog } from "@/components/calendar/calendar-event-flow-dialog";
import { CalendarQuickRenameDialog } from "@/components/calendar/calendar-quick-rename-dialog";
import { CalendarWeekToolbar } from "@/components/calendar/calendar-week-toolbar";
import { TaskSchedulingDialog } from "@/components/calendar/task-scheduling-dialog";
import { TimeboxPlanningDialog } from "@/components/calendar/timebox-planning-dialog";
import { WorkBlockFlowDialog } from "@/components/calendar/work-block-flow-dialog";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { EntityBadge } from "@/components/ui/entity-badge";
import {
  FloatingActionMenu,
  type FloatingActionMenuItem
} from "@/components/ui/floating-action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import {
  createCalendarEvent,
  createTaskTimebox,
  createWorkBlockTemplate,
  deleteCalendarEvent,
  deleteWorkBlockTemplate,
  getCalendarOverview,
  getLifeForce,
  patchCalendarEvent,
  patchTask,
  patchWorkBlockTemplate,
  patchTaskTimebox
} from "@/lib/api";
import {
  buildCalendarDisplayColorMap,
  getFallbackCalendarColor,
  readCalendarDisplayPreferences
} from "@/lib/calendar-display-preferences";
import {
  estimateCalendarEventActionPointLoad,
  getCalendarActivityPresetOptions,
  estimateTaskTimeboxActionPointLoad,
  estimateWorkBlockActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import { readCalendarDisplayName } from "@/lib/calendar-name-deduper";
import { addDays, buildWeekDays, formatWeekday, startOfWeek } from "@/lib/calendar-ui";
import { getEntityKindForCrudEntityType } from "@/lib/entity-visuals";
import type {
  ActionProfile,
  CalendarEvent,
  CalendarEventLink,
  TaskTimebox,
  WorkBlockKind,
  WorkBlockTemplate
} from "@/lib/types";
import {
  formatUserSummaryLine,
  getSingleSelectedUserId
} from "@/lib/user-ownership";
import {
  useForgeClipboardStore,
  type ForgeClipboardCalendarEventItem
} from "@/store/use-forge-clipboard";

type CalendarMenuState =
  | {
      kind: "day";
      dayKey: string;
      position: { x: number; y: number };
    }
  | {
      kind: "event";
      eventId: string;
      position: { x: number; y: number };
    }
  | {
      kind: "work-block";
      templateId: string;
      position: { x: number; y: number };
    };

type CalendarOverviewQueryData = Awaited<ReturnType<typeof getCalendarOverview>>;
type EventSyncStatus = {
  tone: "saving" | "error";
  message: string;
};

function buildDefaultEventSeed(day: Date) {
  const start = new Date(day);
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    availability: "busy" as const
  };
}

function buildPreviewActionProfile(input: {
  entityType: ActionProfile["entityType"];
  entityId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  activityPresetKey?: string | null;
  customSustainRateApPerHour?: number | null;
}) {
  const durationSeconds = Math.max(
    60,
    Math.floor((Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 1000)
  );
  const presetRate =
    getCalendarActivityPresetOptions().find(
      (preset) => preset.key === input.activityPresetKey
    )?.defaultRateApPerHour ?? 100 / 24;
  const sustainRateApPerHour =
    input.customSustainRateApPerHour ?? presetRate;
  const totalCostAp = Number(
    ((durationSeconds / 3600) * sustainRateApPerHour).toFixed(2)
  );
  const now = new Date().toISOString();
  return {
    id: `preview_${input.entityType}_${input.entityId}`,
    profileKey: `${String(input.entityType)}_${input.entityId}`,
    title: input.title,
    entityType: input.entityType,
    mode: "container",
    startupAp: 0,
    totalCostAp,
    expectedDurationSeconds: durationSeconds,
    sustainRateApPerHour,
    demandWeights: {
      activation: 0.1,
      focus: 0.35,
      vigor: 0.1,
      composure: 0.15,
      flow: 0.3
    },
    doubleCountPolicy: "container_only",
    sourceMethod:
      input.customSustainRateApPerHour !== null &&
      input.customSustainRateApPerHour !== undefined
        ? "manual"
        : input.activityPresetKey
          ? "seeded"
          : "inferred",
    costBand: sustainRateApPerHour >= 10 ? "standard" : "light",
    recoveryEffect: 0,
    metadata: {
      activityPresetKey: input.activityPresetKey ?? null,
      customSustainRateApPerHour: input.customSustainRateApPerHour ?? null
    },
    createdAt: now,
    updatedAt: now
  } satisfies ActionProfile;
}

function normalizeCalendarEventPlace(event: CalendarEvent): CalendarEvent {
  const fallbackLocation = typeof event.location === "string" ? event.location : "";
  const place = event.place ?? {
    label: fallbackLocation,
    address: "",
    timezone: "",
    latitude: null,
    longitude: null,
    source: "",
    externalPlaceId: ""
  };
  return {
    ...event,
    place: {
      label: place.label || fallbackLocation,
      address: place.address ?? "",
      timezone: place.timezone ?? "",
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
      source: place.source ?? "",
      externalPlaceId: place.externalPlaceId ?? ""
    }
  };
}

function moveCalendarItemToDay(
  item: Pick<ForgeClipboardCalendarEventItem, "startAt" | "endAt">,
  day: Date
) {
  const sourceStart = new Date(item.startAt);
  const sourceEnd = new Date(item.endAt);
  const duration = sourceEnd.getTime() - sourceStart.getTime();
  const nextStart = new Date(day);
  nextStart.setUTCHours(sourceStart.getUTCHours(), sourceStart.getUTCMinutes(), 0, 0);
  const nextEnd = new Date(nextStart.getTime() + duration);
  return {
    startAt: nextStart.toISOString(),
    endAt: nextEnd.toISOString()
  };
}

function toClipboardEventItem(event: CalendarEvent): ForgeClipboardCalendarEventItem {
  return {
    type: "calendar_event",
    eventId: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    timezone: event.timezone,
    availability: event.availability,
    preferredCalendarId: event.calendarId,
    categories: event.categories,
    links: event.links.map((link) => ({
      entityType: link.entityType,
      entityId: link.entityId,
      relationshipType: link.relationshipType
    }))
  };
}

function formatProviderBadgeLabel(originType: CalendarEvent["originType"]) {
  switch (originType) {
    case "apple":
      return "Apple";
    case "google":
      return "Google";
    case "caldav":
      return "CalDAV";
    case "native":
      return "Forge";
    default:
      return "Derived";
  }
}

function getEventBadgeLabel(
  event: CalendarEvent,
  calendarTitleById: Map<string, string>
) {
  if (event.calendarId) {
    const calendarTitle = calendarTitleById.get(event.calendarId)?.trim();
    if (calendarTitle) {
      return calendarTitle;
    }
  }
  return event.originType === "native"
    ? "Forge only"
    : formatProviderBadgeLabel(event.originType);
}

function formatWorkBlockKindLabel(kind: WorkBlockKind) {
  switch (kind) {
    case "main_activity":
      return "Main activity";
    case "secondary_activity":
      return "Secondary activity";
    case "third_activity":
      return "Third activity";
    case "rest":
      return "Rest";
    case "holiday":
      return "Holiday";
    default:
      return "Custom";
  }
}

function formatTemplateDateRange(template: WorkBlockTemplate) {
  if (template.startsOn && template.endsOn) {
    return `${template.startsOn} to ${template.endsOn}`;
  }
  if (template.startsOn) {
    return `From ${template.startsOn}`;
  }
  if (template.endsOn) {
    return `Until ${template.endsOn}`;
  }
  return "Repeats with no end date";
}

export function CalendarPage() {
  const navigate = useNavigate();
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);
  const queryClient = useQueryClient();
  const clipboardEntry = useForgeClipboardStore((state) => state.entry);
  const setClipboardEntry = useForgeClipboardStore((state) => state.setEntry);
  const clearClipboard = useForgeClipboardStore((state) => state.clear);
  const completeClipboardPaste = useForgeClipboardStore((state) => state.completePaste);
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [draggedTimeboxId, setDraggedTimeboxId] = useState<string | null>(null);
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [workBlockDialogOpen, setWorkBlockDialogOpen] = useState(false);
  const [selectedWorkBlockTemplate, setSelectedWorkBlockTemplate] = useState<WorkBlockTemplate | null>(null);
  const [taskRulesDialogOpen, setTaskRulesDialogOpen] = useState(false);
  const [timeboxDialogOpen, setTimeboxDialogOpen] = useState(false);
  const [selectedTimebox, setSelectedTimebox] = useState<TaskTimebox | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [renameEvent, setRenameEvent] = useState<CalendarEvent | null>(null);
  const displayPreferences = useMemo(() => readCalendarDisplayPreferences(), []);
  const [eventSeed, setEventSeed] = useState<Partial<{
    title: string;
    description: string;
    location: string;
    startAt: string;
    endAt: string;
    timezone: string;
    availability: "busy" | "free";
    preferredCalendarId?: string | null;
    categories: string[];
    links: Array<{
      entityType: CalendarEventLink["entityType"];
      entityId: string;
      relationshipType: string;
      label: string;
    }>;
  }> | null>(null);
  const [menuState, setMenuState] = useState<CalendarMenuState | null>(null);
  const [eventSyncStatus, setEventSyncStatus] = useState<EventSyncStatus | null>(null);

  const range = useMemo(() => {
    const from = weekStart.toISOString();
    const to = addDays(weekStart, 7).toISOString();
    return { from, to };
  }, [weekStart]);

  const calendarQuery = useQuery({
    queryKey: ["forge-calendar-overview", range.from, range.to, ...selectedUserIds],
    queryFn: () =>
      getCalendarOverview({
        ...range,
        userIds: selectedUserIds
      })
  });
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: () => getLifeForce(selectedUserIds)
  });
  const calendarOverviewQueryKey = [
    "forge-calendar-overview",
    range.from,
    range.to,
    ...selectedUserIds
  ] as const;

  const isEventInVisibleRange = (event: Pick<CalendarEvent, "startAt" | "deletedAt">) => {
    if (event.deletedAt) {
      return false;
    }
    const eventStartsAt = new Date(event.startAt).getTime();
    return (
      eventStartsAt >= new Date(range.from).getTime() &&
      eventStartsAt < new Date(range.to).getTime()
    );
  };

  const setCalendarOverviewData = (
    updater: (current: CalendarOverviewQueryData) => CalendarOverviewQueryData
  ) => {
    queryClient.setQueryData<CalendarOverviewQueryData>(
      calendarOverviewQueryKey,
      (current) => {
        if (!current) {
          return current;
        }
        return updater(current);
      }
    );
  };

  const invalidateCalendar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-calendar-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
      queryClient.invalidateQueries({ queryKey: ["task-context"] }),
      queryClient.invalidateQueries({ queryKey: ["project-board"] })
    ]);
  };

  const createWorkBlockMutation = useMutation({
    mutationFn: (input: Parameters<typeof createWorkBlockTemplate>[0]) =>
      createWorkBlockTemplate({
        ...input,
        userId: input.userId ?? defaultUserId
      }),
    onSuccess: invalidateCalendar
  });

  const patchWorkBlockMutation = useMutation({
    mutationFn: ({
      templateId,
      patch
    }: {
      templateId: string;
      patch: Parameters<typeof patchWorkBlockTemplate>[1];
    }) => patchWorkBlockTemplate(templateId, patch),
    onSuccess: invalidateCalendar
  });

  const deleteWorkBlockMutation = useMutation({
    mutationFn: deleteWorkBlockTemplate,
    onSuccess: invalidateCalendar
  });

  const createTimeboxMutation = useMutation({
    mutationFn: (timebox: {
      taskId: string;
      projectId?: string | null;
      title: string;
      startsAt: string;
      endsAt: string;
      source?: TaskTimebox["source"];
      overrideReason?: string | null;
      activityPresetKey?: string | null;
      customSustainRateApPerHour?: number | null;
    }) =>
      createTaskTimebox({
        ...timebox,
        userId: defaultUserId
      }),
    onSuccess: invalidateCalendar
  });

  const moveTimeboxMutation = useMutation({
    mutationFn: ({
      timeboxId,
      startsAt,
      endsAt
    }: {
      timeboxId: string;
      startsAt: string;
      endsAt: string;
    }) => patchTaskTimebox(timeboxId, { startsAt, endsAt }),
    onSuccess: invalidateCalendar
  });
  const patchTimeboxMutation = useMutation({
    mutationFn: ({
      timeboxId,
      patch
    }: {
      timeboxId: string;
      patch: Parameters<typeof patchTaskTimebox>[1];
    }) => patchTaskTimebox(timeboxId, patch),
    onSuccess: invalidateCalendar
  });

  const createEventMutation = useMutation({
    mutationFn: (input: Parameters<typeof createCalendarEvent>[0]) =>
      createCalendarEvent({
        ...input,
        userId: input.userId ?? defaultUserId
      }),
    onMutate: async (input) => {
      setEventSyncStatus({ tone: "saving", message: "Saving event changes in the background…" });
      await queryClient.cancelQueries({ queryKey: calendarOverviewQueryKey });
      const previous = queryClient.getQueryData<CalendarOverviewQueryData>(
        calendarOverviewQueryKey
      );
      const defaultWritableCalendar =
        previous?.calendar.calendars.find(
          (calendar) => calendar.canWrite && calendar.selectedForSync
        ) ??
        previous?.calendar.calendars.find((calendar) => calendar.canWrite) ??
        null;
      const now = new Date().toISOString();
      const optimisticEventId = `calendar_event_optimistic_${Date.now()}`;
      const optimisticEvent: CalendarEvent = {
        id: optimisticEventId,
        connectionId: defaultWritableCalendar?.connectionId ?? null,
        calendarId:
          input.preferredCalendarId === undefined
            ? defaultWritableCalendar?.id ?? null
            : input.preferredCalendarId,
        remoteId: null,
        ownership: "forge",
        originType: "native",
        status: "confirmed",
        title: input.title,
        description: input.description ?? "",
        location: input.location ?? "",
        place: {
          label: input.place?.label ?? input.location ?? "",
          address: input.place?.address ?? "",
          timezone:
            input.place?.timezone ??
            input.timezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone ??
            "UTC",
          latitude: input.place?.latitude ?? null,
          longitude: input.place?.longitude ?? null,
          source: input.place?.source ?? "forge",
          externalPlaceId: input.place?.externalPlaceId ?? ""
        },
        startAt: input.startAt,
        endAt: input.endAt,
        timezone:
          input.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone ??
          "UTC",
        isAllDay: input.isAllDay ?? false,
        availability: input.availability ?? "busy",
        eventType: input.eventType ?? "general",
        categories: input.categories ?? [],
        sourceMappings: [],
        links: (input.links ?? []).map((link, index) => ({
          id: `calendar_event_link_optimistic_${Date.now()}_${index}`,
          entityType: link.entityType,
          entityId: link.entityId,
          relationshipType: link.relationshipType ?? "context",
          createdAt: now,
          updatedAt: now
        })),
        actionProfile: buildPreviewActionProfile({
          entityType: "calendar_event",
          entityId: optimisticEventId,
          title: input.title,
          startsAt: input.startAt,
          endsAt: input.endAt,
          activityPresetKey: input.activityPresetKey ?? null,
          customSustainRateApPerHour: input.customSustainRateApPerHour ?? null
        }),
        remoteUpdatedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      };

      if (previous && isEventInVisibleRange(optimisticEvent)) {
        setCalendarOverviewData((current) => ({
          ...current,
          calendar: {
            ...current.calendar,
            events: [optimisticEvent, ...current.calendar.events]
          }
        }));
      }

      return { previous, optimisticEventId: optimisticEvent.id };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(calendarOverviewQueryKey, context.previous);
      }
      setEventSyncStatus({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Forge could not sync that event change."
      });
    },
    onSuccess: ({ event }, _input, context) => {
      setEventSyncStatus(null);
      setCalendarOverviewData((current) => ({
        ...current,
        calendar: {
          ...current.calendar,
          events: (
            isEventInVisibleRange(event)
              ? [
                  event,
                  ...current.calendar.events.filter(
                    (entry) => entry.id !== context?.optimisticEventId
                  )
                ]
              : current.calendar.events.filter(
                  (entry) => entry.id !== context?.optimisticEventId
                )
          ).filter(
            (entry, index, all) =>
              all.findIndex((candidate) => candidate.id === entry.id) === index
          )
        }
      }));
    },
    onSettled: invalidateCalendar
  });

  const patchEventMutation = useMutation({
    mutationFn: ({
      eventId,
      patch
    }: {
      eventId: string;
      patch: Parameters<typeof patchCalendarEvent>[1];
    }) => patchCalendarEvent(eventId, patch),
    onMutate: async ({ eventId, patch }) => {
      setEventSyncStatus({ tone: "saving", message: "Saving event changes in the background…" });
      await queryClient.cancelQueries({ queryKey: calendarOverviewQueryKey });
      const previous = queryClient.getQueryData<CalendarOverviewQueryData>(
        calendarOverviewQueryKey
      );

      if (previous) {
        setCalendarOverviewData((current) => {
          const existingEvent = current.calendar.events.find((entry) => entry.id === eventId);
          if (!existingEvent) {
            return current;
          }
          const normalizedExistingEvent = normalizeCalendarEventPlace(existingEvent);
          const nextEvent: CalendarEvent = {
            ...normalizedExistingEvent,
            ...patch,
            place: patch.place
              ? {
                  ...normalizedExistingEvent.place,
                  ...patch.place
                }
              : normalizedExistingEvent.place,
            calendarId:
              patch.preferredCalendarId === undefined
                ? normalizedExistingEvent.calendarId
                : patch.preferredCalendarId,
            links:
              patch.links?.map((link, index) => ({
                id:
                  normalizedExistingEvent.links[index]?.id ??
                  `calendar_event_link_optimistic_${Date.now()}_${index}`,
                entityType: link.entityType,
                entityId: link.entityId,
                relationshipType: link.relationshipType ?? "context",
                createdAt:
                  normalizedExistingEvent.links[index]?.createdAt ??
                  normalizedExistingEvent.createdAt,
                updatedAt: new Date().toISOString()
              })) ?? normalizedExistingEvent.links,
            actionProfile: buildPreviewActionProfile({
              entityType: "calendar_event",
              entityId: eventId,
              title: patch.title ?? normalizedExistingEvent.title,
              startsAt: patch.startAt ?? normalizedExistingEvent.startAt,
              endsAt: patch.endAt ?? normalizedExistingEvent.endAt,
              activityPresetKey:
                patch.activityPresetKey === undefined
                  ? normalizedExistingEvent.actionProfile?.metadata
                      ?.activityPresetKey as string | null | undefined
                  : patch.activityPresetKey,
              customSustainRateApPerHour:
                patch.customSustainRateApPerHour === undefined
                  ? (typeof normalizedExistingEvent.actionProfile?.metadata
                      ?.customSustainRateApPerHour === "number"
                      ? normalizedExistingEvent.actionProfile.metadata
                          .customSustainRateApPerHour
                      : null)
                  : patch.customSustainRateApPerHour
            }),
            updatedAt: new Date().toISOString()
          };
          return {
            ...current,
            calendar: {
              ...current.calendar,
              events: current.calendar.events
                .map((entry) => (entry.id === eventId ? nextEvent : entry))
                .filter(isEventInVisibleRange)
            }
          };
        });
      }

      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(calendarOverviewQueryKey, context.previous);
      }
      setEventSyncStatus({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Forge could not sync that event change."
      });
    },
    onSuccess: ({ event }) => {
      setEventSyncStatus(null);
      setCalendarOverviewData((current) => ({
        ...current,
        calendar: {
          ...current.calendar,
          events: current.calendar.events
            .map((entry) => (entry.id === event.id ? event : entry))
            .filter(isEventInVisibleRange)
        }
      }));
    },
    onSettled: invalidateCalendar
  });

  const deleteEventMutation = useMutation({
    mutationFn: deleteCalendarEvent,
    onMutate: async (eventId) => {
      setEventSyncStatus({ tone: "saving", message: "Removing the event in the background…" });
      await queryClient.cancelQueries({ queryKey: calendarOverviewQueryKey });
      const previous = queryClient.getQueryData<CalendarOverviewQueryData>(
        calendarOverviewQueryKey
      );

      if (previous) {
        setCalendarOverviewData((current) => ({
          ...current,
          calendar: {
            ...current.calendar,
            events: current.calendar.events.filter((entry) => entry.id !== eventId)
          }
        }));
      }

      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(calendarOverviewQueryKey, context.previous);
      }
      setEventSyncStatus({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Forge could not delete that event."
      });
    },
    onSuccess: () => {
      setEventSyncStatus(null);
    },
    onSettled: invalidateCalendar
  });
  const calendarData = calendarQuery.data?.calendar;
  const days = useMemo(
    () => buildWeekDays(weekStart),
    [weekStart]
  );
  const overview = useMemo(
    () =>
      calendarData
        ? {
            ...calendarData,
            events: calendarData.events.map(normalizeCalendarEventPlace)
          }
        : {
            generatedAt: "",
            providers: [],
            connections: [],
            calendars: [],
            events: [],
            workBlockTemplates: [],
            workBlockInstances: [],
            timeboxes: []
          },
    [calendarData]
  );
  const calendarTitleById = useMemo(
    () =>
      new Map(
        overview.calendars.map((calendar) => [
          calendar.id,
          readCalendarDisplayName(calendar)
        ])
      ),
    [overview.calendars]
  );
  const calendarDisplayColors = useMemo(
    () => buildCalendarDisplayColorMap(overview.calendars, displayPreferences.calendarColors),
    [displayPreferences.calendarColors, overview.calendars]
  );
  const eventSyncPending =
    createEventMutation.isPending ||
    patchEventMutation.isPending ||
    deleteEventMutation.isPending;
  const plannedTimeboxes = overview.timeboxes.filter((timebox) => timebox.status === "planned");
  const writableCalendars = overview.calendars.filter((calendar) => calendar.canWrite);
  const describeLinkOwner = (label: string, ownerSummary: string) =>
    ownerSummary ? `${label} · ${ownerSummary}` : label;
  const linkOptions = [
    ...shell.snapshot.goals.map((goal) => ({
      entityType: "goal" as const,
      entityId: goal.id,
      label: goal.title,
      subtitle: describeLinkOwner("Goal", formatUserSummaryLine(goal.user))
    })),
    ...shell.snapshot.projects.map((project) => ({
      entityType: "project" as const,
      entityId: project.id,
      label: project.title,
      subtitle: describeLinkOwner("Project", formatUserSummaryLine(project.user))
    })),
    ...shell.snapshot.tasks.map((task) => ({
      entityType: "task" as const,
      entityId: task.id,
      label: task.title,
      subtitle: describeLinkOwner("Task", formatUserSummaryLine(task.user))
    })),
    ...shell.snapshot.strategies.map((strategy) => ({
      entityType: "strategy" as const,
      entityId: strategy.id,
      label: strategy.title,
      subtitle: describeLinkOwner(
        "Strategy",
        formatUserSummaryLine(strategy.user)
      )
    })),
    ...shell.snapshot.habits.map((habit) => ({
      entityType: "habit" as const,
      entityId: habit.id,
      label: habit.title,
      subtitle: describeLinkOwner("Habit", formatUserSummaryLine(habit.user))
    }))
  ];
  const linkLabelByKey = useMemo(
    () =>
      new Map(
        linkOptions.map((option) => [
          `${option.entityType}:${option.entityId}`,
          option.label
        ])
      ),
    [linkOptions]
  );
  const providerHealthLabel =
    overview.connections.length === 0
      ? "No providers connected"
      : `${overview.connections.filter((connection) => connection.status === "connected").length}/${overview.connections.length} healthy`;
  const clipboardCalendarEvents = (
    clipboardEntry?.items.filter(
      (item): item is ForgeClipboardCalendarEventItem => item.type === "calendar_event"
    ) ?? []
  );

  const openCreateEventDialogForDay = (day: Date) => {
    setSelectedEvent(null);
    setEventSeed(buildDefaultEventSeed(day));
    setEventDialogOpen(true);
  };

  const moveEventToDay = async (event: CalendarEvent, day: Date) => {
    const nextTiming = moveCalendarItemToDay(
      {
        startAt: event.startAt,
        endAt: event.endAt
      },
      day
    );
    await patchEventMutation.mutateAsync({
      eventId: event.id,
      patch: nextTiming
    });
  };

  const pasteClipboardToDay = async (day: Date) => {
    if (clipboardCalendarEvents.length === 0) {
      return;
    }

    for (const item of clipboardCalendarEvents) {
      const nextTiming = moveCalendarItemToDay(item, day);
      if (clipboardEntry?.mode === "cut") {
        await patchEventMutation.mutateAsync({
          eventId: item.eventId,
          patch: nextTiming
        });
      } else {
        await createEventMutation.mutateAsync({
          title: item.title,
          description: item.description,
          location: item.location,
          startAt: nextTiming.startAt,
          endAt: nextTiming.endAt,
          timezone: item.timezone,
          availability: item.availability,
          preferredCalendarId: item.preferredCalendarId,
          categories: item.categories,
          links: item.links
        });
      }
    }

    completeClipboardPaste();
  };

  const activeMenuItems = useMemo<FloatingActionMenuItem[]>(() => {
    if (!menuState) {
      return [];
    }

    if (menuState.kind === "day") {
      const day = days.find((entry) => entry.toISOString().slice(0, 10) === menuState.dayKey);
      if (!day) {
        return [];
      }
      return [
        {
          id: "create-event",
          label: "Create event",
          description: "Open the event guide with this day already selected.",
          icon: PencilLine,
          onSelect: () => openCreateEventDialogForDay(day)
        },
        {
          id: "create-work-block",
          label: "Create work block",
          description: "Open the guided work-block flow while you are looking at this day.",
          icon: ShieldBan,
          onSelect: () => {
            setSelectedWorkBlockTemplate(null);
            setWorkBlockDialogOpen(true);
          }
        },
        {
          id: "paste",
          label:
            clipboardEntry?.mode === "cut" ? "Paste moved event" : "Paste copied event",
          description:
            clipboardCalendarEvents.length > 0
              ? `${clipboardCalendarEvents.length} calendar item${clipboardCalendarEvents.length === 1 ? "" : "s"} ready to paste here.`
              : clipboardEntry
                ? "The current clipboard entry does not contain calendar events."
                : "Copy or cut an event first, then paste it into this day.",
          icon: ClipboardPaste,
          disabled: clipboardCalendarEvents.length === 0,
          onSelect: () => void pasteClipboardToDay(day)
        }
      ];
    }

    if (menuState.kind === "work-block") {
      const template = overview.workBlockTemplates.find((entry) => entry.id === menuState.templateId);
      if (!template) {
        return [];
      }
      return [
        {
          id: "edit-work-block",
          label: "Edit",
          description: "Adjust the recurring pattern, date bounds, or work policy.",
          icon: PencilLine,
          onSelect: () => {
            setSelectedWorkBlockTemplate(template);
            setWorkBlockDialogOpen(true);
          }
        },
        {
          id: "delete-work-block",
          label: "Delete",
          description: "Remove this recurring work block from Forge.",
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            if (selectedWorkBlockTemplate?.id === template.id) {
              setSelectedWorkBlockTemplate(null);
            }
            void deleteWorkBlockMutation.mutateAsync(template.id);
          }
        }
      ];
    }

    const event = overview.events.find((entry) => entry.id === menuState.eventId);
    if (!event) {
      return [];
    }

    return [
      {
        id: "rename",
        label: "Quick rename",
        description: "Change the event title without opening the full event flow.",
        icon: PencilLine,
        onSelect: () => setRenameEvent(event)
      },
      {
        id: "copy",
        label: "Copy",
        description: "Put this event on the Forge clipboard so you can paste it into another day.",
        icon: Copy,
        onSelect: () =>
          setClipboardEntry({
            id: `clipboard_${event.id}_${Date.now()}`,
            mode: "copy",
            source: "calendar",
            label: event.title,
            createdAt: new Date().toISOString(),
            items: [toClipboardEventItem(event)]
          })
      },
      {
        id: "cut",
        label: "Cut",
        description: "Move this event by pasting it into another day.",
        icon: Scissors,
        onSelect: () =>
          setClipboardEntry({
            id: `clipboard_cut_${event.id}_${Date.now()}`,
            mode: "cut",
            source: "calendar",
            label: event.title,
            createdAt: new Date().toISOString(),
            items: [toClipboardEventItem(event)]
          })
      },
      {
        id: "delete",
        label: "Delete",
        description: "Remove the event from Forge and delete any connected remote projection.",
        icon: Trash2,
        tone: "danger",
        onSelect: () => {
          if (clipboardEntry?.mode === "cut" && clipboardCalendarEvents.some((item) => item.eventId === event.id)) {
            clearClipboard();
          }
          void deleteEventMutation.mutateAsync(event.id);
        }
      }
    ];
  }, [
    clearClipboard,
    clipboardCalendarEvents,
    clipboardEntry,
    days,
    deleteEventMutation,
    deleteWorkBlockMutation,
    menuState,
    overview.events,
    overview.workBlockTemplates,
    selectedWorkBlockTemplate,
    setClipboardEntry
  ]);

  if (calendarQuery.isLoading) {
    return <SurfaceSkeleton />;
  }

  if (calendarQuery.isError || !calendarQuery.data) {
    return (
      <ErrorState
        eyebrow="Calendar"
        error={calendarQuery.error ?? new Error("Calendar data is unavailable")}
        onRetry={() => void calendarQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="project"
        titleText="Calendar"
        title="Calendar"
        description="See the real week first, then open guided flows for work blocks, task rules, timeboxing, and provider setup."
        badge={`${overview.connections.length} connection${overview.connections.length === 1 ? "" : "s"}`}
      />

      {lifeForceQuery.data?.lifeForce ? (
        <Card className="grid gap-3 rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(15,25,36,0.98),rgba(9,15,26,0.96))] p-4 md:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
              Life Force today
            </div>
            <div className="mt-2 text-3xl font-semibold text-white">
              {Math.round(lifeForceQuery.data.lifeForce.spentTodayAp)}
              <span className="ml-2 text-lg text-white/44">
                / {Math.round(lifeForceQuery.data.lifeForce.dailyBudgetAp)} AP
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
              Instant headroom
            </div>
            <div className="mt-2 text-2xl font-semibold text-[var(--primary)]">
              {lifeForceQuery.data.lifeForce.instantFreeApPerHour.toFixed(1)} AP/h
            </div>
            <div className="mt-2 text-sm text-white/58">
              Calendar containers now speak the same AP language as live work.
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
              Forecast
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {Math.round(lifeForceQuery.data.lifeForce.forecastAp)} AP
            </div>
            <div className="mt-2 text-sm text-white/58">
              Planned remaining {formatLifeForceAp(lifeForceQuery.data.lifeForce.plannedRemainingAp)}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="grid gap-4 rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,28,39,0.985),rgba(10,17,29,0.985))]">
        <CalendarWeekToolbar
          description="The calendar is the priority surface here. Connected provider events, recurring work blocks, and owned task timeboxes all stay visible together."
          weekStart={weekStart}
          status={
            eventSyncStatus ? (
              <div
                className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs ${
                  eventSyncStatus.tone === "error"
                    ? "border border-rose-400/20 bg-rose-400/10 text-rose-200"
                    : "border border-[var(--primary)]/18 bg-[var(--primary)]/12 text-[var(--primary)]"
                }`}
              >
                {eventSyncStatus.message}
              </div>
            ) : null
          }
          badges={
            <>
              {lifeForceQuery.data?.lifeForce ? (
                <Badge className="bg-white/[0.08] text-white/74">
                  {Math.round(lifeForceQuery.data.lifeForce.spentTodayAp)}/
                  {Math.round(lifeForceQuery.data.lifeForce.dailyBudgetAp)} AP
                </Badge>
              ) : null}
              {eventSyncPending ? (
                <Badge className="bg-white/[0.08] text-white/78">
                  <RefreshCcw className="mr-1 size-3.5 animate-spin" />
                  Syncing changes
                </Badge>
              ) : null}
              {clipboardEntry ? (
                <Badge className="bg-white/[0.08] text-white/74">
                  {clipboardEntry.mode === "cut" ? "Cut" : "Copied"} · {clipboardEntry.label}
                </Badge>
              ) : null}
            </>
          }
          onPrevious={() => setWeekStart(addDays(weekStart, -7))}
          onCurrent={() => setWeekStart(startOfWeek())}
          onNext={() => setWeekStart(addDays(weekStart, 7))}
        />

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))] 2xl:[grid-template-columns:repeat(7,minmax(0,1fr))]">
          {days.map((day) => {
            const dayKey = day.toISOString().slice(0, 10);
            const dayEvents = overview.events.filter(
              (event) => event.startAt.slice(0, 10) === dayKey && !event.deletedAt
            );
            const dayBlocks = overview.workBlockInstances.filter(
              (block) => block.dateKey === dayKey
            );
            const dayTimeboxes = overview.timeboxes.filter(
              (timebox) => timebox.startsAt.slice(0, 10) === dayKey
            );

            return (
              <div
                key={dayKey}
                data-calendar-day={dayKey}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("[data-calendar-item='true']")) {
                    return;
                  }
                  setMenuState({
                    kind: "day",
                    dayKey,
                    position: { x: event.clientX, y: event.clientY }
                  });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const eventId =
                    event.dataTransfer.getData("text/forge-event-id") || draggedEventId;
                  if (eventId) {
                    const calendarEvent = overview.events.find((entry) => entry.id === eventId);
                    if (calendarEvent) {
                      void moveEventToDay(calendarEvent, day);
                    }
                    setDraggedEventId(null);
                    return;
                  }

                  const timeboxId =
                    event.dataTransfer.getData("text/forge-timebox-id") || draggedTimeboxId;
                  if (!timeboxId) {
                    return;
                  }
                  const timebox = overview.timeboxes.find((entry) => entry.id === timeboxId);
                  if (!timebox) {
                    return;
                  }
                  const sourceStart = new Date(timebox.startsAt);
                  const sourceEnd = new Date(timebox.endsAt);
                  const duration = sourceEnd.getTime() - sourceStart.getTime();
                  const nextStart = new Date(day);
                  nextStart.setUTCHours(
                    sourceStart.getUTCHours(),
                    sourceStart.getUTCMinutes(),
                    0,
                    0
                  );
                  const nextEnd = new Date(nextStart.getTime() + duration);
                  void moveTimeboxMutation.mutateAsync({
                    timeboxId,
                    startsAt: nextStart.toISOString(),
                    endsAt: nextEnd.toISOString()
                  });
                  setDraggedTimeboxId(null);
                }}
                className="min-w-0 overflow-hidden rounded-[24px] border border-white/6 bg-white/[0.03] p-3 transition hover:border-white/12 hover:bg-white/[0.045]"
              >
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[rgba(10,16,30,0.96)] px-3 py-2 text-sm font-medium text-white">
                  <span className="min-w-0 truncate">{formatWeekday(day)}</span>
                  <button
                    type="button"
                    aria-label={`Open actions for ${formatWeekday(day)}`}
                    className="rounded-full bg-white/[0.06] p-2 text-white/58 transition hover:bg-white/[0.1] hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuState({
                        kind: "day",
                        dayKey,
                        position: { x: event.clientX, y: event.clientY }
                      });
                    }}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </div>
                <div className="mt-3 grid min-w-0 gap-2">
                  {dayBlocks.map((block) => (
                    <div
                      key={block.id}
                      data-calendar-item="true"
                      className="min-w-0 overflow-hidden rounded-[18px] px-3 py-2 text-sm text-white"
                      style={{
                        backgroundColor: `${block.color}22`,
                        border: `1px solid ${block.color}55`
                      }}
                    >
                      {(() => {
                        const actionLoad = estimateWorkBlockActionPointLoad(block);
                        return (
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="min-w-0 [overflow-wrap:anywhere] font-medium">{block.title}</div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                            <Badge size="sm" className="shrink-0 bg-white/[0.08] text-white/78">
                              {block.blockingState}
                            </Badge>
                            <Badge size="sm" className="shrink-0 bg-white/[0.08] text-white/78">
                              {formatWorkBlockKindLabel(block.kind)}
                            </Badge>
                            {actionLoad.rateApPerHour > 0 ? (
                              <>
                                <Badge size="sm" className="shrink-0 bg-[var(--primary)]/14 text-[var(--primary)]">
                                  {formatLifeForceRate(actionLoad.rateApPerHour)}
                                </Badge>
                                <Badge size="sm" className="shrink-0 bg-white/[0.08] text-white/72">
                                  {formatLifeForceAp(actionLoad.totalAp)}
                                </Badge>
                              </>
                            ) : (
                              <Badge size="sm" className="shrink-0 bg-emerald-400/12 text-emerald-100">
                                Recovery
                              </Badge>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Open actions for ${block.title}`}
                          className="rounded-full bg-white/[0.05] p-1.5 text-white/56 transition hover:bg-white/[0.1] hover:text-white"
                          onClick={(menuEvent) => {
                            menuEvent.stopPropagation();
                            setMenuState({
                              kind: "work-block",
                              templateId: block.templateId,
                              position: { x: menuEvent.clientX, y: menuEvent.clientY }
                            });
                          }}
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </div>
                        );
                      })()}
                      <div className="mt-1 text-white/60">
                        {new Date(block.startAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}{" "}
                        -{" "}
                        {new Date(block.endAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </div>
                      <div className="mt-2 text-xs text-white/48">
                        {formatTemplateDateRange(
                          overview.workBlockTemplates.find((template) => template.id === block.templateId) ?? {
                            id: block.templateId,
                            title: block.title,
                            kind: block.kind,
                            color: block.color,
                            timezone: "UTC",
                            weekDays: [],
                            startMinute: 0,
                            endMinute: 0,
                            startsOn: null,
                            endsOn: null,
                            blockingState: block.blockingState,
                            actionProfile: null,
                            createdAt: block.createdAt,
                            updatedAt: block.updatedAt
                          }
                        )}
                      </div>
                    </div>
                  ))}

                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      data-calendar-item="true"
                      draggable
                      onDragStart={(dragEvent) => {
                        setDraggedEventId(event.id);
                        dragEvent.dataTransfer.setData("text/forge-event-id", event.id);
                      }}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        setSelectedEvent(event);
                        setEventSeed(null);
                        setEventDialogOpen(true);
                      }}
                      className={`min-w-0 cursor-move overflow-hidden rounded-[18px] px-3 py-2 text-left text-sm text-white/82 transition ${
                        displayPreferences.useCalendarColors
                          ? "hover:brightness-110"
                          : "border border-white/10 bg-white/[0.05] hover:border-white/18 hover:bg-white/[0.08] hover:shadow-[0_12px_32px_rgba(4,9,20,0.22)]"
                      }`}
                      style={
                        displayPreferences.useCalendarColors
                          ? {
                              backgroundColor: `${(event.calendarId ? calendarDisplayColors[event.calendarId] : null) ?? getFallbackCalendarColor(`origin:${event.originType}`)}1f`,
                              border: `1px solid ${((event.calendarId ? calendarDisplayColors[event.calendarId] : null) ?? getFallbackCalendarColor(`origin:${event.originType}`))}55`
                            }
                          : undefined
                      }
                    >
                      {(() => {
                        const actionLoad = estimateCalendarEventActionPointLoad(event);
                        return (
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 [overflow-wrap:anywhere] font-medium">{event.title}</div>
                          <div className="mt-1 text-white/55">
                            {new Date(event.startAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit"
                            })}{" "}
                            -{" "}
                            {new Date(event.endAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Open quick actions for ${event.title}`}
                            className="rounded-full bg-white/[0.05] p-1.5 text-white/56 transition hover:bg-white/[0.1] hover:text-white"
                            onClick={(menuEvent) => {
                              menuEvent.stopPropagation();
                              setMenuState({
                                kind: "event",
                                eventId: event.id,
                                position: { x: menuEvent.clientX, y: menuEvent.clientY }
                              });
                            }}
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </div>
                      </div>
                        );
                      })()}
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                        <Badge size="sm" className="max-w-full bg-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/70">
                          {getEventBadgeLabel(event, calendarTitleById)}
                        </Badge>
                        {estimateCalendarEventActionPointLoad(event).rateApPerHour > 0 ? (
                          <>
                            <Badge size="sm" className="bg-[var(--primary)]/14 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--primary)]">
                              {formatLifeForceRate(estimateCalendarEventActionPointLoad(event).rateApPerHour)}
                            </Badge>
                            <Badge size="sm" className="bg-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/70">
                              {formatLifeForceAp(estimateCalendarEventActionPointLoad(event).totalAp)}
                            </Badge>
                          </>
                        ) : null}
                        {event.calendarId && displayPreferences.useCalendarColors ? (
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: calendarDisplayColors[event.calendarId] }}
                          />
                        ) : null}
                      </div>
                      {event.place.address || event.place.timezone ? (
                        <div className="mt-2 text-xs leading-5 text-white/50">
                          {event.place.address || event.location}
                          {event.place.address && event.place.timezone
                            ? " · "
                            : ""}
                          {event.place.timezone}
                        </div>
                      ) : null}
                      {event.links.length > 0 ? (
                        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                          {event.links.slice(0, 3).map((link) => {
                            const entityKind = getEntityKindForCrudEntityType(
                              link.entityType
                            );
                            return entityKind ? (
                              <EntityBadge
                                key={link.id}
                                kind={entityKind}
                                label={
                                  linkLabelByKey.get(`${link.entityType}:${link.entityId}`) ??
                                  link.entityType
                                }
                                compact
                                gradient={false}
                              />
                            ) : (
                              <Badge key={link.id} className="bg-white/[0.08] text-white/72">
                                {link.entityType}
                              </Badge>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ))}

                  {dayTimeboxes.map((timebox) => (
                    <div
                      key={timebox.id}
                      data-calendar-item="true"
                      draggable
                      onDragStart={(event) => {
                        setDraggedTimeboxId(timebox.id);
                        event.dataTransfer.setData("text/forge-timebox-id", timebox.id);
                      }}
                      onClick={() => {
                        setSelectedTimebox(timebox);
                        setTimeboxDialogOpen(true);
                      }}
                      className="min-w-0 overflow-hidden cursor-move rounded-[18px] bg-[var(--primary)]/14 px-3 py-2 text-sm text-[var(--primary)] shadow-[inset_0_0_0_1px_rgba(192,193,255,0.18)]"
                    >
                      {(() => {
                        const actionLoad = estimateTaskTimeboxActionPointLoad(timebox);
                        return (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0 [overflow-wrap:anywhere] font-medium">{timebox.title}</div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge size="sm" className="shrink-0 bg-white/[0.08] text-white/78">
                            {timebox.status}
                          </Badge>
                          <Badge size="sm" className="shrink-0 bg-white/[0.08] text-white/78">
                            {formatLifeForceRate(actionLoad.rateApPerHour)}
                          </Badge>
                        </div>
                      </div>
                        );
                      })()}
                      <div className="mt-1 flex items-center gap-2 text-white/70">
                        <Clock3 className="size-3.5" />
                        {new Date(timebox.startsAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}{" "}
                        -{" "}
                        {new Date(timebox.endsAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </div>
                      <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/56">
                        {formatLifeForceAp(estimateTaskTimeboxActionPointLoad(timebox).totalAp)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedTimebox(timebox);
                            setTimeboxDialogOpen(true);
                          }}
                          className="rounded-[999px] bg-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/78 transition hover:bg-white/[0.14]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/tasks/${timebox.taskId}`);
                          }}
                          className="rounded-[999px] bg-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/78 transition hover:bg-white/[0.14]"
                        >
                          Open task
                        </button>
                      </div>
                    </div>
                  ))}

                  {dayBlocks.length === 0 && dayEvents.length === 0 && dayTimeboxes.length === 0 ? (
                    <div className="min-h-[10rem] rounded-[18px] border border-dashed border-white/8 px-3 py-4 text-sm leading-8 text-white/42">
                      Nothing scheduled here yet. Click inside this day to create, block, or paste.
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
            <div className="flex items-center gap-3">
              <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
                <PencilLine className="size-4" />
              </div>
              <div>
                <div className="font-medium text-white">Create event</div>
                <div className="mt-1 text-sm text-white/56">
                  Add a native Forge event with linked context.
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/62">
              Create a real calendar event even with no provider connected, then project it remotely whenever you choose.
            </p>
            <div className="mt-4">
              <Button
                onClick={() => {
                  setSelectedWorkBlockTemplate(null);
                  setSelectedEvent(null);
                  setEventSeed(null);
                  setEventDialogOpen(true);
                }}
              >
                <PencilLine className="size-4" />
                Open event guide
              </Button>
            </div>
          </Card>

          <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
            <div className="flex items-center gap-3">
              <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
                <ShieldBan className="size-4" />
              </div>
              <div>
                <div className="font-medium text-white">Create work block</div>
                <div className="mt-1 text-sm text-white/56">
                  Block main activity or protect creative windows.
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/62">
              Open the guided flow to create half-day presets, holidays, or custom recurring work blocks.
            </p>
            <div className="mt-4">
              <Button
                onClick={() => {
                  setSelectedWorkBlockTemplate(null);
                  setWorkBlockDialogOpen(true);
                }}
              >
                <ShieldBan className="size-4" />
                Open work-block guide
              </Button>
            </div>
          </Card>

          <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
            <div className="flex items-center gap-3">
              <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
                <Sparkles className="size-4" />
              </div>
              <div>
                <div className="font-medium text-white">Plan timebox</div>
                <div className="mt-1 text-sm text-white/56">
                  Let Forge recommend valid upcoming slots.
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/62">
              Choose a task, review the suggested windows, and schedule directly into the calendar.
            </p>
            <div className="mt-4">
              <Button onClick={() => setTimeboxDialogOpen(true)}>
                <Sparkles className="size-4" />
                Open planning guide
              </Button>
            </div>
          </Card>

          <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
            <div className="flex items-center gap-3">
              <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
                <Link2 className="size-4" />
              </div>
              <div>
                <div className="font-medium text-white">Manage provider settings</div>
                <div className="mt-1 text-sm text-white/56">{providerHealthLabel}</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/62">
              Provider connections and setup instructions now live in Settings so the calendar view can stay focused on the week.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate("/settings/calendar")}>
                <ArrowUpRight className="size-4" />
                Open calendar settings
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate("/settings/calendar?intent=connect")}
              >
                <Link2 className="size-4" />
                Connect provider
              </Button>
            </div>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  This week
                </div>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  Quick status for the currently visible week.
                </p>
              </div>
              <Button variant="secondary" onClick={() => void calendarQuery.refetch()}>
                <RefreshCcw className="size-4" />
                Refresh view
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
                <div className="text-sm text-white/54">Provider events</div>
                <div className="mt-2 font-display text-3xl text-white">{overview.events.length}</div>
              </div>
              <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
                <div className="text-sm text-white/54">Work blocks</div>
                <div className="mt-2 font-display text-3xl text-white">
                  {overview.workBlockInstances.length}
                </div>
              </div>
              <div className="rounded-[22px] bg-white/[0.04] px-4 py-4">
                <div className="text-sm text-white/54">Planned timeboxes</div>
                <div className="mt-2 font-display text-3xl text-white">
                  {plannedTimeboxes.length}
                </div>
              </div>
            </div>
          </Card>

          <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Guided actions</div>
            <div className="mt-3 grid gap-3">
              <button
                type="button"
                onClick={() => setTaskRulesDialogOpen(true)}
                className="rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-4 text-left transition hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-white">Adjust task blocking rules</div>
                  <Badge className="bg-white/[0.08] text-white/74">Guided</Badge>
                </div>
                <div className="mt-2 text-sm leading-6 text-white/58">
                  Decide which work blocks, calendar conditions, and event keywords should block or allow a task.
                </div>
              </button>

              <div className="rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-white">Active templates</div>
                  <Badge className="bg-white/[0.08] text-white/74">
                    {overview.workBlockTemplates.length}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  {overview.workBlockTemplates.slice(0, 4).map((template) => (
                    <div
                      key={template.id}
                      className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-sm text-white/74"
                    >
                      <div className="font-medium text-white">{template.title}</div>
                      <div className="mt-1 text-white/56">
                        {formatWorkBlockKindLabel(template.kind)} · {template.weekDays.length} day
                        {template.weekDays.length === 1 ? "" : "s"} · {template.blockingState}
                      </div>
                      <div className="mt-1 text-white/46">{formatTemplateDateRange(template)}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedWorkBlockTemplate(template);
                            setWorkBlockDialogOpen(true);
                          }}
                        >
                          <PencilLine className="size-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void deleteWorkBlockMutation.mutateAsync(template.id)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                  {overview.workBlockTemplates.length === 0 ? (
                    <div className="text-sm text-white/52">
                      No recurring templates yet. Open the work-block guide to create the first one.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <WorkBlockFlowDialog
        open={workBlockDialogOpen}
        onOpenChange={(open) => {
          setWorkBlockDialogOpen(open);
          if (!open) {
            setSelectedWorkBlockTemplate(null);
          }
        }}
        pending={createWorkBlockMutation.isPending || patchWorkBlockMutation.isPending}
        template={selectedWorkBlockTemplate}
        onSubmit={async (input) => {
          if (selectedWorkBlockTemplate) {
            await patchWorkBlockMutation.mutateAsync({
              templateId: selectedWorkBlockTemplate.id,
              patch: input
            });
            return;
          }
          await createWorkBlockMutation.mutateAsync(input);
        }}
      />

      <TaskSchedulingDialog
        open={taskRulesDialogOpen}
        onOpenChange={setTaskRulesDialogOpen}
        tasks={shell.snapshot.tasks}
        onSave={async ({ taskId, schedulingRules, plannedDurationSeconds }) => {
          await patchTask(taskId, {
            schedulingRules,
            plannedDurationSeconds
          });
          await shell.refresh();
          await invalidateCalendar();
          await queryClient.invalidateQueries({ queryKey: ["task-context", taskId] });
        }}
      />

      <TimeboxPlanningDialog
        open={timeboxDialogOpen}
        onOpenChange={(open) => {
          setTimeboxDialogOpen(open);
          if (!open) {
            setSelectedTimebox(null);
          }
        }}
        tasks={shell.snapshot.tasks}
        editingTimebox={selectedTimebox}
        from={range.from}
        to={range.to}
        onCreateTimebox={async (input) => {
          await createTimeboxMutation.mutateAsync(input);
        }}
        onUpdateTimebox={async (timeboxId, patch) => {
          await patchTimeboxMutation.mutateAsync({
            timeboxId,
            patch
          });
        }}
      />

      <CalendarEventFlowDialog
        open={eventDialogOpen}
        onOpenChange={(open) => {
          setEventDialogOpen(open);
          if (!open) {
            setSelectedEvent(null);
            setEventSeed(null);
          }
        }}
        writableCalendars={writableCalendars}
        linkOptions={linkOptions}
        event={selectedEvent}
        seed={eventSeed ?? undefined}
        onSubmit={async (input) => {
          if (selectedEvent) {
            const selectedEventId = selectedEvent.id;
            setEventDialogOpen(false);
            setSelectedEvent(null);
            setEventSeed(null);
            void patchEventMutation
              .mutateAsync({
                eventId: selectedEventId,
                patch: input
              })
              .catch(() => undefined);
            return;
          } else {
            setEventDialogOpen(false);
            setSelectedEvent(null);
            setEventSeed(null);
            void createEventMutation.mutateAsync(input).catch(() => undefined);
            return;
          }
        }}
        pending={createEventMutation.isPending || patchEventMutation.isPending}
      />

      <CalendarQuickRenameDialog
        open={renameEvent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameEvent(null);
          }
        }}
        initialTitle={renameEvent?.title ?? ""}
        pending={patchEventMutation.isPending}
        onSubmit={async (title) => {
          if (!renameEvent) {
            return;
          }
          const renameEventId = renameEvent.id;
          setRenameEvent(null);
          void patchEventMutation
            .mutateAsync({
              eventId: renameEventId,
              patch: { title }
            })
            .catch(() => undefined);
        }}
      />

      <FloatingActionMenu
        open={menuState !== null}
        title={
          menuState?.kind === "event"
            ? overview.events.find((entry) => entry.id === menuState.eventId)?.title ?? "Event actions"
            : menuState?.kind === "work-block"
              ? overview.workBlockTemplates.find((entry) => entry.id === menuState.templateId)?.title ?? "Work block actions"
            : menuState?.kind === "day"
              ? formatWeekday(days.find((entry) => entry.toISOString().slice(0, 10) === menuState.dayKey) ?? weekStart)
              : "Calendar actions"
        }
        subtitle={
          menuState?.kind === "day"
            ? "Choose what to create or paste into this day."
            : menuState?.kind === "work-block"
              ? "Edit or remove this recurring work block."
            : clipboardEntry
              ? `Clipboard ready: ${clipboardEntry.label}`
              : "Quick calendar event actions."
        }
        items={activeMenuItems}
        position={menuState?.position ?? null}
        onClose={() => setMenuState(null)}
      />
    </div>
  );
}
