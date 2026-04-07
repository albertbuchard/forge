import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "./db.js";
import { HttpError } from "./errors.js";
import { updateWorkoutMetadata } from "./health.js";
import { listMovementPlaces, updateMovementPlace } from "./movement.js";
import { listHabits } from "./repositories/habits.js";

const watchCapability = "watch-ready";

const watchHistoryStateSchema = z.enum(["aligned", "unaligned", "unknown"]);
const watchPromptKindSchema = z.enum([
  "new_place",
  "trip_label",
  "workout_annotation",
  "social_follow_up",
  "unknown_block",
  "routine_check"
]);
const watchCaptureEventTypeSchema = z.enum([
  "activity_check_in",
  "emotion_check_in",
  "mark_moment",
  "trigger_capture",
  "place_label",
  "trip_label",
  "social_context",
  "workout_annotation",
  "routine_check",
  "dictated_note",
  "retrospective_label"
]);

const watchDeviceSchema = z.object({
  name: z.string().trim().default("Apple Watch"),
  platform: z.string().trim().default("watchos"),
  appVersion: z.string().trim().default(""),
  sourceDevice: z.string().trim().default("Apple Watch")
});

const watchLinkedContextSchema = z.object({
  placeId: z.string().trim().min(1).optional(),
  stayId: z.string().trim().min(1).optional(),
  tripId: z.string().trim().min(1).optional(),
  workoutId: z.string().trim().min(1).optional()
});

const watchCaptureEventSchema = z.object({
  dedupeKey: z.string().trim().min(1),
  eventType: watchCaptureEventTypeSchema,
  recordedAt: z.string().datetime(),
  promptId: z.string().trim().min(1).nullable().optional().default(null),
  linkedContext: watchLinkedContextSchema.default({}),
  payload: z.record(z.string(), z.unknown()).default({})
});

export const mobileWatchBootstrapSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1)
});

export const mobileWatchHabitCheckInSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1),
  dedupeKey: z.string().trim().min(1),
  dateKey: z.string().trim().min(1).default(new Date().toISOString().slice(0, 10)),
  status: z.enum(["done", "missed"]),
  note: z.string().trim().default("")
});

export const mobileWatchCaptureBatchSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1),
  device: watchDeviceSchema.default({}),
  events: z.array(watchCaptureEventSchema).max(100).default([])
});

type PairingSessionLike = {
  id: string;
  user_id: string;
  capability_flags_json?: string;
};

type WatchCaptureEventRow = {
  id: string;
  pairing_session_id: string | null;
  user_id: string;
  dedupe_key: string;
  source_device: string;
  event_type: z.infer<typeof watchCaptureEventTypeSchema>;
  prompt_id: string | null;
  recorded_at: string;
  received_at: string;
  linked_context_json: string;
  payload_json: string;
  projection_status: string;
  projection_details_json: string;
  created_at: string;
};

type WorkoutPromptRow = {
  id: string;
  workout_type: string;
  started_at: string;
  mood_after: string;
  meaning_text: string;
  subjective_effort: number | null;
};

type MovementTripPromptRow = {
  id: string;
  label: string;
  started_at: string;
  tags_json: string;
  metadata_json: string;
};

type MovementStayPromptRow = {
  id: string;
  label: string;
  started_at: string;
  metadata_json: string;
};

type WatchProjectionResult = {
  status: "stored" | "projected" | "projection_failed";
  details: Record<string, unknown>;
};

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcWeek(date: Date) {
  const start = startOfUtcDay(date);
  const offset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - offset);
  return start;
}

function isAlignedCheckIn(
  habit: { polarity: "positive" | "negative" },
  status: "done" | "missed"
) {
  return (
    (habit.polarity === "positive" && status === "done") ||
    (habit.polarity === "negative" && status === "missed")
  );
}

function alignedActionLabel(polarity: "positive" | "negative") {
  return polarity === "positive" ? "Done" : "Resisted";
}

