import { z } from "zod";

export const appLocaleSchema = z.enum(["en", "fr"]);

export const goalMutationSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim(),
  horizon: z.enum(["quarter", "year", "lifetime"]),
  status: z.enum(["active", "paused", "completed"]),
  targetPoints: z.coerce.number().int().min(25).max(10000),
  themeColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a valid hex value"),
  tagIds: z.array(z.string())
});

export const projectMutationSchema = z.object({
  goalId: z.string().trim().min(1, "Life goal is required"),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim(),
  status: z.enum(["active", "paused", "completed"]),
  targetPoints: z.coerce.number().int().min(25).max(10000),
  themeColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a valid hex value")
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
  localePreference: appLocaleSchema
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
  goalId: z.string().trim(),
  projectId: z.string().trim().min(1, "Project is required"),
  priority: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["backlog", "focus", "in_progress", "blocked", "done"]),
  effort: z.enum(["light", "deep", "marathon"]),
  energy: z.enum(["low", "steady", "high"]),
  dueDate: z.string().trim(),
  points: z.coerce.number().int().min(5).max(500),
  tagIds: z.array(z.string())
});

export const habitMutationSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim(),
    status: z.enum(["active", "paused", "archived"]),
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
    penaltyXp: z.coerce.number().int().min(1).max(100)
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

export const tagMutationSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["value", "category", "execution"]),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex value"),
  description: z.string().trim()
});

export type GoalMutationInput = z.infer<typeof goalMutationSchema>;
export type ProjectMutationInput = z.infer<typeof projectMutationSchema>;
export type SettingsMutationInput = z.infer<typeof settingsMutationSchema>;
export type CreateAgentTokenInput = z.infer<typeof createAgentTokenSchema>;
export type CreateInsightInput = z.infer<typeof createInsightSchema>;
export type QuickTaskInput = z.infer<typeof quickTaskSchema>;
export type HabitMutationInput = z.infer<typeof habitMutationSchema>;
export type TagMutationInput = z.infer<typeof tagMutationSchema>;
