import { z } from "zod";
import {
  lifeForcePayloadSchema,
  taskRunSchema,
  taskSchema,
  taskTimeboxSchema,
  type LifeForcePayload,
  type Task,
  type TaskRun,
  type TaskTimebox
} from "./types.js";

export const TODAY_PRIORITY_DEFAULT_CANDIDATE_LIMIT = 24;
export const TODAY_PRIORITY_MAX_CANDIDATES = 100;

export const todayEvidenceStateSchema = z.enum([
  "fresh",
  "stale",
  "missing",
  "loading",
  "error"
]);

export const todaySourceStateSchema = z.enum([
  "ready",
  "loading",
  "error",
  "partial"
]);

export const todayPriorityEvidenceSchema = z
  .object({
    key: z.enum(["urgency", "schedule", "capacity", "active-context"]),
    label: z.string().min(1),
    state: todayEvidenceStateSchema,
    detail: z.string().min(1)
  })
  .strict();

export const todayRankedCandidateSchema = z
  .object({
    task: taskSchema,
    score: z.number().finite(),
    urgencyScore: z.number().finite(),
    scheduleScore: z.number().finite(),
    capacityScore: z.number().finite(),
    activeContextScore: z.number().finite(),
    hasActiveRun: z.boolean(),
    capacityFit: z.boolean().nullable(),
    requiredAp: z.number().finite().nonnegative(),
    requiredApEstimated: z.boolean(),
    timebox: taskTimeboxSchema.nullable(),
    evidence: z.array(todayPriorityEvidenceSchema).length(4),
    reason: z.string().min(1)
  })
  .strict();

export const todayPriorityDecisionSchema = z
  .object({
    contractVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    mode: z.enum([
      "ready",
      "continue-active",
      "unresolved-active",
      "overloaded",
      "capacity-limited",
      "no-work"
    ]),
    confidence: z.enum(["full", "limited"]),
    decisionUserId: z.string().min(1).nullable(),
    task: taskSchema.nullable(),
    activeRun: taskRunSchema.nullable(),
    activeRunCount: z.number().int().nonnegative(),
    summary: z.string().min(1),
    rankedCandidates: z
      .array(todayRankedCandidateSchema)
      .max(TODAY_PRIORITY_MAX_CANDIDATES),
    selectedCandidate: todayRankedCandidateSchema.nullable(),
    alternatives: z.array(todayRankedCandidateSchema).max(3),
    evidence: z.array(todayPriorityEvidenceSchema).length(4),
    blockedTaskCount: z.number().int().nonnegative(),
    needsRefresh: z.boolean(),
    isLoading: z.boolean()
  })
  .strict();

export const buildTodayPriorityDecisionInputSchema = z
  .object({
    tasks: z.array(taskSchema).max(10_000),
    activeTaskRuns: z.array(taskRunSchema).max(1_000),
    userId: z.string().trim().min(1).max(240).nullable().optional(),
    directiveTaskId: z.string().min(1).max(240).nullable().optional(),
    lifeForce: lifeForcePayloadSchema.optional(),
    timeboxes: z.array(taskTimeboxSchema).max(10_000).default([]),
    candidateLimit: z
      .number()
      .int()
      .min(1)
      .max(TODAY_PRIORITY_MAX_CANDIDATES)
      .default(TODAY_PRIORITY_DEFAULT_CANDIDATE_LIMIT),
    snapshotGeneratedAt: z.string().datetime().nullable().optional(),
    calendarGeneratedAt: z.string().datetime().nullable().optional(),
    calendarState: todaySourceStateSchema.default("ready"),
    capacityState: todaySourceStateSchema.default("ready"),
    now: z.date().default(() => new Date()),
    timeZone: z.string().trim().min(1).max(100).optional()
  })
  .strict();

export type TodayEvidenceState = z.infer<typeof todayEvidenceStateSchema>;
export type TodaySourceState = z.infer<typeof todaySourceStateSchema>;
export type TodayPriorityEvidence = z.infer<typeof todayPriorityEvidenceSchema>;
export type TodayRankedCandidate = z.infer<typeof todayRankedCandidateSchema>;
export type TodayPriorityDecision = z.infer<typeof todayPriorityDecisionSchema>;
export interface BuildTodayPriorityDecisionInput {
  tasks: Task[];
  activeTaskRuns: TaskRun[];
  userId?: string | null;
  directiveTaskId?: string | null;
  lifeForce?: LifeForcePayload;
  timeboxes?: TaskTimebox[];
  candidateLimit?: number;
  snapshotGeneratedAt?: string | null;
  calendarGeneratedAt?: string | null;
  calendarState?: TodaySourceState;
  capacityState?: TodaySourceState;
  now?: Date;
  timeZone?: string;
}