function unalignedActionLabel(polarity: "positive" | "negative") {
  return polarity === "positive" ? "Missed" : "Performed";
}

function formatCadenceLabel(habit: {
  frequency: "daily" | "weekly";
  targetCount: number;
  weekDays: number[];
}) {
  if (habit.frequency === "daily") {
    return `${habit.targetCount}x daily`;
  }
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const labels = habit.weekDays.map((day) => weekdayLabels[day]).join(", ");
  return `${habit.targetCount}x weekly${labels ? ` · ${labels}` : ""}`;
}

function buildHabitHistory(habit: {
  frequency: "daily" | "weekly";
  polarity: "positive" | "negative";
  checkIns: Array<{ dateKey: string; status: "done" | "missed" }>;
}) {
  const now = new Date();

  if (habit.frequency === "daily") {
    const today = startOfUtcDay(now);
    return Array.from({ length: 7 }, (_, index) => {
      const offset = index - 6;
      const date = addUtcDays(today, offset);
      const dateKey = formatDateKey(date);
      const checkIn = habit.checkIns.find((entry) => entry.dateKey === dateKey) ?? null;
      return {
        id: dateKey,
        label: ["S", "M", "T", "W", "T", "F", "S"][date.getUTCDay()],
        periodKey: dateKey,
        current: offset === 0,
        state: checkIn
          ? isAlignedCheckIn(habit, checkIn.status)
            ? "aligned"
            : "unaligned"
          : "unknown"
      };
    });
  }

  const thisWeek = startOfUtcWeek(now);
  return Array.from({ length: 7 }, (_, index) => {
    const offset = index - 6;
    const weekStart = addUtcDays(thisWeek, offset * 7);
    const weekKey = formatDateKey(weekStart);
    const weekEntries = habit.checkIns.filter((entry) => {
      const entryWeek = formatDateKey(startOfUtcWeek(parseDateKey(entry.dateKey)));
      return entryWeek === weekKey;
    });
    const alignedCount = weekEntries.filter((entry) =>
      isAlignedCheckIn(habit, entry.status)
    ).length;
    const unalignedCount = weekEntries.length - alignedCount;
    return {
      id: weekKey,
      label: offset === 0 ? "Now" : `${Math.abs(offset)}w`,
      periodKey: weekKey,
      current: offset === 0,
      state:
        weekEntries.length === 0
          ? "unknown"
          : alignedCount >= unalignedCount
            ? "aligned"
            : "unaligned"
    };
  });
}

const activityOptions = [
  "Working",
  "Coding",
  "Admin",
  "Reading",
  "Commuting",
  "Walking",
  "Eating",
  "Socializing",
  "Resting",
  "Training",
  "Shopping"
];

const emotionOptions = [
  "Calm",
  "Focused",
  "Content",
  "Energized",
  "Tired",
  "Restless",
  "Low",
  "Tense",
  "Anxious",
  "Overwhelmed",
  "Relieved"
];

const triggerOptions = [
  "Conflict",
  "Pleasant moment",
  "Urge",
  "Avoidance",
  "Social exposure",
  "Setback",
  "Breakthrough",
  "Rumination",
  "Shame spike",
  "Victory"
];

const placeCategoryOptions = [
  "Home",
  "Work",
  "Clinic",
  "Grocery",
  "Gym",
  "Cafe",
  "Nature",
  "Travel",
  "Social",
  "Other"
];

const routinePromptOptions = [
  "Medication taken?",
  "Caffeine?",
  "Meal?",
  "Sunlight exposure?",
  "Wind-down started?"
];

const watchCategoryMap = new Map<string, string[]>([
  ["Home", ["home"]],
  ["Work", ["workplace"]],
  ["Clinic", ["other"]],
  ["Grocery", ["grocery"]],
  ["Gym", ["other"]],
  ["Cafe", ["other"]],
  ["Nature", ["nature"]],
  ["Travel", ["travel"]],
  ["Social", ["social"]],
  ["Other", ["other"]]
]);

