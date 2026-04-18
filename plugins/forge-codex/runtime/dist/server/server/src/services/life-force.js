import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { getDefaultUser, getUserById } from "../repositories/users.js";
import { actionProfileSchema, fatigueSignalCreateSchema, lifeForcePayloadSchema, lifeForceProfilePatchSchema, lifeForceTemplateUpdateSchema } from "../types.js";
import { LIFE_FORCE_BASELINE_DAILY_AP, buildDefaultTaskActionProfile, buildTaskActionPointSummary, buildTaskSplitSuggestion, clamp, computeActionCostModifier, computeLifeForceLevelMultiplier, computeStatCostModifier, interpolateCurveRate, normalizeCurveToBudget, resolveBandTotalCostAp, resolveTaskExpectedDurationSeconds } from "./life-force-model.js";
import { computeWorkTime } from "./work-time.js";
const DEFAULT_TEMPLATE_POINTS = [
    { minuteOfDay: 0, rateApPerHour: 0 },
    { minuteOfDay: 7 * 60, rateApPerHour: 0 },
    { minuteOfDay: 8 * 60, rateApPerHour: 8 },
    { minuteOfDay: 10 * 60, rateApPerHour: 13 },
    { minuteOfDay: 13 * 60, rateApPerHour: 9 },
    { minuteOfDay: 14 * 60, rateApPerHour: 11 },
    { minuteOfDay: 19 * 60, rateApPerHour: 7 },
    { minuteOfDay: 23 * 60, rateApPerHour: 0 },
    { minuteOfDay: 24 * 60, rateApPerHour: 0 }
];
const LIFE_FORCE_STAT_LABELS = {
    life_force: "Life Force",
    activation: "Activation",
    focus: "Focus",
    vigor: "Vigor",
    composure: "Composure",
    flow: "Flow"
};
const CALENDAR_ACTIVITY_PRESETS = {
    deep_work: {
        title: "Deep work",
        mode: "container",
        sustainRateApPerHour: 14,
        demandWeights: {
            activation: 0.1,
            focus: 0.55,
            vigor: 0.05,
            composure: 0.05,
            flow: 0.25
        },
        doubleCountPolicy: "container_only",
        costBand: "light",
        recoveryEffect: 0,
        metadata: {
            physicalIntensity: 0.15,
            cognitiveDemand: 0.9,
            socialLoad: 0.1,
            switchingLoad: 0.2
        }
    },
    admin: {
        title: "Admin and coordination",
        mode: "container",
        sustainRateApPerHour: 9,
        demandWeights: {
            activation: 0.15,
            focus: 0.3,
            vigor: 0.05,
            composure: 0.1,
            flow: 0.4
        },
        doubleCountPolicy: "container_only",
        costBand: "light",
        recoveryEffect: 0,
        metadata: {
            physicalIntensity: 0.1,
            cognitiveDemand: 0.45,
            socialLoad: 0.25,
            switchingLoad: 0.7
        }
    },
    maintenance: {
        title: "Maintenance and light activity",
        mode: "container",
        sustainRateApPerHour: 6,
        demandWeights: {
            activation: 0.15,
            focus: 0.2,
            vigor: 0.1,
            composure: 0.05,
            flow: 0.5
        },
        doubleCountPolicy: "container_only",
        costBand: "light",
        recoveryEffect: 0,
        metadata: {
            physicalIntensity: 0.2,
            cognitiveDemand: 0.25,
            socialLoad: 0.1,
            switchingLoad: 0.5
        }
    },
    meeting: {
        title: "Meeting or social commitment",
        mode: "container",
        sustainRateApPerHour: 13,
        demandWeights: {
            activation: 0.05,
            focus: 0.25,
            vigor: 0.05,
            composure: 0.45,
            flow: 0.2
        },
        doubleCountPolicy: "container_only",
        costBand: "standard",
        recoveryEffect: 0,
        metadata: {
            physicalIntensity: 0.1,
            cognitiveDemand: 0.45,
            socialLoad: 0.85,
            switchingLoad: 0.35
        }
    },
    recovery_break: {
        title: "Rest and recovery",
        mode: "recovery",
        sustainRateApPerHour: 3,
        demandWeights: {
            activation: 0.05,
            focus: 0.05,
            vigor: 0.15,
            composure: 0.15,
            flow: 0.1
        },
        doubleCountPolicy: "container_only",
        costBand: "tiny",
        recoveryEffect: 4,
        metadata: {
            physicalIntensity: 0.1,
            cognitiveDemand: 0.05,
            socialLoad: 0.1,
            switchingLoad: 0.05
        }
    },
    holiday_leisure: {
        title: "Holiday or leisure time",
        mode: "container",
        sustainRateApPerHour: 4,
        demandWeights: {
            activation: 0.05,
            focus: 0.05,
            vigor: 0.15,
            composure: 0.25,
            flow: 0.1
        },
        doubleCountPolicy: "container_only",
        costBand: "tiny",
        recoveryEffect: 2,
        metadata: {
            physicalIntensity: 0.15,
            cognitiveDemand: 0.1,
            socialLoad: 0.35,
            switchingLoad: 0.1
        }
    },
    light_context: {
        title: "Light context",
        mode: "container",
        sustainRateApPerHour: 2,
        demandWeights: {
            activation: 0.05,
            focus: 0.1,
            vigor: 0.05,
            composure: 0.15,
            flow: 0.15
        },
        doubleCountPolicy: "container_only",
        costBand: "tiny",
        recoveryEffect: 0,
        metadata: {
            physicalIntensity: 0.05,
            cognitiveDemand: 0.15,
            socialLoad: 0.2,
            switchingLoad: 0.15
        }
    }
};
function buildStatLevels(profile) {
    return {
        life_force: profile.life_force_level,
        activation: profile.activation_level,
        focus: profile.focus_level,
        vigor: profile.vigor_level,
        composure: profile.composure_level,
        flow: profile.flow_level
    };
}
function buildEffectiveProfile(profile, lifeForceProfile) {
    const costModifier = computeActionCostModifier(profile.demandWeights, buildStatLevels(lifeForceProfile));
    return {
        ...profile,
        startupAp: Number((profile.startupAp * costModifier).toFixed(4)),
        totalCostAp: Number((profile.totalCostAp * costModifier).toFixed(4)),
        sustainRateApPerHour: Number((profile.sustainRateApPerHour * costModifier).toFixed(4)),
        metadata: {
            ...profile.metadata,
            costModifier
        }
    };
}
function rateToTotalAp(rateApPerHour, durationSeconds) {
    return Number(((durationSeconds / 3600) * rateApPerHour).toFixed(4));
}
function overlapsWindow(leftStartIso, leftEndIso, rightStartIso, rightEndIso) {
    return (Date.parse(leftStartIso) < Date.parse(rightEndIso) &&
        Date.parse(leftEndIso) > Date.parse(rightStartIso));
}
function clipWindowToRange(window, range) {
    const startMs = Math.max(Date.parse(window.startAt), Date.parse(range.startAt));
    const endMs = Math.min(Date.parse(window.endAt), Date.parse(range.endAt));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
    }
    return { startMs, endMs };
}
function computeUncoveredSeconds(window, blockingWindows) {
    const clippedBlocks = blockingWindows
        .map((candidate) => clipWindowToRange(candidate, window))
        .filter((candidate) => candidate !== null)
        .sort((left, right) => left.startMs - right.startMs);
    const totalSeconds = Math.max(0, Math.floor((Date.parse(window.endAt) - Date.parse(window.startAt)) / 1000));
    if (totalSeconds <= 0 || clippedBlocks.length === 0) {
        return totalSeconds;
    }
    let coveredMs = 0;
    let activeStartMs = clippedBlocks[0].startMs;
    let activeEndMs = clippedBlocks[0].endMs;
    for (const block of clippedBlocks.slice(1)) {
        if (block.startMs <= activeEndMs) {
            activeEndMs = Math.max(activeEndMs, block.endMs);
            continue;
        }
        coveredMs += activeEndMs - activeStartMs;
        activeStartMs = block.startMs;
        activeEndMs = block.endMs;
    }
    coveredMs += activeEndMs - activeStartMs;
    return Math.max(0, totalSeconds - Math.floor(coveredMs / 1000));
}
function containsInstant(window, instantIso) {
    const instantMs = Date.parse(instantIso);
    return (Number.isFinite(instantMs) &&
        Date.parse(window.startAt) <= instantMs &&
        Date.parse(window.endAt) > instantMs);
}
function isInstantCovered(instantIso, blockingWindows) {
    return blockingWindows.some((window) => containsInstant(window, instantIso));
}
function nowIso() {
    return new Date().toISOString();
}
function toDateKey(date) {
    return date.toISOString().slice(0, 10);
}
function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function buildDayRange(date) {
    const start = startOfUtcDay(date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
        startMs: start.getTime(),
        endMs: end.getTime(),
        dateKey: toDateKey(start),
        from: start.toISOString(),
        to: end.toISOString()
    };
}
function parseCurvePoints(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((value) => !!value &&
            typeof value === "object" &&
            typeof value.minuteOfDay === "number" &&
            typeof value.rateApPerHour === "number")
            .map((point) => ({
            minuteOfDay: Math.round(point.minuteOfDay),
            rateApPerHour: point.rateApPerHour,
            locked: point.locked
        }))
            .sort((left, right) => left.minuteOfDay - right.minuteOfDay);
    }
    catch {
        return [];
    }
}
function defaultTemplatePoints() {
    return normalizeCurveToBudget(DEFAULT_TEMPLATE_POINTS, LIFE_FORCE_BASELINE_DAILY_AP);
}
function resolveWorkBlockPresetKey(kind) {
    if (kind === "main_activity") {
        return "deep_work";
    }
    if (kind === "secondary_activity") {
        return "admin";
    }
    if (kind === "third_activity" || kind === "custom") {
        return "maintenance";
    }
    if (kind === "holiday") {
        return "holiday_leisure";
    }
    return "recovery_break";
}
function resolveCalendarEventPresetKey(input) {
    const searchable = `${input.title} ${input.eventType ?? ""}`.toLowerCase();
    if (searchable.includes("meeting") || searchable.includes("call") || searchable.includes("interview")) {
        return "meeting";
    }
    if (searchable.includes("deep work") || searchable.includes("focus")) {
        return "deep_work";
    }
    if (searchable.includes("admin") || searchable.includes("email") || searchable.includes("inbox")) {
        return "admin";
    }
    if (searchable.includes("lunch") ||
        searchable.includes("break") ||
        searchable.includes("rest")) {
        return "recovery_break";
    }
    if (searchable.includes("holiday") || searchable.includes("vacation")) {
        return "holiday_leisure";
    }
    return input.availability === "busy" ? "meeting" : "light_context";
}
function buildCalendarActivityProfile(input) {
    const durationSeconds = Math.max(1, input.expectedDurationSeconds);
    const presetDefinition = input.activityPresetKey === "task_inherited"
        ? null
        : CALENDAR_ACTIVITY_PRESETS[input.activityPresetKey];
    const inheritedProfile = input.fallbackProfile;
    const baseProfile = presetDefinition === null
        ? inheritedProfile
        : actionProfileSchema.parse({
            id: `profile_${input.entityType}_${input.entityId}`,
            profileKey: `${String(input.entityType)}_${input.entityId}`,
            title: input.title || presetDefinition.title,
            entityType: input.entityType,
            mode: presetDefinition.mode,
            startupAp: 0,
            totalCostAp: rateToTotalAp(presetDefinition.sustainRateApPerHour, durationSeconds),
            expectedDurationSeconds: durationSeconds,
            sustainRateApPerHour: presetDefinition.sustainRateApPerHour,
            demandWeights: presetDefinition.demandWeights,
            doubleCountPolicy: presetDefinition.doubleCountPolicy,
            sourceMethod: input.sourceMethod ?? "inferred",
            costBand: presetDefinition.costBand,
            recoveryEffect: presetDefinition.recoveryEffect,
            metadata: {
                activityPresetKey: input.activityPresetKey,
                ...presetDefinition.metadata,
                ...(input.metadata ?? {})
            },
            createdAt: nowIso(),
            updatedAt: nowIso()
        });
    const base = baseProfile ??
        actionProfileSchema.parse({
            id: `profile_${input.entityType}_${input.entityId}`,
            profileKey: `${String(input.entityType)}_${input.entityId}`,
            title: input.title || "Activity",
            entityType: input.entityType,
            mode: "container",
            startupAp: 0,
            totalCostAp: rateToTotalAp(8, durationSeconds),
            expectedDurationSeconds: durationSeconds,
            sustainRateApPerHour: 8,
            demandWeights: {
                activation: 0.1,
                focus: 0.3,
                vigor: 0.1,
                composure: 0.1,
                flow: 0.4
            },
            doubleCountPolicy: "container_only",
            sourceMethod: input.sourceMethod ?? "inferred",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {
                activityPresetKey: "maintenance",
                ...(input.metadata ?? {})
            },
            createdAt: nowIso(),
            updatedAt: nowIso()
        });
    const sustainRateApPerHour = input.customSustainRateApPerHour ?? base.sustainRateApPerHour;
    return actionProfileSchema.parse({
        ...base,
        id: `profile_${input.entityType}_${input.entityId}`,
        profileKey: `${String(input.entityType)}_${input.entityId}`,
        title: input.title || base.title,
        entityType: input.entityType,
        expectedDurationSeconds: durationSeconds,
        totalCostAp: rateToTotalAp(sustainRateApPerHour, durationSeconds),
        sustainRateApPerHour,
        sourceMethod: input.customSustainRateApPerHour !== null &&
            input.customSustainRateApPerHour !== undefined
            ? "manual"
            : input.sourceMethod ?? base.sourceMethod,
        metadata: {
            ...base.metadata,
            activityPresetKey: input.activityPresetKey,
            customSustainRateApPerHour: input.customSustainRateApPerHour ?? null,
            ...(input.metadata ?? {})
        },
        updatedAt: nowIso()
    });
}
function seededActionProfiles() {
    const now = nowIso();
    const taskDefault = buildDefaultTaskActionProfile({});
    return [
        taskDefault,
        actionProfileSchema.parse({
            id: "profile_note_quick",
            profileKey: "note_quick",
            title: "Quick note",
            entityType: "note",
            mode: "impulse",
            startupAp: 1,
            totalCostAp: 1,
            expectedDurationSeconds: null,
            sustainRateApPerHour: 0,
            demandWeights: {
                activation: 0.15,
                focus: 0.5,
                vigor: 0,
                composure: 0,
                flow: 0.35
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "tiny",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_habit_default",
            profileKey: "habit_default",
            title: "Habit check-in",
            entityType: "habit",
            mode: "impulse",
            startupAp: 3,
            totalCostAp: 3,
            expectedDurationSeconds: null,
            sustainRateApPerHour: 0,
            demandWeights: {
                activation: 0.4,
                focus: 0.1,
                vigor: 0.15,
                composure: 0.05,
                flow: 0.3
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_workout_default",
            profileKey: "workout_default",
            title: "Workout",
            entityType: "workout_session",
            mode: "rate",
            startupAp: 1,
            totalCostAp: 24,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 24,
            demandWeights: {
                activation: 0.1,
                focus: 0.05,
                vigor: 0.75,
                composure: 0,
                flow: 0.1
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "standard",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_calendar_default",
            profileKey: "calendar_event_default",
            title: "Calendar event",
            entityType: "calendar_event",
            mode: "container",
            startupAp: 0,
            totalCostAp: 12,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 12,
            demandWeights: {
                activation: 0.05,
                focus: 0.35,
                vigor: 0.05,
                composure: 0.35,
                flow: 0.2
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_recovery_break",
            profileKey: "recovery_break",
            title: "Recovery break",
            entityType: "system",
            mode: "recovery",
            startupAp: 0,
            totalCostAp: 0,
            expectedDurationSeconds: null,
            sustainRateApPerHour: 0,
            demandWeights: {
                activation: 0,
                focus: 0,
                vigor: 0,
                composure: 0,
                flow: 0
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "tiny",
            recoveryEffect: 6,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_wake_start",
            profileKey: "wake_start",
            title: "Get out of bed",
            entityType: "sleep_session",
            mode: "impulse",
            startupAp: 5,
            totalCostAp: 5,
            expectedDurationSeconds: null,
            sustainRateApPerHour: 0,
            demandWeights: {
                activation: 0.75,
                focus: 0.05,
                vigor: 0.1,
                composure: 0,
                flow: 0.1
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_timebox_default",
            profileKey: "task_timebox_default",
            title: "Task timebox",
            entityType: "task_timebox",
            mode: "container",
            startupAp: 0,
            totalCostAp: 12,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 12,
            demandWeights: {
                activation: 0.15,
                focus: 0.45,
                vigor: 0.05,
                composure: 0.05,
                flow: 0.3
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_work_block_main",
            profileKey: "work_block_main",
            title: "Main activity block",
            entityType: "work_block",
            mode: "container",
            startupAp: 0,
            totalCostAp: 14,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 14,
            demandWeights: {
                activation: 0.1,
                focus: 0.5,
                vigor: 0.1,
                composure: 0.05,
                flow: 0.25
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: { kind: "main_activity" },
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_work_block_secondary",
            profileKey: "work_block_secondary",
            title: "Secondary activity block",
            entityType: "work_block",
            mode: "container",
            startupAp: 0,
            totalCostAp: 9,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 9,
            demandWeights: {
                activation: 0.15,
                focus: 0.3,
                vigor: 0.1,
                composure: 0.05,
                flow: 0.4
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: { kind: "secondary_activity" },
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_work_block_third",
            profileKey: "work_block_third",
            title: "Third activity block",
            entityType: "work_block",
            mode: "container",
            startupAp: 0,
            totalCostAp: 6,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 6,
            demandWeights: {
                activation: 0.15,
                focus: 0.2,
                vigor: 0.1,
                composure: 0.05,
                flow: 0.5
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: { kind: "third_activity" },
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_work_block_rest",
            profileKey: "work_block_rest",
            title: "Rest block",
            entityType: "work_block",
            mode: "recovery",
            startupAp: 0,
            totalCostAp: 3,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 3,
            demandWeights: {
                activation: 0.05,
                focus: 0.05,
                vigor: 0.15,
                composure: 0.15,
                flow: 0.1
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "tiny",
            recoveryEffect: 4,
            metadata: { kind: "rest", activityPresetKey: "recovery_break" },
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_work_block_holiday",
            profileKey: "work_block_holiday",
            title: "Holiday block",
            entityType: "work_block",
            mode: "container",
            startupAp: 0,
            totalCostAp: 4,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 4,
            demandWeights: {
                activation: 0.05,
                focus: 0.05,
                vigor: 0.15,
                composure: 0.25,
                flow: 0.1
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "tiny",
            recoveryEffect: 2,
            metadata: { kind: "holiday", activityPresetKey: "holiday_leisure" },
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_movement_trip",
            profileKey: "movement_trip_default",
            title: "Movement trip",
            entityType: "movement_trip",
            mode: "rate",
            startupAp: 0,
            totalCostAp: 8,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 8,
            demandWeights: {
                activation: 0.05,
                focus: 0.15,
                vigor: 0.55,
                composure: 0,
                flow: 0.25
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        })
    ];
}
function mapTemplateProfileRow(row) {
    return actionProfileSchema.parse({
        id: row.id,
        profileKey: row.profile_key,
        entityType: row.entity_type,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...JSON.parse(row.profile_json)
    });
}
function mapEntityProfileRow(row, fallback) {
    return actionProfileSchema.parse({
        id: row.id,
        profileKey: fallback.profileKey,
        title: fallback.title,
        entityType: fallback.entityType,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...JSON.parse(row.profile_json)
    });
}
function readEntityActionProfileRow(entityType, entityId) {
    return getDatabase()
        .prepare(`SELECT id, entity_type, entity_id, profile_json, created_at, updated_at
       FROM entity_action_profiles
       WHERE entity_type = ? AND entity_id = ?`)
        .get(entityType, entityId);
}
export function readEntityActionProfile(entityType, entityId, fallback) {
    const row = readEntityActionProfileRow(entityType, entityId);
    return row ? mapEntityProfileRow(row, fallback) : null;
}
function ensureActionProfileTemplates() {
    const database = getDatabase();
    const insert = database.prepare(`INSERT OR IGNORE INTO action_profile_templates (
       id,
       profile_key,
       entity_type,
       title,
       profile_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const profile of seededActionProfiles()) {
        insert.run(profile.id, profile.profileKey, profile.entityType, profile.title, JSON.stringify({
            mode: profile.mode,
            startupAp: profile.startupAp,
            totalCostAp: profile.totalCostAp,
            expectedDurationSeconds: profile.expectedDurationSeconds,
            sustainRateApPerHour: profile.sustainRateApPerHour,
            demandWeights: profile.demandWeights,
            doubleCountPolicy: profile.doubleCountPolicy,
            sourceMethod: profile.sourceMethod,
            costBand: profile.costBand,
            recoveryEffect: profile.recoveryEffect,
            metadata: profile.metadata
        }), profile.createdAt, profile.updatedAt);
    }
}
export function upsertTaskActionProfile(input) {
    const now = nowIso();
    const profile = buildDefaultTaskActionProfile({
        id: `profile_task_${input.taskId}`,
        profileKey: `task_${input.taskId}`,
        title: input.title || "Task",
        expectedDurationSeconds: input.plannedDurationSeconds,
        totalCostAp: input.totalCostAp ?? resolveBandTotalCostAp(input.actionCostBand ?? "standard"),
        costBand: input.actionCostBand ?? "standard",
        sourceMethod: "manual"
    });
    getDatabase()
        .prepare(`INSERT INTO entity_action_profiles (
         id,
         entity_type,
         entity_id,
         profile_json,
         created_at,
         updated_at
       ) VALUES (?, 'task', ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at`)
        .run(profile.id, input.taskId, JSON.stringify({
        profileKey: profile.profileKey,
        title: profile.title,
        entityType: profile.entityType,
        mode: profile.mode,
        startupAp: profile.startupAp,
        totalCostAp: profile.totalCostAp,
        expectedDurationSeconds: profile.expectedDurationSeconds,
        sustainRateApPerHour: profile.sustainRateApPerHour,
        demandWeights: profile.demandWeights,
        doubleCountPolicy: profile.doubleCountPolicy,
        sourceMethod: profile.sourceMethod,
        costBand: profile.costBand,
        recoveryEffect: profile.recoveryEffect,
        metadata: profile.metadata
    }), now, now);
}
export function upsertEntityActionProfile(input) {
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO entity_action_profiles (
         id,
         entity_type,
         entity_id,
         profile_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at`)
        .run(input.profile.id, input.entityType, input.entityId, JSON.stringify({
        mode: input.profile.mode,
        startupAp: input.profile.startupAp,
        totalCostAp: input.profile.totalCostAp,
        expectedDurationSeconds: input.profile.expectedDurationSeconds,
        sustainRateApPerHour: input.profile.sustainRateApPerHour,
        demandWeights: input.profile.demandWeights,
        doubleCountPolicy: input.profile.doubleCountPolicy,
        sourceMethod: input.profile.sourceMethod,
        costBand: input.profile.costBand,
        recoveryEffect: input.profile.recoveryEffect,
        metadata: input.profile.metadata
    }), now, now);
}
export function buildWorkBlockTemplateActionProfile(input) {
    const durationMinutes = input.endMinute > input.startMinute
        ? input.endMinute - input.startMinute
        : 24 * 60 - input.startMinute + input.endMinute;
    const activityPresetKey = input.activityPresetKey ??
        resolveWorkBlockPresetKey(input.kind);
    return buildCalendarActivityProfile({
        entityType: "work_block_template",
        entityId: input.templateId,
        title: input.title,
        expectedDurationSeconds: durationMinutes * 60,
        activityPresetKey,
        customSustainRateApPerHour: input.customSustainRateApPerHour,
        sourceMethod: input.customSustainRateApPerHour !== null &&
            input.customSustainRateApPerHour !== undefined
            ? "manual"
            : "inferred",
        metadata: {
            kind: input.kind
        }
    });
}
export function buildCalendarEventActionProfile(input) {
    const activityPresetKey = input.activityPresetKey ??
        resolveCalendarEventPresetKey({
            title: input.title,
            eventType: input.eventType,
            availability: input.availability
        });
    return buildCalendarActivityProfile({
        entityType: "calendar_event",
        entityId: input.eventId,
        title: input.title,
        expectedDurationSeconds: Math.max(60, Math.floor((Date.parse(input.endAt) - Date.parse(input.startAt)) / 1000)),
        activityPresetKey,
        customSustainRateApPerHour: input.customSustainRateApPerHour,
        sourceMethod: input.customSustainRateApPerHour !== null &&
            input.customSustainRateApPerHour !== undefined
            ? "manual"
            : "inferred",
        metadata: {
            availability: input.availability,
            eventType: input.eventType ?? ""
        }
    });
}
function ensureLifeForceProfile(userId) {
    const database = getDatabase();
    const existing = database
        .prepare(`SELECT *
       FROM life_force_profiles
       WHERE user_id = ?`)
        .get(userId);
    if (existing) {
        return existing;
    }
    const now = nowIso();
    database
        .prepare(`INSERT INTO life_force_profiles (
         user_id,
         base_daily_ap,
         readiness_multiplier,
         life_force_level,
         activation_level,
         focus_level,
         vigor_level,
         composure_level,
         flow_level,
         created_at,
         updated_at
       ) VALUES (?, 200, 1.0, 1, 1, 1, 1, 1, 1, ?, ?)`)
        .run(userId, now, now);
    return database
        .prepare(`SELECT *
       FROM life_force_profiles
       WHERE user_id = ?`)
        .get(userId);
}
function ensureWeekdayTemplates(userId) {
    const database = getDatabase();
    const insert = database.prepare(`INSERT OR IGNORE INTO life_force_weekday_templates (
       id,
       user_id,
       weekday,
       baseline_daily_ap,
       points_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const now = nowIso();
    const defaultPoints = JSON.stringify(defaultTemplatePoints());
    for (let weekday = 0; weekday < 7; weekday += 1) {
        insert.run(`lf_template_${userId}_${weekday}`, userId, weekday, LIFE_FORCE_BASELINE_DAILY_AP, defaultPoints, now, now);
    }
}
function readWeekdayTemplate(userId, weekday) {
    ensureWeekdayTemplates(userId);
    return getDatabase()
        .prepare(`SELECT *
       FROM life_force_weekday_templates
       WHERE user_id = ? AND weekday = ?`)
        .get(userId, weekday);
}
function readTaskRunRows(range, userId) {
    return getDatabase()
        .prepare(`SELECT
         task_runs.id,
         task_runs.task_id,
         task_runs.actor,
         task_runs.status,
         task_runs.is_current,
         task_runs.claimed_at,
         task_runs.heartbeat_at,
         task_runs.lease_expires_at,
         task_runs.completed_at,
         task_runs.released_at,
         task_runs.timed_out_at,
         task_runs.updated_at,
         tasks.title AS task_title,
         task_runs.planned_duration_seconds,
         tasks.planned_duration_seconds AS task_expected_duration_seconds
       FROM task_runs
       INNER JOIN tasks ON tasks.id = task_runs.task_id
       INNER JOIN entity_owners
         ON entity_owners.entity_type = 'task'
        AND entity_owners.entity_id = tasks.id
        AND entity_owners.role = 'owner'
       WHERE entity_owners.user_id = ?
         AND task_runs.claimed_at < ?
         AND COALESCE(task_runs.completed_at, task_runs.released_at, task_runs.timed_out_at, task_runs.updated_at, task_runs.lease_expires_at, task_runs.heartbeat_at) >= ?`)
        .all(userId, range.to, range.from);
}
function terminalRunMs(row, now) {
    if (row.status === "active") {
        return Math.max(Date.parse(row.claimed_at), Math.min(now.getTime(), Date.parse(row.lease_expires_at)));
    }
    const terminal = row.completed_at ??
        row.released_at ??
        row.timed_out_at ??
        row.updated_at ??
        row.lease_expires_at ??
        row.heartbeat_at;
    return Math.max(Date.parse(row.claimed_at), Date.parse(terminal));
}
function overlapSeconds(range, row, now) {
    const start = Math.max(range.startMs, Date.parse(row.claimed_at));
    const end = Math.min(range.endMs, terminalRunMs(row, now));
    return Math.max(0, Math.floor((end - start) / 1000));
}
function readStatXpByKey(userId) {
    const rows = getDatabase()
        .prepare(`SELECT stat_key, COALESCE(SUM(delta_xp), 0) AS xp
       FROM stat_xp_events
       WHERE user_id = ?
       GROUP BY stat_key`)
        .all(userId);
    return new Map(rows.map((row) => [row.stat_key, row.xp]));
}
function buildStats(profile, userId) {
    const xpByKey = readStatXpByKey(userId);
    const levelByKey = buildStatLevels(profile);
    return Object.keys(levelByKey).map((key) => {
        const level = levelByKey[key];
        return {
            key,
            label: LIFE_FORCE_STAT_LABELS[key],
            level,
            xp: xpByKey.get(key) ?? 0,
            xpToNextLevel: level * 100,
            costModifier: key === "life_force"
                ? Number(computeLifeForceLevelMultiplier(level).toFixed(3))
                : Number(computeStatCostModifier(level).toFixed(3))
        };
    });
}
function computeLifeForceMultiplier(profile) {
    return computeLifeForceLevelMultiplier(profile.life_force_level);
}
function readPrimarySleepSessionForDate(userId, date) {
    const range = buildDayRange(date);
    const lookback = new Date(range.startMs - 18 * 60 * 60 * 1000).toISOString();
    try {
        return getDatabase()
            .prepare(`SELECT id, started_at, ended_at, asleep_seconds, sleep_score
           FROM health_sleep_sessions
           WHERE user_id = ?
             AND ended_at >= ?
             AND ended_at < ?
           ORDER BY asleep_seconds DESC, ended_at DESC
           LIMIT 1`)
            .get(userId, lookback, range.to);
    }
    catch {
        return undefined;
    }
}
function computeSleepRecoveryMultiplier(userId, date) {
    const session = readPrimarySleepSessionForDate(userId, date);
    if (!session) {
        return 1;
    }
    const sleepHours = session.asleep_seconds / 3600;
    const durationFactor = clamp(0.82 + ((sleepHours - 4.5) / 4.5) * 0.22, 0.85, 1.1);
    const scoreFactor = session.sleep_score === null
        ? 1
        : clamp(0.92 + (session.sleep_score / 100) * 0.16, 0.9, 1.08);
    return Number((durationFactor * scoreFactor).toFixed(3));
}
function computeFatigueDebtCarry(userId, date) {
    const previous = new Date(date);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const previousKey = toDateKey(previous);
    const snapshot = getDatabase()
        .prepare(`SELECT daily_budget_ap
       FROM life_force_day_snapshots
       WHERE user_id = ? AND date_key = ?`)
        .get(userId, previousKey);
    if (!snapshot) {
        return 0;
    }
    const spent = getDatabase()
        .prepare(`SELECT COALESCE(SUM(total_ap), 0) AS total_ap
       FROM ap_ledger_events
       WHERE user_id = ? AND date_key = ?`)
        .get(userId, previousKey);
    return Math.max(0, Number((spent.total_ap - snapshot.daily_budget_ap).toFixed(2)));
}
function getOrCreateDaySnapshot(userId, date) {
    const range = buildDayRange(date);
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM life_force_day_snapshots
       WHERE user_id = ? AND date_key = ?`)
        .get(userId, range.dateKey);
    if (existing) {
        return existing;
    }
    const profile = ensureLifeForceProfile(userId);
    const template = readWeekdayTemplate(userId, date.getUTCDay());
    const sleepRecoveryMultiplier = computeSleepRecoveryMultiplier(userId, date);
    const fatigueDebtCarry = computeFatigueDebtCarry(userId, date);
    const readinessMultiplier = profile.readiness_multiplier;
    const dailyBudgetAp = Math.max(40, Math.round(profile.base_daily_ap *
        computeLifeForceMultiplier(profile) *
        sleepRecoveryMultiplier *
        readinessMultiplier) - fatigueDebtCarry);
    const points = normalizeCurveToBudget(parseCurvePoints(template.points_json), dailyBudgetAp);
    const now = nowIso();
    const id = `lf_day_${userId}_${range.dateKey}`;
    getDatabase()
        .prepare(`INSERT INTO life_force_day_snapshots (
         id,
         user_id,
         date_key,
         daily_budget_ap,
         sleep_recovery_multiplier,
         readiness_multiplier,
         fatigue_debt_carry,
         points_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, range.dateKey, dailyBudgetAp, sleepRecoveryMultiplier, readinessMultiplier, fatigueDebtCarry, JSON.stringify(points), now, now);
    return getDatabase()
        .prepare(`SELECT *
       FROM life_force_day_snapshots
       WHERE id = ?`)
        .get(id);
}
export function resolveTaskActionProfile(task, lifeForceProfile) {
    const row = readEntityActionProfileRow("task", task.id);
    const baseProfile = !row
        ? buildDefaultTaskActionProfile({
            id: `profile_task_${task.id}`,
            expectedDurationSeconds: task.plannedDurationSeconds
        })
        : mapEntityProfileRow(row, {
            profileKey: `task_${task.id}`,
            title: "Task",
            entityType: "task"
        });
    const profile = {
        ...baseProfile,
        expectedDurationSeconds: resolveTaskExpectedDurationSeconds(baseProfile.expectedDurationSeconds ?? task.plannedDurationSeconds)
    };
    return lifeForceProfile ? buildEffectiveProfile(profile, lifeForceProfile) : profile;
}
export function buildTaskTimeboxActionProfile(input) {
    const durationSeconds = Math.max(60, Math.floor((Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 1000));
    const fallbackTaskProfile = resolveTaskActionProfile({
        id: input.taskId,
        plannedDurationSeconds: input.taskPlannedDurationSeconds ?? null
    });
    const activityPresetKey = input.activityPresetKey ??
        "task_inherited";
    return buildCalendarActivityProfile({
        entityType: "task_timebox",
        entityId: input.timeboxId,
        title: input.title,
        expectedDurationSeconds: durationSeconds,
        activityPresetKey,
        customSustainRateApPerHour: input.customSustainRateApPerHour,
        sourceMethod: input.customSustainRateApPerHour !== null &&
            input.customSustainRateApPerHour !== undefined
            ? "manual"
            : activityPresetKey === "task_inherited"
                ? "inferred"
                : "manual",
        fallbackProfile: fallbackTaskProfile,
        metadata: {
            taskId: input.taskId
        }
    });
}
function readTodayAdjustmentRows(userId, range) {
    return getDatabase()
        .prepare(`SELECT
         work_adjustments.id,
         work_adjustments.entity_type,
         work_adjustments.entity_id,
         work_adjustments.applied_delta_minutes,
         work_adjustments.note,
         work_adjustments.created_at,
         tasks.planned_duration_seconds
       FROM work_adjustments
       LEFT JOIN tasks
         ON work_adjustments.entity_type = 'task'
        AND tasks.id = work_adjustments.entity_id
       INNER JOIN entity_owners
         ON entity_owners.entity_type = work_adjustments.entity_type
        AND entity_owners.entity_id = work_adjustments.entity_id
        AND entity_owners.role = 'owner'
       WHERE entity_owners.user_id = ?
         AND work_adjustments.created_at >= ?
         AND work_adjustments.created_at < ?`)
        .all(userId, range.from, range.to);
}
function readTodayAdjustmentApByTaskId(userId, range, lifeForceProfile) {
    const rows = readTodayAdjustmentRows(userId, range);
    const totals = new Map();
    for (const row of rows) {
        if (row.entity_type !== "task") {
            continue;
        }
        const profile = resolveTaskActionProfile({
            id: row.entity_id,
            plannedDurationSeconds: row.planned_duration_seconds
        }, lifeForceProfile);
        const deltaAp = rateToTotalAp(profile.sustainRateApPerHour, row.applied_delta_minutes * 60);
        totals.set(row.entity_id, (totals.get(row.entity_id) ?? 0) + deltaAp);
    }
    return totals;
}
function readTodayAdjustmentSecondsByTaskId(userId, range) {
    const rows = readTodayAdjustmentRows(userId, range);
    const totals = new Map();
    for (const row of rows) {
        if (row.entity_type !== "task") {
            continue;
        }
        totals.set(row.entity_id, (totals.get(row.entity_id) ?? 0) + row.applied_delta_minutes * 60);
    }
    return totals;
}
function readActiveTaskRunProjectionRows(taskId) {
    return getDatabase()
        .prepare(`SELECT
         id,
         task_id,
         timer_mode,
         planned_duration_seconds,
         claimed_at,
         lease_expires_at,
         status
       FROM task_runs
       WHERE task_id = ?
         AND status = 'active'`)
        .all(taskId);
}
function computeProjectedRemainingSeconds(row, now) {
    if (row.timer_mode !== "planned" || row.planned_duration_seconds === null) {
        return 0;
    }
    const endMs = Math.min(now.getTime(), Date.parse(row.lease_expires_at));
    const elapsedWallSeconds = Math.max(0, Math.floor((endMs - Date.parse(row.claimed_at)) / 1000));
    return Math.max(0, row.planned_duration_seconds - elapsedWallSeconds);
}
function buildTaskLifeForceRuntime(task, userId, now = new Date(), lifeForceProfile = ensureLifeForceProfile(userId)) {
    const range = buildDayRange(now);
    const profile = resolveTaskActionProfile(task, lifeForceProfile);
    const todayRunSeconds = readTaskRunRows(range, userId)
        .filter((row) => row.task_id === task.id)
        .reduce((sum, row) => sum + overlapSeconds(range, row, now), 0);
    const todayAdjustmentSeconds = readTodayAdjustmentSecondsByTaskId(userId, range).get(task.id) ?? 0;
    const todayCreditedSeconds = todayRunSeconds + todayAdjustmentSeconds;
    const spentTodayAp = (todayCreditedSeconds / 3600) * profile.sustainRateApPerHour;
    const spentTotalAp = (task.time.totalCreditedSeconds / 3600) * profile.sustainRateApPerHour;
    const projectedTotalSeconds = task.time.totalCreditedSeconds +
        readActiveTaskRunProjectionRows(task.id).reduce((sum, row) => sum + computeProjectedRemainingSeconds(row, now), 0);
    return {
        taskId: task.id,
        profile,
        todayRunSeconds,
        todayAdjustmentSeconds,
        todayCreditedSeconds,
        spentTodayAp,
        spentTotalAp,
        projectedTotalSeconds
    };
}
function readTaskRunWindowsByTaskId(userId, range, now) {
    const windows = new Map();
    for (const row of readTaskRunRows(range, userId)) {
        const startMs = Math.max(range.startMs, Date.parse(row.claimed_at));
        const endMs = Math.min(range.endMs, terminalRunMs(row, now));
        if (endMs <= startMs) {
            continue;
        }
        const list = windows.get(row.task_id) ?? [];
        list.push({ startMs, endMs });
        windows.set(row.task_id, list);
    }
    return windows;
}
function buildWorkAdjustmentContributions(userId, range, lifeForceProfile) {
    return readTodayAdjustmentRows(userId, range)
        .filter((row) => row.entity_type === "task")
        .map((row) => {
        const profile = resolveTaskActionProfile({
            id: row.entity_id,
            plannedDurationSeconds: row.planned_duration_seconds
        }, lifeForceProfile);
        const totalAp = rateToTotalAp(profile.sustainRateApPerHour, row.applied_delta_minutes * 60);
        return {
            entityType: "task",
            entityId: row.entity_id,
            eventKind: "work_adjustment",
            sourceKind: "work_adjustment",
            totalAp,
            rateApPerHour: null,
            title: row.note?.trim() || "Manual work adjustment",
            why: "Manual time adjustments count toward today's Action Point spend.",
            startsAt: row.created_at,
            endsAt: row.created_at,
            role: "background",
            metadata: {
                adjustmentId: row.id,
                appliedDeltaMinutes: row.applied_delta_minutes
            }
        };
    });
}
function buildTaskRunContributions(userId, range, now, lifeForceProfile) {
    const contributions = [];
    const totalsByTaskId = new Map();
    const activeDrains = [];
    for (const row of readTaskRunRows(range, userId)) {
        const seconds = overlapSeconds(range, row, now);
        if (seconds <= 0) {
            continue;
        }
        const profile = resolveTaskActionProfile({
            id: row.task_id,
            plannedDurationSeconds: row.task_expected_duration_seconds ?? row.planned_duration_seconds
        }, lifeForceProfile);
        const totalAp = rateToTotalAp(profile.sustainRateApPerHour, seconds);
        const startsAt = new Date(Math.max(range.startMs, Date.parse(row.claimed_at))).toISOString();
        const endsAt = new Date(Math.min(range.endMs, terminalRunMs(row, now))).toISOString();
        const contribution = {
            entityType: "task",
            entityId: row.task_id,
            eventKind: "task_run",
            sourceKind: "task_run",
            totalAp,
            rateApPerHour: profile.sustainRateApPerHour,
            title: row.task_title,
            why: "Active timed work consumes Action Points proportionally to actual time worked today.",
            startsAt,
            endsAt,
            role: row.is_current === 1 ? "primary" : "secondary",
            metadata: { taskRunId: row.id }
        };
        contributions.push(contribution);
        const existing = totalsByTaskId.get(row.task_id) ?? { todayAp: 0, totalAp: 0 };
        existing.todayAp += totalAp;
        existing.totalAp += totalAp;
        totalsByTaskId.set(row.task_id, existing);
        if (row.status === "active" && Date.parse(row.lease_expires_at) > now.getTime()) {
            activeDrains.push({
                ...contribution,
                totalAp: 0
            });
        }
    }
    return { contributions, totalsByTaskId, activeDrains };
}
function buildNoteContributions(userId, range, now, lifeForceProfile) {
    try {
        const noteProfile = buildEffectiveProfile(seededActionProfiles().find((entry) => entry.profileKey === "note_quick"), lifeForceProfile);
        const taskRunWindowsByTaskId = readTaskRunWindowsByTaskId(userId, range, now);
        const rows = getDatabase()
            .prepare(`SELECT
           notes.id,
           notes.title,
           notes.created_at,
           GROUP_CONCAT(
             CASE
               WHEN note_links.entity_type = 'task' THEN note_links.entity_id
               ELSE NULL
             END
           ) AS linked_task_ids
         FROM notes
         LEFT JOIN note_links ON note_links.note_id = notes.id
         INNER JOIN entity_owners
           ON entity_owners.entity_type = 'note'
          AND entity_owners.entity_id = notes.id
          AND entity_owners.role = 'owner'
         WHERE entity_owners.user_id = ?
           AND notes.created_at >= ?
           AND notes.created_at < ?
         GROUP BY notes.id, notes.title, notes.created_at`)
            .all(userId, range.from, range.to);
        return rows
            .filter((row) => {
            const createdAtMs = Date.parse(row.created_at);
            const linkedTaskIds = (row.linked_task_ids ?? "")
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
            return !linkedTaskIds.some((taskId) => (taskRunWindowsByTaskId.get(taskId) ?? []).some((window) => createdAtMs >= window.startMs && createdAtMs <= window.endMs));
        })
            .map((row) => ({
            entityType: "note",
            entityId: row.id,
            eventKind: "note_created",
            sourceKind: "note",
            totalAp: noteProfile.totalCostAp,
            rateApPerHour: null,
            title: row.title || "Note",
            why: "Standalone capture takes a small impulse of activation and focus.",
            startsAt: row.created_at,
            endsAt: row.created_at,
            role: "background"
        }));
    }
    catch {
        return [];
    }
}
function buildHabitContributions(userId, range, lifeForceProfile) {
    try {
        const habitProfile = buildEffectiveProfile(seededActionProfiles().find((entry) => entry.profileKey === "habit_default"), lifeForceProfile);
        const rows = getDatabase()
            .prepare(`SELECT
           habits.id,
           habits.title,
           habit_check_ins.created_at,
           health_workout_sessions.id AS generated_workout_id
         FROM habit_check_ins
         INNER JOIN habits ON habits.id = habit_check_ins.habit_id
         LEFT JOIN health_workout_sessions
           ON health_workout_sessions.generated_from_check_in_id = habit_check_ins.id
         INNER JOIN entity_owners
           ON entity_owners.entity_type = 'habit'
          AND entity_owners.entity_id = habits.id
          AND entity_owners.role = 'owner'
         WHERE entity_owners.user_id = ?
           AND habit_check_ins.created_at >= ?
           AND habit_check_ins.created_at < ?`)
            .all(userId, range.from, range.to);
        return rows
            .filter((row) => row.generated_workout_id === null)
            .map((row) => ({
            entityType: "habit",
            entityId: row.id,
            eventKind: "habit_check_in",
            sourceKind: "habit",
            totalAp: habitProfile.totalCostAp,
            rateApPerHour: null,
            title: row.title,
            why: "Habit execution still costs activation even when the action is short.",
            startsAt: row.created_at,
            endsAt: row.created_at,
            role: "background"
        }));
    }
    catch {
        return [];
    }
}
function buildWorkoutContributions(userId, range, now, lifeForceProfile) {
    let rows = [];
    try {
        rows = getDatabase()
            .prepare(`SELECT id, workout_type, started_at, ended_at, duration_seconds, subjective_effort
         FROM health_workout_sessions
         WHERE user_id = ?
           AND started_at < ?
           AND ended_at >= ?`)
            .all(userId, range.to, range.from);
    }
    catch {
        rows = [];
    }
    const contributions = [];
    const activeDrains = [];
    const workoutProfile = buildEffectiveProfile(seededActionProfiles().find((entry) => entry.profileKey === "workout_default"), lifeForceProfile);
    for (const row of rows) {
        const startMs = Math.max(range.startMs, Date.parse(row.started_at));
        const endMs = Math.min(range.endMs, Date.parse(row.ended_at));
        const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
        if (seconds <= 0) {
            continue;
        }
        const effortMultiplier = row.subjective_effort
            ? clamp(row.subjective_effort / 6, 0.8, 1.6)
            : 1;
        const rateApPerHour = Number((workoutProfile.sustainRateApPerHour * effortMultiplier).toFixed(4));
        const contribution = {
            entityType: "workout_session",
            entityId: row.id,
            eventKind: "workout_session",
            sourceKind: "workout",
            totalAp: rateToTotalAp(rateApPerHour, seconds),
            rateApPerHour,
            title: row.workout_type,
            why: "Workout sessions consume real physical capacity and should affect current load.",
            startsAt: new Date(startMs).toISOString(),
            endsAt: new Date(endMs).toISOString(),
            role: "secondary"
        };
        contributions.push(contribution);
        if (Date.parse(row.started_at) <= now.getTime() && Date.parse(row.ended_at) > now.getTime()) {
            activeDrains.push({ ...contribution, totalAp: 0 });
        }
    }
    return { contributions, activeDrains };
}
function buildWakeImpulseContributions(userId, range, lifeForceProfile) {
    const primarySleep = readPrimarySleepSessionForDate(userId, new Date(range.startMs));
    if (!primarySleep) {
        return [];
    }
    const endedAtMs = Date.parse(primarySleep.ended_at);
    if (endedAtMs < range.startMs || endedAtMs >= range.endMs) {
        return [];
    }
    const wakeProfile = buildEffectiveProfile(seededActionProfiles().find((entry) => entry.profileKey === "wake_start"), lifeForceProfile);
    return [
        {
            entityType: "sleep_session",
            entityId: primarySleep.id,
            eventKind: "wake_start",
            sourceKind: "wake",
            totalAp: wakeProfile.totalCostAp,
            rateApPerHour: null,
            title: "Get out of bed",
            why: "Starting the day takes real activation and should count as an Action Point impulse.",
            startsAt: primarySleep.ended_at,
            endsAt: primarySleep.ended_at,
            role: "background"
        }
    ];
}
function buildMovementTripProfile(trip) {
    const baseProfile = seededActionProfiles().find((entry) => entry.profileKey === "movement_trip_default");
    const expectedMet = trip.expected_met ?? 2;
    const baseRateApPerHour = clamp(expectedMet * 4, 4, 22);
    const lowerTitle = `${trip.activity_type} ${trip.travel_mode}`.toLowerCase();
    const vigor = lowerTitle.includes("walk") || lowerTitle.includes("run") || lowerTitle.includes("bike")
        ? 0.65
        : lowerTitle.includes("drive") || lowerTitle.includes("train")
            ? 0.2
            : 0.45;
    const focus = lowerTitle.includes("drive") ? 0.35 : 0.15;
    const flow = 1 - vigor - focus;
    return actionProfileSchema.parse({
        ...baseProfile,
        id: `${baseProfile.id}_${trip.travel_mode}_${trip.activity_type || "travel"}`,
        profileKey: `${baseProfile.profileKey}_${trip.travel_mode}_${trip.activity_type || "travel"}`,
        title: trip.activity_type?.trim() || trip.travel_mode || "Movement trip",
        sustainRateApPerHour: Number(baseRateApPerHour.toFixed(4)),
        totalCostAp: Number(baseRateApPerHour.toFixed(4)),
        demandWeights: {
            activation: 0.05,
            focus,
            vigor,
            composure: 0,
            flow: Math.max(0.05, Number(flow.toFixed(3)))
        }
    });
}
function buildMovementTripContributions(userId, range, now, lifeForceProfile) {
    let rows = [];
    try {
        rows = getDatabase()
            .prepare(`SELECT
           id,
           label,
           status,
           travel_mode,
           activity_type,
           started_at,
           ended_at,
           moving_seconds,
           idle_seconds,
           expected_met,
           distance_meters
         FROM movement_trips
         WHERE user_id = ?
           AND started_at < ?
           AND ended_at >= ?`)
            .all(userId, range.to, range.from);
    }
    catch {
        rows = [];
    }
    const contributions = [];
    const activeDrains = [];
    for (const row of rows) {
        const seconds = Math.max(0, Math.floor((Math.min(range.endMs, Date.parse(row.ended_at)) -
            Math.max(range.startMs, Date.parse(row.started_at))) /
            1000));
        if (seconds <= 0) {
            continue;
        }
        const profile = buildEffectiveProfile(buildMovementTripProfile(row), lifeForceProfile);
        const contribution = {
            entityType: "movement_trip",
            entityId: row.id,
            eventKind: "movement_trip",
            sourceKind: "movement",
            totalAp: rateToTotalAp(profile.sustainRateApPerHour, seconds),
            rateApPerHour: profile.sustainRateApPerHour,
            title: row.label || row.activity_type || row.travel_mode || "Movement trip",
            why: "Movement and commuting consume current capacity through physical effort, attention, and switching overhead.",
            startsAt: new Date(Math.max(range.startMs, Date.parse(row.started_at))).toISOString(),
            endsAt: new Date(Math.min(range.endMs, Date.parse(row.ended_at))).toISOString(),
            role: "secondary"
        };
        contributions.push(contribution);
        if (Date.parse(row.started_at) <= now.getTime() && Date.parse(row.ended_at) > now.getTime()) {
            activeDrains.push({ ...contribution, totalAp: 0 });
        }
    }
    return { contributions, activeDrains };
}
function readTaskTimeboxLifeForceRows(userId, range) {
    try {
        return getDatabase()
            .prepare(`SELECT
           task_timeboxes.id,
           task_timeboxes.task_id,
           task_timeboxes.linked_task_run_id,
           task_timeboxes.status,
           task_timeboxes.source,
           task_timeboxes.title,
           task_timeboxes.starts_at,
           task_timeboxes.ends_at,
           tasks.planned_duration_seconds AS task_planned_duration_seconds
         FROM task_timeboxes
         INNER JOIN tasks ON tasks.id = task_timeboxes.task_id
         INNER JOIN entity_owners
           ON entity_owners.entity_type = 'task_timebox'
          AND entity_owners.entity_id = task_timeboxes.id
          AND entity_owners.role = 'owner'
         WHERE entity_owners.user_id = ?
           AND task_timeboxes.ends_at > ?
           AND task_timeboxes.starts_at < ?
         ORDER BY task_timeboxes.starts_at ASC`)
            .all(userId, range.from, range.to);
    }
    catch {
        return [];
    }
}
function readCalendarEventLifeForceRows(range) {
    try {
        return getDatabase()
            .prepare(`SELECT
           forge_events.id,
           forge_events.title,
           forge_events.start_at,
           forge_events.end_at,
           forge_events.availability,
           forge_events.event_type,
           COUNT(forge_event_links.id) AS link_count
         FROM forge_events
         LEFT JOIN forge_event_links
           ON forge_event_links.forge_event_id = forge_events.id
         WHERE forge_events.deleted_at IS NULL
           AND forge_events.end_at > ?
           AND forge_events.start_at < ?
         GROUP BY
           forge_events.id,
           forge_events.title,
           forge_events.start_at,
           forge_events.end_at,
           forge_events.availability,
           forge_events.event_type`)
            .all(range.from, range.to);
    }
    catch {
        return [];
    }
}
function readWorkBlockTemplateLifeForceRows(userId) {
    try {
        return getDatabase()
            .prepare(`SELECT
           work_block_templates.id,
           work_block_templates.title,
           work_block_templates.kind,
           work_block_templates.color,
           work_block_templates.weekdays_json,
           work_block_templates.start_minute,
           work_block_templates.end_minute,
           work_block_templates.starts_on,
           work_block_templates.ends_on,
           work_block_templates.blocking_state,
           work_block_templates.created_at,
           work_block_templates.updated_at
         FROM work_block_templates
         INNER JOIN entity_owners
           ON entity_owners.entity_type = 'work_block_template'
          AND entity_owners.entity_id = work_block_templates.id
          AND entity_owners.role = 'owner'
         WHERE entity_owners.user_id = ?`)
            .all(userId);
    }
    catch {
        return [];
    }
}
function parseWeekdaysJson(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((entry) => Number.isInteger(entry))
            : [];
    }
    catch {
        return [];
    }
}
function deriveTodayWorkBlocks(userId, range) {
    const dayDate = new Date(range.startMs);
    const dayKey = range.dateKey;
    return readWorkBlockTemplateLifeForceRows(userId)
        .filter((template) => {
        if (template.starts_on && dayKey < template.starts_on) {
            return false;
        }
        if (template.ends_on && dayKey > template.ends_on) {
            return false;
        }
        return parseWeekdaysJson(template.weekdays_json).includes(dayDate.getUTCDay());
    })
        .map((template) => {
        const startAt = new Date(range.startMs + template.start_minute * 60_000).toISOString();
        const endAt = new Date(range.startMs + template.end_minute * 60_000).toISOString();
        return {
            ...template,
            instance_id: `wbinst_${template.id}_${dayKey}`,
            start_at: startAt,
            end_at: endAt
        };
    });
}
function buildWorkBlockProfile(input) {
    const storedProfile = readEntityActionProfile("work_block_template", input.templateId, {
        profileKey: `work_block_template_${input.templateId}`,
        title: input.title,
        entityType: "work_block_template"
    });
    if (storedProfile) {
        return storedProfile;
    }
    const startMinute = new Date(input.startAt).getUTCHours() * 60 + new Date(input.startAt).getUTCMinutes();
    const endMinute = new Date(input.endAt).getUTCHours() * 60 + new Date(input.endAt).getUTCMinutes();
    return buildWorkBlockTemplateActionProfile({
        templateId: input.templateId,
        title: input.title,
        kind: input.kind,
        startMinute,
        endMinute
    });
}
function buildTimeboxAndWorkBlockDrains(userId, range, now, lifeForceProfile, activeTaskRunTaskIds, actualSourceWindows, calendarEventWindows) {
    const actualContributions = [];
    const plannedDrains = [];
    const activeDrains = [];
    const timeboxWindows = [];
    const workBlockWindows = [];
    const timeboxes = readTaskTimeboxLifeForceRows(userId, range);
    for (const row of timeboxes) {
        if (row.linked_task_run_id || row.status === "cancelled") {
            continue;
        }
        timeboxWindows.push({
            startAt: row.starts_at,
            endAt: row.ends_at
        });
        const storedProfile = readEntityActionProfile("task_timebox", row.id, {
            profileKey: `task_timebox_${row.id}`,
            title: row.title,
            entityType: "task_timebox"
        });
        const profile = lifeForceProfile
            ? buildEffectiveProfile(storedProfile ??
                buildTaskTimeboxActionProfile({
                    timeboxId: row.id,
                    title: row.title,
                    taskId: row.task_id,
                    taskPlannedDurationSeconds: row.task_planned_duration_seconds,
                    startsAt: row.starts_at,
                    endsAt: row.ends_at
                }), lifeForceProfile)
            : storedProfile ??
                buildTaskTimeboxActionProfile({
                    timeboxId: row.id,
                    title: row.title,
                    taskId: row.task_id,
                    taskPlannedDurationSeconds: row.task_planned_duration_seconds,
                    startsAt: row.starts_at,
                    endsAt: row.ends_at
                });
        const higherPriorityWindows = [...actualSourceWindows, ...calendarEventWindows];
        const elapsedWindow = {
            startAt: row.starts_at,
            endAt: new Date(Math.min(now.getTime(), Date.parse(row.ends_at))).toISOString()
        };
        const elapsedSeconds = computeUncoveredSeconds(elapsedWindow, higherPriorityWindows);
        if (elapsedSeconds > 0) {
            actualContributions.push({
                entityType: "task_timebox",
                entityId: row.id,
                eventKind: "task_timebox_actual",
                sourceKind: "task_timebox",
                totalAp: rateToTotalAp(profile.sustainRateApPerHour, elapsedSeconds),
                rateApPerHour: profile.sustainRateApPerHour,
                title: row.title,
                why: "Elapsed timeboxes count toward today's Action Point spend when no richer timed source covered that window.",
                startsAt: row.starts_at,
                endsAt: elapsedWindow.endAt,
                role: "background",
                metadata: {}
            });
        }
        const remainingStartMs = Math.max(now.getTime(), Date.parse(row.starts_at));
        const remainingEndMs = Math.min(range.endMs, Date.parse(row.ends_at));
        const remainingWindow = remainingEndMs > remainingStartMs
            ? {
                startAt: new Date(remainingStartMs).toISOString(),
                endAt: new Date(remainingEndMs).toISOString()
            }
            : null;
        const remainingSeconds = remainingWindow
            ? computeUncoveredSeconds(remainingWindow, higherPriorityWindows)
            : 0;
        if (remainingSeconds > 0) {
            plannedDrains.push({
                entityType: "task_timebox",
                entityId: row.id,
                eventKind: "task_timebox_plan",
                sourceKind: "task_timebox",
                totalAp: rateToTotalAp(profile.sustainRateApPerHour, remainingSeconds),
                rateApPerHour: profile.sustainRateApPerHour,
                title: row.title,
                why: "Planned task timeboxes forecast how much Action Point throughput is still booked today.",
                startsAt: remainingWindow?.startAt ?? row.starts_at,
                endsAt: remainingWindow?.endAt ?? row.ends_at,
                role: "secondary"
            });
        }
        if (Date.parse(row.starts_at) <= now.getTime() &&
            Date.parse(row.ends_at) > now.getTime() &&
            !activeTaskRunTaskIds.has(row.task_id) &&
            !isInstantCovered(now.toISOString(), higherPriorityWindows)) {
            activeDrains.push({
                entityType: "task_timebox",
                entityId: row.id,
                eventKind: "task_timebox_context",
                sourceKind: "task_timebox",
                totalAp: 0,
                rateApPerHour: profile.sustainRateApPerHour,
                title: row.title,
                why: "An active timebox still occupies current capacity even before live work logging starts.",
                startsAt: row.starts_at,
                endsAt: row.ends_at,
                role: "background",
                metadata: {}
            });
        }
    }
    const workBlocks = deriveTodayWorkBlocks(userId, range);
    for (const block of workBlocks) {
        workBlockWindows.push({
            startAt: block.start_at,
            endAt: block.end_at
        });
        const higherPriorityWindows = [
            ...actualSourceWindows,
            ...calendarEventWindows,
            ...timeboxWindows
        ];
        const profile = buildEffectiveProfile(buildWorkBlockProfile({
            templateId: block.id,
            title: block.title,
            kind: block.kind,
            startAt: block.start_at,
            endAt: block.end_at
        }), lifeForceProfile);
        const elapsedWindow = {
            startAt: block.start_at,
            endAt: new Date(Math.min(now.getTime(), Date.parse(block.end_at))).toISOString()
        };
        const elapsedSeconds = computeUncoveredSeconds(elapsedWindow, higherPriorityWindows);
        if (elapsedSeconds > 0) {
            actualContributions.push({
                entityType: "work_block",
                entityId: block.instance_id,
                eventKind: "work_block_actual",
                sourceKind: "work_block",
                totalAp: rateToTotalAp(profile.sustainRateApPerHour, elapsedSeconds),
                rateApPerHour: profile.sustainRateApPerHour,
                title: block.title,
                why: "Elapsed work blocks count toward today's spend when no specific task run or timebox covered that work window.",
                startsAt: block.start_at,
                endsAt: elapsedWindow.endAt,
                role: "background",
                metadata: {
                    templateId: block.id,
                    kind: block.kind
                }
            });
        }
        const remainingStartMs = Math.max(now.getTime(), Date.parse(block.start_at));
        const remainingEndMs = Math.min(range.endMs, Date.parse(block.end_at));
        const remainingWindow = remainingEndMs > remainingStartMs
            ? {
                startAt: new Date(remainingStartMs).toISOString(),
                endAt: new Date(remainingEndMs).toISOString()
            }
            : null;
        const remainingSeconds = remainingWindow
            ? computeUncoveredSeconds(remainingWindow, higherPriorityWindows)
            : 0;
        if (remainingSeconds > 0) {
            plannedDrains.push({
                entityType: "work_block",
                entityId: block.instance_id,
                eventKind: "work_block_plan",
                sourceKind: "work_block",
                totalAp: rateToTotalAp(profile.sustainRateApPerHour, remainingSeconds),
                rateApPerHour: profile.sustainRateApPerHour,
                title: block.title,
                why: "Work blocks act as planning containers and forecast background load when no richer task plan exists.",
                startsAt: remainingWindow?.startAt ?? block.start_at,
                endsAt: remainingWindow?.endAt ?? block.end_at,
                role: "background",
                metadata: {
                    templateId: block.id,
                    kind: block.kind
                }
            });
        }
        if (Date.parse(block.start_at) <= now.getTime() &&
            Date.parse(block.end_at) > now.getTime() &&
            activeTaskRunTaskIds.size === 0 &&
            !isInstantCovered(now.toISOString(), higherPriorityWindows)) {
            activeDrains.push({
                entityType: "work_block",
                entityId: block.instance_id,
                eventKind: "work_block_context",
                sourceKind: "work_block",
                totalAp: 0,
                rateApPerHour: profile.sustainRateApPerHour,
                title: block.title,
                why: "The current work block still claims capacity as a container for focused effort.",
                startsAt: block.start_at,
                endsAt: block.end_at,
                role: "background",
                metadata: {
                    templateId: block.id,
                    kind: block.kind
                }
            });
        }
    }
    return {
        actualContributions,
        plannedDrains,
        activeDrains,
        timeboxWindows,
        workBlockWindows
    };
}
function buildCalendarDrains(rows, now, range, lifeForceProfile, blockingWindows) {
    const actualContributions = [];
    const nowIsoValue = now.toISOString();
    const activeDrains = [];
    const plannedDrains = [];
    try {
        for (const row of rows) {
            const calendarProfile = buildEffectiveProfile(readEntityActionProfile("calendar_event", row.id, {
                profileKey: `calendar_event_${row.id}`,
                title: row.title,
                entityType: "calendar_event"
            }) ??
                buildCalendarEventActionProfile({
                    eventId: row.id,
                    title: row.title,
                    eventType: row.event_type,
                    availability: row.availability,
                    startAt: row.start_at,
                    endAt: row.end_at
                }), lifeForceProfile);
            const elapsedWindow = {
                startAt: row.start_at,
                endAt: new Date(Math.min(now.getTime(), Date.parse(row.end_at))).toISOString()
            };
            const elapsedSeconds = computeUncoveredSeconds(elapsedWindow, blockingWindows);
            if (elapsedSeconds > 0 && row.link_count === 0) {
                actualContributions.push({
                    entityType: "calendar_event",
                    entityId: row.id,
                    eventKind: "calendar_event_actual",
                    sourceKind: "calendar",
                    totalAp: rateToTotalAp(calendarProfile.sustainRateApPerHour, elapsedSeconds),
                    rateApPerHour: calendarProfile.sustainRateApPerHour,
                    title: row.title,
                    why: "Busy calendar events debit today's AP when they were real containers and nothing richer occupied the same window.",
                    startsAt: row.start_at,
                    endsAt: elapsedWindow.endAt,
                    role: "background",
                    metadata: {}
                });
            }
            const remainingStartMs = Math.max(now.getTime(), Date.parse(row.start_at));
            const remainingEndMs = Math.min(range.endMs, Date.parse(row.end_at));
            const remainingSeconds = Math.max(0, Math.floor((remainingEndMs - remainingStartMs) / 1000));
            if (remainingSeconds > 0 && row.link_count === 0) {
                plannedDrains.push({
                    entityType: "calendar_event",
                    entityId: row.id,
                    eventKind: "calendar_event_plan",
                    sourceKind: "calendar",
                    totalAp: rateToTotalAp(calendarProfile.sustainRateApPerHour, remainingSeconds),
                    rateApPerHour: calendarProfile.sustainRateApPerHour,
                    title: row.title,
                    why: "Busy calendar events reserve attention and social bandwidth even before deeper work is linked to them.",
                    startsAt: row.start_at,
                    endsAt: row.end_at,
                    role: "background",
                    metadata: {}
                });
            }
            if (row.start_at <= nowIsoValue &&
                row.end_at > nowIsoValue &&
                !isInstantCovered(nowIsoValue, blockingWindows)) {
                activeDrains.push({
                    entityType: "calendar_event",
                    entityId: row.id,
                    eventKind: "calendar_context",
                    sourceKind: "calendar",
                    totalAp: 0,
                    rateApPerHour: calendarProfile.sustainRateApPerHour,
                    title: row.title,
                    why: "Calendar context occupies mental and social capacity even before task work is logged.",
                    startsAt: row.start_at,
                    endsAt: row.end_at,
                    role: "background",
                    metadata: {}
                });
            }
        }
    }
    catch {
        return { actualContributions, activeDrains, plannedDrains };
    }
    return { actualContributions, activeDrains, plannedDrains };
}
function syncApLedger(userId, range, contributions) {
    runInTransaction(() => {
        const database = getDatabase();
        database
            .prepare(`DELETE FROM ap_ledger_events
         WHERE user_id = ? AND date_key = ?`)
            .run(userId, range.dateKey);
        const insert = database.prepare(`INSERT INTO ap_ledger_events (
         id,
         user_id,
         date_key,
         entity_type,
         entity_id,
         event_kind,
         source_kind,
         starts_at,
         ends_at,
         total_ap,
         rate_ap_per_hour,
         metadata_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const createdAt = nowIso();
        for (const contribution of contributions) {
            insert.run(`ap_${randomUUID().replaceAll("-", "").slice(0, 12)}`, userId, range.dateKey, contribution.entityType, contribution.entityId, contribution.eventKind, contribution.sourceKind, contribution.startsAt, contribution.endsAt, Number(contribution.totalAp.toFixed(4)), contribution.rateApPerHour, JSON.stringify({
                title: contribution.title,
                why: contribution.why,
                role: contribution.role,
                ...(contribution.metadata ?? {})
            }), createdAt);
        }
    });
}
function syncStatXpEvents(userId, dateKey, contributions) {
    const totals = new Map();
    for (const contribution of contributions) {
        if (contribution.totalAp <= 0) {
            continue;
        }
        const weights = contribution.profile?.demandWeights ?? {
            activation: 0.2,
            focus: 0.25,
            vigor: 0.2,
            composure: 0.15,
            flow: 0.2
        };
        for (const [key, weight] of Object.entries(weights)) {
            totals.set(key, Number(((totals.get(key) ?? 0) + contribution.totalAp * weight).toFixed(4)));
        }
        totals.set("life_force", Number(((totals.get("life_force") ?? 0) + contribution.totalAp * 0.35).toFixed(4)));
    }
    runInTransaction(() => {
        const database = getDatabase();
        database
            .prepare(`DELETE FROM stat_xp_events
         WHERE user_id = ?
           AND json_extract(metadata_json, '$.dateKey') = ?`)
            .run(userId, dateKey);
        const insert = database.prepare(`INSERT INTO stat_xp_events (
         id,
         user_id,
         stat_key,
         delta_xp,
         entity_type,
         entity_id,
         metadata_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const createdAt = nowIso();
        for (const [statKey, deltaXp] of totals.entries()) {
            insert.run(`statxp_${userId}_${dateKey}_${statKey}`, userId, statKey, deltaXp, "system", dateKey, JSON.stringify({
                source: "life_force_daily_rollup",
                dateKey
            }), createdAt);
        }
    });
}
function readTodayLedger(userId, dateKey) {
    return getDatabase()
        .prepare(`SELECT *
       FROM ap_ledger_events
       WHERE user_id = ? AND date_key = ?
       ORDER BY created_at ASC`)
        .all(userId, dateKey);
}
function readTodayFatigueSignals(userId, dateKey) {
    return getDatabase()
        .prepare(`SELECT signal_type, delta
       FROM fatigue_signals
       WHERE user_id = ? AND date_key = ?`)
        .all(userId, dateKey);
}
function buildWarnings(input) {
    const warnings = [];
    if (input.isOverloadedNow) {
        warnings.push({
            id: "lf_overload",
            tone: "danger",
            title: "You are overloaded right now",
            detail: "Current concurrent work is draining more than the available instant capacity."
        });
    }
    if (input.spentTodayAp > input.dailyBudgetAp) {
        warnings.push({
            id: "lf_overspent",
            tone: "warning",
            title: "Daily AP is in debt",
            detail: "Today has already exceeded the calibrated Action Point budget."
        });
    }
    if (input.topTaskIdsNeedingSplit.length > 0) {
        warnings.push({
            id: "lf_split",
            tone: "info",
            title: "A task wants to be split",
            detail: "One or more tasks have grown beyond a healthy expected duration."
        });
    }
    if (warnings.length === 0) {
        warnings.push({
            id: "lf_stable",
            tone: "success",
            title: "Life Force is stable",
            detail: "Today is still inside a healthy capacity band."
        });
    }
    return warnings;
}
export function resolveLifeForceUser(userIds) {
    if (userIds && userIds.length > 0) {
        return getUserById(userIds[0]) ?? getDefaultUser();
    }
    return getDefaultUser();
}
export function buildLifeForcePayload(now = new Date(), userIds) {
    ensureActionProfileTemplates();
    const user = resolveLifeForceUser(userIds);
    const profile = ensureLifeForceProfile(user.id);
    const snapshot = getOrCreateDaySnapshot(user.id, now);
    const range = buildDayRange(now);
    const taskRuns = buildTaskRunContributions(user.id, range, now, profile);
    const notes = buildNoteContributions(user.id, range, now, profile);
    const habits = buildHabitContributions(user.id, range, profile);
    const workouts = buildWorkoutContributions(user.id, range, now, profile);
    const movement = buildMovementTripContributions(user.id, range, now, profile);
    const wakeImpulses = buildWakeImpulseContributions(user.id, range, profile);
    const adjustments = buildWorkAdjustmentContributions(user.id, range, profile);
    const actualSourceWindows = [
        ...taskRuns.contributions,
        ...workouts.contributions,
        ...movement.contributions
    ]
        .filter((entry) => Boolean(entry.startsAt && entry.endsAt))
        .map((entry) => ({
        startAt: entry.startsAt,
        endAt: entry.endsAt
    }));
    const calendarRows = readCalendarEventLifeForceRows(range);
    const calendarEventWindows = calendarRows.map((row) => ({
        startAt: row.start_at,
        endAt: row.end_at
    }));
    const activeTaskRunTaskIds = new Set(taskRuns.activeDrains.map((entry) => entry.entityId));
    const plannedContainers = buildTimeboxAndWorkBlockDrains(user.id, range, now, profile, activeTaskRunTaskIds, actualSourceWindows, calendarEventWindows);
    const calendarBlockingWindows = [...actualSourceWindows];
    const calendarDrains = buildCalendarDrains(calendarRows, now, range, profile, calendarBlockingWindows);
    const contributions = [
        ...taskRuns.contributions,
        ...adjustments,
        ...notes,
        ...habits,
        ...workouts.contributions,
        ...movement.contributions,
        ...wakeImpulses,
        ...plannedContainers.actualContributions,
        ...calendarDrains.actualContributions
    ];
    const seededProfilesByKey = new Map(seededActionProfiles().map((entry) => [entry.profileKey, entry]));
    const taskDurationRows = getDatabase()
        .prepare(`SELECT id, planned_duration_seconds
       FROM tasks`)
        .all();
    const taskDurationById = new Map(taskDurationRows.map((row) => [row.id, row.planned_duration_seconds]));
    const profileLookup = new Map();
    for (const contribution of contributions) {
        if (contribution.entityType === "task") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, resolveTaskActionProfile({
                id: contribution.entityId,
                plannedDurationSeconds: taskDurationById.get(contribution.entityId) ?? null
            }, profile));
            continue;
        }
        if (contribution.entityType === "note") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(seededProfilesByKey.get("note_quick") ?? seededActionProfiles()[0], profile));
            continue;
        }
        if (contribution.entityType === "habit") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(seededProfilesByKey.get("habit_default") ?? seededActionProfiles()[0], profile));
            continue;
        }
        if (contribution.entityType === "workout_session") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(seededProfilesByKey.get("workout_default") ?? seededActionProfiles()[0], profile));
            continue;
        }
        if (contribution.entityType === "movement_trip") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(seededProfilesByKey.get("movement_trip_default") ?? seededActionProfiles()[0], profile));
            continue;
        }
        if (contribution.entityType === "task_timebox") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(readEntityActionProfile("task_timebox", contribution.entityId, {
                profileKey: `task_timebox_${contribution.entityId}`,
                title: contribution.title,
                entityType: "task_timebox"
            }) ??
                (seededProfilesByKey.get("task_timebox_default") ?? seededActionProfiles()[0]), profile));
            continue;
        }
        if (contribution.entityType === "work_block") {
            const metadata = "metadata" in contribution &&
                contribution.metadata &&
                typeof contribution.metadata === "object"
                ? contribution.metadata
                : undefined;
            const templateId = typeof metadata?.templateId === "string"
                ? metadata.templateId
                : contribution.entityId;
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(readEntityActionProfile("work_block_template", templateId, {
                profileKey: `work_block_template_${templateId}`,
                title: contribution.title,
                entityType: "work_block_template"
            }) ??
                (seededProfilesByKey.get("work_block_main") ?? seededActionProfiles()[0]), profile));
            continue;
        }
        if (contribution.entityType === "calendar_event") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(readEntityActionProfile("calendar_event", contribution.entityId, {
                profileKey: `calendar_event_${contribution.entityId}`,
                title: contribution.title,
                entityType: "calendar_event"
            }) ??
                (seededProfilesByKey.get("calendar_event_default") ?? seededActionProfiles()[0]), profile));
            continue;
        }
        if (contribution.eventKind === "wake_start") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, buildEffectiveProfile(seededProfilesByKey.get("wake_start") ?? seededActionProfiles()[0], profile));
        }
    }
    const adjustmentApByTaskId = readTodayAdjustmentApByTaskId(user.id, range, profile);
    for (const [taskId, adjustmentAp] of adjustmentApByTaskId.entries()) {
        const existing = taskRuns.totalsByTaskId.get(taskId) ?? { todayAp: 0, totalAp: 0 };
        existing.todayAp += adjustmentAp;
        existing.totalAp += adjustmentAp;
        taskRuns.totalsByTaskId.set(taskId, existing);
    }
    syncApLedger(user.id, range, contributions);
    syncStatXpEvents(user.id, range.dateKey, contributions.map((contribution) => ({
        ...contribution,
        profile: profileLookup.get(`${contribution.entityType}:${contribution.entityId}`) ?? null
    })));
    const ledger = readTodayLedger(user.id, range.dateKey);
    const spentTodayAp = ledger.reduce((sum, row) => sum + row.total_ap, 0);
    const currentCurve = parseCurvePoints(snapshot.points_json);
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const instantCapacityApPerHour = interpolateCurveRate(currentCurve, minuteOfDay);
    const activeSourceWindows = [
        ...taskRuns.activeDrains,
        ...workouts.activeDrains,
        ...movement.activeDrains,
        ...plannedContainers.activeDrains
    ].map((entry) => ({
        startAt: entry.startsAt ?? now.toISOString(),
        endAt: entry.endsAt ?? now.toISOString()
    }));
    const activeDrains = [
        ...taskRuns.activeDrains,
        ...workouts.activeDrains,
        ...movement.activeDrains,
        ...plannedContainers.activeDrains,
        ...calendarDrains.activeDrains
    ]
        .sort((left, right) => (right.rateApPerHour ?? 0) - (left.rateApPerHour ?? 0))
        .map((entry, index) => ({
        id: `${entry.sourceKind}:${entry.entityId}`,
        sourceType: entry.entityType,
        sourceId: entry.entityId,
        title: entry.title,
        role: index === 0 ? "primary" : entry.role,
        apPerHour: Number((entry.rateApPerHour ?? 0).toFixed(2)),
        instantAp: Number((entry.totalAp ?? 0).toFixed(2)),
        why: entry.why,
        startedAt: entry.startsAt,
        endsAt: entry.endsAt
    }));
    const plannedDrains = [
        ...plannedContainers.plannedDrains,
        ...calendarDrains.plannedDrains
    ]
        .sort((left, right) => Date.parse(left.startsAt ?? now.toISOString()) - Date.parse(right.startsAt ?? now.toISOString()))
        .map((entry) => ({
        id: `${entry.sourceKind}:${entry.entityId}`,
        sourceType: entry.entityType,
        sourceId: entry.entityId,
        title: entry.title,
        role: entry.role,
        apPerHour: Number((entry.rateApPerHour ?? 0).toFixed(2)),
        instantAp: Number((entry.totalAp ?? 0).toFixed(2)),
        why: entry.why,
        startedAt: entry.startsAt,
        endsAt: entry.endsAt
    }));
    const sortedRates = activeDrains
        .map((entry) => entry.apPerHour)
        .sort((left, right) => right - left);
    const currentDrainApPerHour = (sortedRates[0] ?? 0) +
        (sortedRates[1] ?? 0) * 0.6 +
        (sortedRates[2] ?? 0) * 0.35 +
        sortedRates.slice(3).reduce((sum, value) => sum + value * 0.2, 0);
    const fatigueFromSignals = readTodayFatigueSignals(user.id, range.dateKey).reduce((sum, signal) => sum + signal.delta, 0);
    const fatigueBufferApPerHour = Math.max(0, Number((fatigueFromSignals + Math.max(0, activeDrains.length - 1) * 1.5).toFixed(2)));
    const rawInstantFreeApPerHour = Number((instantCapacityApPerHour - currentDrainApPerHour - fatigueBufferApPerHour).toFixed(2));
    const instantFreeApPerHour = Math.max(0, rawInstantFreeApPerHour);
    const overloadApPerHour = Math.max(0, Number((-rawInstantFreeApPerHour).toFixed(2)));
    const remainingAp = Number((snapshot.daily_budget_ap - spentTodayAp).toFixed(2));
    const plannedRemainingAp = Number(plannedDrains.reduce((sum, entry) => sum + entry.instantAp, 0).toFixed(2));
    const forecastAp = Number((spentTodayAp + plannedRemainingAp).toFixed(2));
    const targetBandMinAp = Number((snapshot.daily_budget_ap * 0.85).toFixed(2));
    const targetBandMaxAp = Number(snapshot.daily_budget_ap.toFixed(2));
    const workTime = computeWorkTime(now);
    const topTaskIdsNeedingSplit = getDatabase()
        .prepare(`SELECT tasks.id, tasks.planned_duration_seconds
       FROM tasks
       INNER JOIN entity_owners
         ON entity_owners.entity_type = 'task'
        AND entity_owners.entity_id = tasks.id
        AND entity_owners.role = 'owner'
       WHERE entity_owners.user_id = ?`)
        .all(user.id)
        .map((row) => row)
        .filter((row) => {
        const time = workTime.taskSummaries.get(row.id);
        return buildTaskSplitSuggestion({
            plannedDurationSeconds: row.planned_duration_seconds,
            totalTrackedSeconds: time?.totalCreditedSeconds ?? 0,
            projectedTotalSeconds: (time?.totalCreditedSeconds ?? 0) +
                readActiveTaskRunProjectionRows(row.id).reduce((sum, activeRow) => sum + computeProjectedRemainingSeconds(activeRow, now), 0)
        }).shouldSplit;
    })
        .map((row) => row.id)
        .slice(0, 3);
    return lifeForcePayloadSchema.parse({
        userId: user.id,
        dateKey: range.dateKey,
        baselineDailyAp: profile.base_daily_ap,
        dailyBudgetAp: Number(snapshot.daily_budget_ap.toFixed(2)),
        spentTodayAp: Number(spentTodayAp.toFixed(2)),
        remainingAp,
        forecastAp,
        plannedRemainingAp,
        targetBandMinAp,
        targetBandMaxAp,
        instantCapacityApPerHour: Number(instantCapacityApPerHour.toFixed(2)),
        instantFreeApPerHour,
        overloadApPerHour,
        currentDrainApPerHour: Number(currentDrainApPerHour.toFixed(2)),
        fatigueBufferApPerHour,
        sleepRecoveryMultiplier: snapshot.sleep_recovery_multiplier,
        readinessMultiplier: snapshot.readiness_multiplier,
        fatigueDebtCarry: snapshot.fatigue_debt_carry,
        stats: buildStats(profile, user.id),
        currentCurve: currentCurve.map((point) => ({
            ...point,
            locked: point.minuteOfDay <= minuteOfDay
        })),
        activeDrains,
        plannedDrains,
        warnings: buildWarnings({
            spentTodayAp,
            dailyBudgetAp: snapshot.daily_budget_ap,
            isOverloadedNow: rawInstantFreeApPerHour < 0,
            topTaskIdsNeedingSplit
        }),
        recommendations: [
            instantFreeApPerHour <= 0
                ? "Reduce overlap or take a recovery action before starting something new."
                : instantCapacityApPerHour > currentDrainApPerHour + 4
                    ? "This is a good moment for deep work."
                    : "Favor lower-friction admin or recovery until headroom increases."
        ],
        topTaskIdsNeedingSplit,
        updatedAt: now.toISOString()
    });
}
export function buildTaskLifeForceFields(task, userId) {
    const effectiveUserId = userId ?? task.userId ?? getDefaultUser().id;
    const runtime = buildTaskLifeForceRuntime(task, effectiveUserId);
    return {
        actionPointSummary: buildTaskActionPointSummary({
            plannedDurationSeconds: task.plannedDurationSeconds,
            totalCostAp: runtime.profile.totalCostAp,
            spentTodayAp: runtime.spentTodayAp,
            spentTotalAp: runtime.spentTotalAp
        }),
        splitSuggestion: buildTaskSplitSuggestion({
            plannedDurationSeconds: task.plannedDurationSeconds,
            totalTrackedSeconds: task.time.totalCreditedSeconds,
            projectedTotalSeconds: runtime.projectedTotalSeconds
        })
    };
}
export function getTaskCompletionRequirement(task, userId) {
    const effectiveUserId = userId ?? task.userId ?? getDefaultUser().id;
    const runtime = buildTaskLifeForceRuntime(task, effectiveUserId);
    return {
        todayCreditedSeconds: runtime.todayCreditedSeconds,
        requiresWorkLog: runtime.todayCreditedSeconds <= 0
    };
}
export function updateLifeForceProfile(userId, patch) {
    const parsed = lifeForceProfilePatchSchema.parse(patch);
    const current = ensureLifeForceProfile(userId);
    const next = {
        base_daily_ap: parsed.baseDailyAp ?? current.base_daily_ap,
        readiness_multiplier: parsed.readinessMultiplier ?? current.readiness_multiplier,
        life_force_level: parsed.stats?.life_force ?? current.life_force_level,
        activation_level: parsed.stats?.activation ?? current.activation_level,
        focus_level: parsed.stats?.focus ?? current.focus_level,
        vigor_level: parsed.stats?.vigor ?? current.vigor_level,
        composure_level: parsed.stats?.composure ?? current.composure_level,
        flow_level: parsed.stats?.flow ?? current.flow_level
    };
    getDatabase()
        .prepare(`UPDATE life_force_profiles
       SET base_daily_ap = ?,
           readiness_multiplier = ?,
           life_force_level = ?,
           activation_level = ?,
           focus_level = ?,
           vigor_level = ?,
           composure_level = ?,
           flow_level = ?,
           updated_at = ?
       WHERE user_id = ?`)
        .run(next.base_daily_ap, next.readiness_multiplier, next.life_force_level, next.activation_level, next.focus_level, next.vigor_level, next.composure_level, next.flow_level, nowIso(), userId);
    const todayKey = toDateKey(new Date());
    getDatabase()
        .prepare(`DELETE FROM life_force_day_snapshots
       WHERE user_id = ? AND date_key = ?`)
        .run(userId, todayKey);
    return buildLifeForcePayload(new Date(), [userId]);
}
export function updateLifeForceTemplate(userId, weekday, input) {
    const parsed = lifeForceTemplateUpdateSchema.parse(input);
    ensureWeekdayTemplates(userId);
    const normalized = normalizeCurveToBudget([...parsed.points].sort((left, right) => left.minuteOfDay - right.minuteOfDay), LIFE_FORCE_BASELINE_DAILY_AP);
    getDatabase()
        .prepare(`UPDATE life_force_weekday_templates
       SET points_json = ?, updated_at = ?
       WHERE user_id = ? AND weekday = ?`)
        .run(JSON.stringify(normalized), nowIso(), userId, weekday);
    return normalized;
}
export function createFatigueSignal(userId, input) {
    const parsed = fatigueSignalCreateSchema.parse(input);
    const observedAt = parsed.observedAt ?? nowIso();
    const dateKey = observedAt.slice(0, 10);
    const delta = parsed.signalType === "tired" ? 4 : -4;
    getDatabase()
        .prepare(`INSERT INTO fatigue_signals (
         id,
         user_id,
         date_key,
         signal_type,
         observed_at,
         note,
         delta,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`fatigue_${randomUUID().replaceAll("-", "").slice(0, 12)}`, userId, dateKey, parsed.signalType, observedAt, parsed.note ?? "", delta, nowIso());
    return buildLifeForcePayload(new Date(observedAt), [userId]);
}
export function listLifeForceTemplates(userId) {
    ensureWeekdayTemplates(userId);
    return getDatabase()
        .prepare(`SELECT *
       FROM life_force_weekday_templates
       WHERE user_id = ?
       ORDER BY weekday ASC`)
        .all(userId)
        .map((row) => row)
        .map((row) => ({
        weekday: row.weekday,
        baselineDailyAp: row.baseline_daily_ap,
        points: parseCurvePoints(row.points_json)
    }));
}
