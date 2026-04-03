import type {
  CalendarAvailability,
  CalendarOverviewPayload,
  CalendarSchedulingRules,
  Task,
  WorkBlockKind
} from "@/lib/types";

export const EMPTY_CALENDAR_RULES: CalendarSchedulingRules = {
  allowWorkBlockKinds: [],
  blockWorkBlockKinds: [],
  allowCalendarIds: [],
  blockCalendarIds: [],
  allowEventTypes: [],
  blockEventTypes: [],
  allowEventKeywords: [],
  blockEventKeywords: [],
  allowAvailability: [],
  blockAvailability: []
};

function normalizeKeywordList(values: string[]) {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function matchesKeywordRule(
  keywords: string[],
  haystack: Array<string | null | undefined>
) {
  const normalizedKeywords = normalizeKeywordList(keywords);
  if (normalizedKeywords.length === 0) {
    return false;
  }
  const content = haystack.join(" ").toLowerCase();
  return normalizedKeywords.some((keyword) => content.includes(keyword));
}

function hasExplicitAllowRules(rules: CalendarSchedulingRules) {
  return (
    rules.allowWorkBlockKinds.length > 0 ||
    rules.allowCalendarIds.length > 0 ||
    rules.allowEventTypes.length > 0 ||
    rules.allowEventKeywords.length > 0 ||
    rules.allowAvailability.length > 0
  );
}

export function resolveEffectiveSchedulingRules(
  taskRules: CalendarSchedulingRules | null | undefined,
  projectRules: CalendarSchedulingRules | null | undefined
) {
  return taskRules ?? projectRules ?? EMPTY_CALENDAR_RULES;
}

export function evaluateSchedulingRulesNow(input: {
  rules: CalendarSchedulingRules | null | undefined;
  overview: CalendarOverviewPayload | undefined;
  at?: Date;
}) {
  const rules = input.rules ?? EMPTY_CALENDAR_RULES;
  const at = input.at ?? new Date();
  const instant = at.getTime();
  const overview = input.overview;
  const currentBlocks =
    overview?.workBlockInstances.filter((block) => {
      const start = new Date(block.startAt).getTime();
      const end = new Date(block.endAt).getTime();
      return start <= instant && instant < end;
    }) ?? [];
  const currentEvents =
    overview?.events.filter((event) => {
      if (event.deletedAt) {
        return false;
      }
      const start = new Date(event.startAt).getTime();
      const end = new Date(event.endAt).getTime();
      return start <= instant && instant < end;
    }) ?? [];

  const conflicts: string[] = [];

  const blockMatch =
    currentBlocks.some((block) => rules.blockWorkBlockKinds.includes(block.kind)) ||
    currentEvents.some(
      (event) =>
        (event.calendarId ? rules.blockCalendarIds.includes(event.calendarId) : false) ||
        rules.blockEventTypes.includes(event.eventType) ||
        rules.blockAvailability.includes(event.availability) ||
        matchesKeywordRule(rules.blockEventKeywords, [
          event.title,
          event.description,
          event.location,
          ...event.categories
        ])
    );

  if (blockMatch) {
    if (currentBlocks.some((block) => rules.blockWorkBlockKinds.includes(block.kind))) {
      conflicts.push("The current work block is marked as blocked.");
    }
    if (currentEvents.some((event) => (event.calendarId ? rules.blockCalendarIds.includes(event.calendarId) : false))) {
      conflicts.push("The active calendar belongs to a blocked calendar source.");
    }
    if (currentEvents.some((event) => rules.blockEventTypes.includes(event.eventType))) {
      conflicts.push("The active calendar event type is blocked.");
    }
    if (currentEvents.some((event) => rules.blockAvailability.includes(event.availability))) {
      conflicts.push("The active calendar availability is blocked.");
    }
    if (
      currentEvents.some((event) =>
        matchesKeywordRule(rules.blockEventKeywords, [
          event.title,
          event.description,
          event.location,
          ...event.categories
        ])
      )
    ) {
      conflicts.push("The active calendar event matches a blocked keyword.");
    }
  }

  const requiresAllowMatch = hasExplicitAllowRules(rules);
  const allowedMatch =
    currentBlocks.some((block) => rules.allowWorkBlockKinds.includes(block.kind as WorkBlockKind)) ||
    currentEvents.some(
      (event) =>
        (event.calendarId ? rules.allowCalendarIds.includes(event.calendarId) : false) ||
        rules.allowEventTypes.includes(event.eventType) ||
        rules.allowAvailability.includes(event.availability as CalendarAvailability) ||
        matchesKeywordRule(rules.allowEventKeywords, [
          event.title,
          event.description,
          event.location,
          ...event.categories
        ])
    );

  if (!blockMatch && requiresAllowMatch && !allowedMatch) {
    conflicts.push("The current calendar context does not match the allowed rules yet.");
  }

  const context: string[] = [
    ...currentBlocks.map((block) => `${block.title} (${block.kind.replaceAll("_", " ")})`),
    ...currentEvents.map((event) => event.title)
  ];

  if (conflicts.length > 0) {
    return {
      blocked: true,
      label: "Blocked right now",
      tone: "blocked" as const,
      conflicts,
      context
    };
  }

  if (context.length > 0) {
    return {
      blocked: false,
      label: "Allowed right now",
      tone: "allowed" as const,
      conflicts: [],
      context
    };
  }

  return {
    blocked: false,
    label: requiresAllowMatch ? "Waiting for an allowed calendar context" : "No live calendar conflict right now",
    tone: requiresAllowMatch ? ("waiting" as const) : ("allowed" as const),
    conflicts: [],
    context: []
  };
}

export function getTaskSchedulingRules(task: Task, projectRules: CalendarSchedulingRules | null | undefined) {
  return resolveEffectiveSchedulingRules(task.schedulingRules, projectRules);
}