function recentPeopleLabels(userId: string) {
  const labels = new Set<string>();
  const sources = [
    ...(
      getDatabase()
        .prepare(
          `SELECT linked_people_json
           FROM movement_places
           WHERE user_id = ?
           ORDER BY updated_at DESC
           LIMIT 25`
        )
        .all(userId) as Array<{ linked_people_json: string }>
    ),
    ...(
      getDatabase()
        .prepare(
          `SELECT linked_people_json
           FROM movement_trips
           WHERE user_id = ?
           ORDER BY started_at DESC
           LIMIT 25`
        )
        .all(userId) as Array<{ linked_people_json: string }>
    )
  ];

  for (const source of sources) {
    const people = safeJsonParse<Array<{ label?: string }>>(
      source.linked_people_json,
      []
    );
    for (const person of people) {
      const label = person.label?.trim();
      if (label) {
        labels.add(label);
      }
    }
  }

  const captureRows = getDatabase()
    .prepare(
      `SELECT payload_json
       FROM watch_capture_events
       WHERE user_id = ?
         AND event_type = 'social_context'
       ORDER BY recorded_at DESC
       LIMIT 25`
    )
    .all(userId) as Array<{ payload_json: string }>;
  for (const row of captureRows) {
    const payload = safeJsonParse<Record<string, unknown>>(row.payload_json, {});
    const label = typeof payload.personLabel === "string" ? payload.personLabel.trim() : "";
    if (label) {
      labels.add(label);
    }
  }

  return [...labels].slice(0, 8);
}

function buildPendingPrompts(userId: string) {
  const prompts: Array<Record<string, unknown>> = [];

  const unlabeledPlaces = listMovementPlaces([userId]).filter(
    (place) => place.categoryTags.length === 0
  );
  for (const place of unlabeledPlaces.slice(0, 2)) {
    prompts.push({
      id: `prompt_place_${place.id}`,
      kind: "new_place",
      title: "New place detected",
      message: `What is ${place.label || "this place"}?`,
      createdAt: nowIso(),
      linkedContext: { placeId: place.id },
      choices: placeCategoryOptions.slice(0, 6)
    });
  }

  const trips = getDatabase()
    .prepare(
      `SELECT id, label, started_at, tags_json, metadata_json
       FROM movement_trips
       WHERE user_id = ?
       ORDER BY started_at DESC
       LIMIT 3`
    )
    .all(userId) as MovementTripPromptRow[];
  for (const trip of trips) {
    const tags = safeJsonParse<string[]>(trip.tags_json, []);
    if (tags.length === 0) {
      prompts.push({
        id: `prompt_trip_${trip.id}`,
        kind: "trip_label",
        title: "Label this trip",
        message: trip.label || "What was this trip for?",
        createdAt: trip.started_at,
        linkedContext: { tripId: trip.id },
        choices: ["Work", "Groceries", "Gym", "Social", "Nature", "Errand"]
      });
    }
  }

  const workouts = getDatabase()
    .prepare(
      `SELECT id, workout_type, started_at, mood_after, meaning_text, subjective_effort
       FROM health_workout_sessions
       WHERE user_id = ?
       ORDER BY started_at DESC
       LIMIT 3`
    )
    .all(userId) as WorkoutPromptRow[];
  for (const workout of workouts) {
    if (
      workout.subjective_effort == null &&
      workout.mood_after.trim().length === 0 &&
      workout.meaning_text.trim().length === 0
    ) {
      prompts.push({
        id: `prompt_workout_${workout.id}`,
        kind: "workout_annotation",
        title: "How was that workout?",
        message: `Add quick context for your ${workout.workout_type}.`,
        createdAt: workout.started_at,
        linkedContext: { workoutId: workout.id },
        choices: ["Good", "Neutral", "Hard", "Restorative"]
      });
    }
  }

  const stays = getDatabase()
    .prepare(
      `SELECT id, label, started_at, metadata_json
       FROM movement_stays
       WHERE user_id = ?
       ORDER BY started_at DESC
       LIMIT 3`
    )
    .all(userId) as MovementStayPromptRow[];
  for (const stay of stays) {
    if (stay.label.trim().length === 0) {
      prompts.push({
        id: `prompt_stay_${stay.id}`,
        kind: "unknown_block",
        title: "Unknown block",
        message: "Want to label this block before it fades?",
        createdAt: stay.started_at,
        linkedContext: { stayId: stay.id },
        choices: ["Work", "Social", "Errand", "Nature", "Rest"]
      });
    }
  }

  prompts.push({
    id: "prompt_routine_evening",
    kind: "routine_check",
    title: "Quick routine check",
    message: "Capture one routine signal before it gets lost.",
    createdAt: nowIso(),
    linkedContext: {},
    choices: routinePromptOptions.slice(0, 4)
  });

  return prompts.slice(0, 8);
}

