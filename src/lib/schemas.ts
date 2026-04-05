import { z } from "zod";

export const appLocaleSchema = z.enum(["en", "fr"]);

export const inlineCreateNoteSchema = z.object({
  contentMarkdown: z.string().trim().min(1, "Note content is required"),
  author: z.string().trim()
});

export const goalMutationSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim(),
  horizon: z.enum(["quarter", "year", "lifetime"]),
  status: z.enum(["active", "paused", "completed"]),
  userId: z.string().trim().nullable().optional(),
  targetPoints: z.coerce.number().int().min(25).max(10000),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a valid hex value"),
  tagIds: z.array(z.string()),
  notes: z.array(inlineCreateNoteSchema)
});

export const projectMutationSchema = z.object({
  goalId: z.string().trim().min(1, "Life goal is required"),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim(),
  status: z.enum(["active", "paused", "completed"]),
  userId: z.string().trim().nullable().optional(),
  targetPoints: z.coerce.number().int().min(25).max(10000),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a valid hex value"),
  notes: z.array(inlineCreateNoteSchema)
});

export const settingsMutationSchema = z.object({
  profile: z.object({
    operatorName: z.string().trim().min(1, "Name is required"),
    operatorEmail: z.string().trim().min(1, "Email is required"),
    operatorTitle: z.string().trim().min(1, "Title is required")
  }),
  notifications: z.object({
    goalDriftAlerts: z.boolean(),
    dailyQuestReminders: z.boolean(),
    achievementCelebrations: z.boolean()
  }),
  execution: z.object({
    maxActiveTasks: z.coerce.number().int().min(1).max(8),
    timeAccountingMode: z.enum(["split", "parallel", "primary_only"])
  }),
  themePreference: z.enum(["obsidian", "solar", "system"]),
  localePreference: appLocaleSchema,
  calendarProviders: z
    .object({
      microsoft: z
        .object({
          clientId: z.string().trim(),
          tenantId: z.string().trim(),
          redirectUri: z.string().trim()
        })
        .optional()
    })
    .optional()
});

export const createAgentTokenSchema = z.object({
  label: z.string().trim().min(1, "Label is required"),
  agentLabel: z.string().trim().min(1, "Agent name is required"),
  agentType: z.string().trim().min(1, "Agent type is required"),
  description: z.string().trim(),
  trustLevel: z.enum(["standard", "trusted", "autonomous"]),
  autonomyMode: z.enum(["approval_required", "scoped_write", "autonomous"]),
  approvalMode: z.enum(["approval_by_default", "high_impact_only", "none"]),
  scopes: z.array(z.string().trim().min(1)).min(1)
});

export const createInsightSchema = z.object({
  originType: z.enum(["system", "user", "agent"]),
  originAgentId: z.string().trim(),
  originLabel: z.string().trim(),
  entityType: z.string().trim(),
  entityId: z.string().trim(),
  timeframeLabel: z.string().trim(),
  title: z.string().trim().min(1, "Title is required"),
  summary: z.string().trim().min(1, "Summary is required"),
  recommendation: z.string().trim().min(1, "Recommendation is required"),
  rationale: z.string().trim(),
  confidence: z.coerce.number().min(0).max(1),
  ctaLabel: z.string().trim().min(1, "CTA label is required")
});

export const quickTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim(),
  owner: z.string().trim().min(1, "Owner is required"),
  userId: z.string().trim().nullable().optional(),
  goalId: z.string().trim(),
  projectId: z.string().trim().min(1, "Project is required"),
  priority: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["backlog", "focus", "in_progress", "blocked", "done"]),
  effort: z.enum(["light", "deep", "marathon"]),
  energy: z.enum(["low", "steady", "high"]),
  dueDate: z.string().trim(),
  points: z.coerce.number().int().min(5).max(500),
  tagIds: z.array(z.string()),
  notes: z.array(inlineCreateNoteSchema)
});

export const habitMutationSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim(),
    status: z.enum(["active", "paused", "archived"]),
    userId: z.string().trim().nullable().optional(),
    polarity: z.enum(["positive", "negative"]),
    frequency: z.enum(["daily", "weekly"]),
    targetCount: z.coerce.number().int().min(1).max(14),
    weekDays: z.array(z.number().int().min(0).max(6)).max(7),
    linkedGoalIds: z.array(z.string().trim().min(1)),
    linkedProjectIds: z.array(z.string().trim().min(1)),
    linkedTaskIds: z.array(z.string().trim().min(1)),
    linkedValueIds: z.array(z.string().trim().min(1)),
    linkedPatternIds: z.array(z.string().trim().min(1)),
    linkedBehaviorIds: z.array(z.string().trim().min(1)),
    linkedBeliefIds: z.array(z.string().trim().min(1)),
    linkedModeIds: z.array(z.string().trim().min(1)),
    linkedReportIds: z.array(z.string().trim().min(1)),
    linkedBehaviorId: z.string().trim(),
    rewardXp: z.coerce.number().int().min(1).max(100),
    penaltyXp: z.coerce.number().int().min(1).max(100),
    generatedHealthEventTemplate: z.object({
      enabled: z.boolean(),
      workoutType: z.string().trim(),
      title: z.string().trim(),
      durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
      xpReward: z.coerce.number().int().min(0).max(500),
      tags: z.array(z.string().trim()),
      links: z.array(
        z.object({
          entityType: z.string().trim().min(1),
          entityId: z.string().trim().min(1),
          relationshipType: z.string().trim().default("context")
        })
      ),
      notesTemplate: z.string().trim()
    })
  })
  .superRefine((value, context) => {
    if (value.frequency === "weekly" && value.weekDays.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekDays"],
        message: "Pick at least one weekday"
      });
    }
  });

export const workAdjustmentMutationSchema = z.object({
  entityType: z.enum(["task", "project"]),
  entityId: z.string().trim().min(1, "A target is required"),
  deltaMinutes: z.coerce
    .number()
    .int()
    .refine((value) => value !== 0, "Minutes must not be zero"),
  note: z.string().trim()
});

export const tagMutationSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["value", "category", "execution"]),
  userId: z.string().trim().nullable().optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex value"),
  description: z.string().trim()
});

export type GoalMutationInput = z.infer<typeof goalMutationSchema>;
export type ProjectMutationInput = z.infer<typeof projectMutationSchema>;
export type SettingsMutationInput = z.infer<typeof settingsMutationSchema>;
export type CreateAgentTokenInput = z.infer<typeof createAgentTokenSchema>;
export type CreateInsightInput = z.infer<typeof createInsightSchema>;
export type QuickTaskInput = z.infer<typeof quickTaskSchema>;
export type InlineCreateNoteInput = z.infer<typeof inlineCreateNoteSchema>;
export type HabitMutationInput = z.infer<typeof habitMutationSchema>;
export type WorkAdjustmentMutationInput = z.infer<
  typeof workAdjustmentMutationSchema
>;
export type TagMutationInput = z.infer<typeof tagMutationSchema>;
