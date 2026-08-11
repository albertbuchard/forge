import { z } from "zod";
import {
  derivedDataProvenanceSchema,
  type DerivedDataProvenance
} from "./provenance.js";
import { isValidTimeZone } from "./services/calendar-time.js";

export const DAILY_BRIEFING_LIMITS = {
  tasksInspected: 101,
  tasksPublished: 100,
  activeRunsInspected: 21,
  activeRunsPublished: 20,
  calendarInspected: 41,
  calendarPublished: 40,
  activityInspected: 13,
  activityPublished: 12,
  statements: 8,
  statementsPerSection: 3,
  evidencePerStatement: 4,
  responseBytes: 64 * 1024
} as const;

export const DAILY_BRIEFING_ACTIVITY_WINDOW_MS = 36 * 60 * 60 * 1_000;
export const DAILY_BRIEFING_CALENDAR_STALE_AFTER_SECONDS = 6 * 60 * 60;
export const DAILY_BRIEFING_FUTURE_TOLERANCE_SECONDS = 5 * 60;

export const dailyBriefingQuerySchema = z
  .object({
    userId: z.string().trim().min(1).max(240),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, "timeZone must be a valid IANA timezone")
      .optional()
  })
  .strict();

export const dailyBriefingSectionKeySchema = z.enum([
  "work",
  "schedule",
  "capacity",
  "recent_activity"
]);

export const dailyBriefingSectionStatusSchema = z.enum([
  "ready",
  "empty",
  "partial",
  "stale",
  "future",
  "conflict",
  "omitted"
]);

export const dailyBriefingStatementSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(500),
    href: z.string().trim().min(1).max(500).nullable(),
    observedAt: z.string().datetime().nullable(),
    freshness: z.enum(["fresh", "stale", "future", "missing"]),
    provenance: derivedDataProvenanceSchema
  })
  .strict()
  .superRefine((statement, context) => {
    if (statement.provenance.evidence.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenance", "evidence"],
        message:
          "A briefing statement requires at least one exact evidence reference."
      });
    }
    if (statement.provenance.freshness !== statement.freshness) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["freshness"],
        message: "Statement freshness must match its provenance envelope."
      });
    }
  });

export const dailyBriefingSectionSchema = z
  .object({
    key: dailyBriefingSectionKeySchema,
    label: z.string().trim().min(1).max(120),
    status: dailyBriefingSectionStatusSchema,
    statements: z
      .array(dailyBriefingStatementSchema)
      .max(DAILY_BRIEFING_LIMITS.statementsPerSection),
    omissionReason: z.string().trim().min(1).max(500).nullable(),
    inspectedCount: z.number().int().nonnegative(),
    availableCount: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((section, context) => {
    const needsReason = section.status !== "ready";
    if (needsReason && !section.omissionReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["omissionReason"],
        message: "Every non-ready briefing lane requires an omission reason."
      });
    }
    if (section.status === "ready" && section.omissionReason !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["omissionReason"],
        message: "A ready briefing lane cannot carry an omission reason."
      });
    }
    if (section.status === "ready" && section.statements.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statements"],
        message: "A ready briefing lane requires at least one statement."
      });
    }
  });

export const dailyBriefingSchema = z
  .object({
    contractVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timeZone: z.string().trim().min(1).max(100),
    ownerUserId: z.string().trim().min(1).max(240),
    status: z.enum(["ready", "partial", "empty", "conflict"]),
    headline: z.string().trim().min(1).max(500),
    sections: z.array(dailyBriefingSectionSchema).length(4)
  })
  .strict()
  .superRefine((briefing, context) => {
    const requiredOrder = [
      "work",
      "schedule",
      "capacity",
      "recent_activity"
    ] as const;
    requiredOrder.forEach((key, index) => {
      if (briefing.sections[index]?.key !== key) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", index, "key"],
          message: `Briefing lane ${index + 1} must be ${key}.`
        });
      }
    });
    const statementCount = briefing.sections.reduce(
      (total, section) => total + section.statements.length,
      0
    );
    if (statementCount > DAILY_BRIEFING_LIMITS.statements) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections"],
        message: `A briefing can publish at most ${DAILY_BRIEFING_LIMITS.statements} statements.`
      });
    }
  });

export type DailyBriefing = z.infer<typeof dailyBriefingSchema>;
export type DailyBriefingSection = z.infer<typeof dailyBriefingSectionSchema>;
export type DailyBriefingStatement = z.infer<
  typeof dailyBriefingStatementSchema
>;
export type DailyBriefingSectionStatus = z.infer<
  typeof dailyBriefingSectionStatusSchema
>;

export type DailyBriefingTaskSource = {
  id: string;
  title: string;
  status: "backlog" | "focus" | "in_progress" | "blocked" | "done";
  priority: "low" | "medium" | "high" | "critical";
  dueDate: string | null;
  projectId: string | null;
  updatedAt: string;
};

export type DailyBriefingActiveRunSource = {
  id: string;
  taskId: string;
  taskTitle: string;
  claimedAt: string;
  heartbeatAt: string;
};

export type DailyBriefingCalendarSource = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  originType: string;
  updatedAt: string;
  observedAt: string | null;
};

export type DailyBriefingActivitySource = {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  createdAt: string;
};

export type DailyBriefingCapacitySource = {
  userId: string;
  dateKey: string;
  dailyBudgetAp: number;
  spentTodayAp: number;
  remainingAp: number;
  readinessMultiplier: number;
  sleepRecoveryMultiplier: number;
  fatigueDebtCarry: number;
  updatedAt: string;
  provenance: DerivedDataProvenance;
};

export type BuildDailyBriefingInput = {
  ownerUserId: string;
  now: Date;
  timeZone: string;
  work: {
    tasks: DailyBriefingTaskSource[];
    activeRuns: DailyBriefingActiveRunSource[];
    tasksTruncated: boolean;
    activeRunsTruncated: boolean;
  };
  schedule: {
    events: DailyBriefingCalendarSource[];
    truncated: boolean;
    omissionReason?: string | null;
  };
  capacity: {
    summary: DailyBriefingCapacitySource | null;
    omissionReason?: string | null;
  };
  recentActivity: {
    events: DailyBriefingActivitySource[];
    truncated: boolean;
    omissionReason?: string | null;
  };
};