function projectionForStoredEvent(
  event: z.infer<typeof watchCaptureEventSchema>
): WatchProjectionResult {
  if (event.eventType === "place_label" && event.linkedContext.placeId) {
    const nextLabel =
      typeof event.payload.label === "string" ? event.payload.label.trim() : "";
    const categoryCandidate = Array.isArray(event.payload.categoryTags)
      ? event.payload.categoryTags
      : typeof event.payload.category === "string"
        ? watchCategoryMap.get(event.payload.category) ?? []
        : [];
    const categoryTags = categoryCandidate.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    try {
      const place = updateMovementPlace(
        event.linkedContext.placeId,
        {
          ...(nextLabel ? { label: nextLabel } : {}),
          ...(categoryTags.length > 0 ? { categoryTags } : {})
        },
        { source: "system", actor: null }
      );
      if (!place) {
        return {
          status: "projection_failed",
          details: { reason: "place_not_found" }
        };
      }
      return {
        status: "projected",
        details: {
          target: "movement_place",
          placeId: place.id,
          categoryTags: place.categoryTags
        }
      };
    } catch (error) {
      return {
        status: "projection_failed",
        details: {
          reason: "place_update_failed",
          message: error instanceof Error ? error.message : "Unknown place update error"
        }
      };
    }
  }

  if (event.eventType === "workout_annotation" && event.linkedContext.workoutId) {
    try {
      const workout = updateWorkoutMetadata(
        event.linkedContext.workoutId,
        {
          subjectiveEffort:
            typeof event.payload.subjectiveEffort === "number"
              ? Math.max(1, Math.min(10, Math.round(event.payload.subjectiveEffort)))
              : undefined,
          moodBefore:
            typeof event.payload.moodBefore === "string"
              ? event.payload.moodBefore.trim()
              : undefined,
          moodAfter:
            typeof event.payload.moodAfter === "string"
              ? event.payload.moodAfter.trim()
              : undefined,
          meaningText:
            typeof event.payload.meaningText === "string"
              ? event.payload.meaningText.trim()
              : undefined,
          socialContext:
            typeof event.payload.socialContext === "string"
              ? event.payload.socialContext.trim()
              : undefined,
          tags: Array.isArray(event.payload.tags)
            ? event.payload.tags.filter(
                (value): value is string =>
                  typeof value === "string" && value.trim().length > 0
              )
            : undefined
        },
        { source: "system", actor: null }
      );
      if (!workout) {
        return {
          status: "projection_failed",
          details: { reason: "workout_not_found" }
        };
      }
      return {
        status: "projected",
        details: {
          target: "workout",
          workoutId: workout.id
        }
      };
    } catch (error) {
      return {
        status: "projection_failed",
        details: {
          reason: "workout_update_failed",
          message: error instanceof Error ? error.message : "Unknown workout update error"
        }
      };
    }
  }

  return {
    status: "stored",
    details: {}
  };
}

export function assertWatchReady(pairing: PairingSessionLike) {
  const capabilities = safeJsonParse<string[]>(pairing.capability_flags_json, []);
  if (!capabilities.includes(watchCapability)) {
    throw new HttpError(
      403,
      "watch_pairing_not_enabled",
      "This companion pairing is not allowed to serve watch data."
    );
  }
}

export function buildWatchBootstrap(pairing: PairingSessionLike) {
  assertWatchReady(pairing);
  const habits = listHabits({ status: "active", limit: 64 })
    .filter((habit) => habit.userId === pairing.user_id || pairing.user_id === "user_operator")
    .sort((left, right) => {
      if (left.dueToday !== right.dueToday) {
        return Number(right.dueToday) - Number(left.dueToday);
      }
      if (left.streakCount !== right.streakCount) {
        return right.streakCount - left.streakCount;
      }
      return left.title.localeCompare(right.title);
    })
    .map((habit) => {
      const history = buildHabitHistory(habit);
      const currentPeriodStatus =
        history.find((entry) => entry.current)?.state ?? "unknown";
      return {
        id: habit.id,
        title: habit.title,
        polarity: habit.polarity,
        frequency: habit.frequency,
        targetCount: habit.targetCount,
        weekDays: habit.weekDays,
        streakCount: habit.streakCount,
        dueToday: habit.dueToday,
        cadenceLabel: formatCadenceLabel(habit),
        alignedActionLabel: alignedActionLabel(habit.polarity),
        unalignedActionLabel: unalignedActionLabel(habit.polarity),
        currentPeriodStatus,
        last7History: history
      };
    });

  return {
    generatedAt: nowIso(),
    habits,
    checkInOptions: {
      activities: activityOptions,
      emotions: emotionOptions,
      triggers: triggerOptions,
      placeCategories: placeCategoryOptions,
      routinePrompts: routinePromptOptions,
      recentPeople: recentPeopleLabels(pairing.user_id)
    },
    pendingPrompts: buildPendingPrompts(pairing.user_id)
  };
}

export function ingestWatchCaptureBatch(
  pairing: PairingSessionLike,
  input: z.infer<typeof mobileWatchCaptureBatchSchema>
) {
  assertWatchReady(pairing);
  const parsed = mobileWatchCaptureBatchSchema.parse(input);
  const insert = getDatabase().prepare(
    `INSERT INTO watch_capture_events (
       id, pairing_session_id, user_id, dedupe_key, source_device, event_type, prompt_id,
       recorded_at, received_at, linked_context_json, payload_json,
       projection_status, projection_details_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateProjection = getDatabase().prepare(
    `UPDATE watch_capture_events
     SET projection_status = ?, projection_details_json = ?
     WHERE id = ?`
  );
  const existing = getDatabase().prepare(
    `SELECT id
     FROM watch_capture_events
     WHERE user_id = ? AND dedupe_key = ?`
  );

  return runInTransaction(() => {
    let storedCount = 0;
    let duplicateCount = 0;
    let projectedCount = 0;
    let projectionFailedCount = 0;

    for (const event of parsed.events) {
      const duplicate = existing.get(pairing.user_id, event.dedupeKey) as
        | { id: string }
        | undefined;
      if (duplicate) {
        duplicateCount += 1;
        continue;
      }

      const id = `watchcap_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const receivedAt = nowIso();
      insert.run(
        id,
        pairing.id,
        pairing.user_id,
        event.dedupeKey,
        parsed.device.sourceDevice,
        event.eventType,
        event.promptId,
        event.recordedAt,
        receivedAt,
        JSON.stringify(event.linkedContext),
        JSON.stringify(event.payload),
        "stored",
        "{}",
        receivedAt
      );
      storedCount += 1;

      const projection = projectionForStoredEvent(event);
      updateProjection.run(
        projection.status,
        JSON.stringify(projection.details),
        id
      );
      if (projection.status === "projected") {
        projectedCount += 1;
      } else if (projection.status === "projection_failed") {
        projectionFailedCount += 1;
      }
    }

    return {
      receivedCount: parsed.events.length,
      storedCount,
      duplicateCount,
      projectedCount,
      projectionFailedCount
    };
  });
}
