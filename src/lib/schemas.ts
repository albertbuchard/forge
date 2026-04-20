import { z } from "zod";
import {
  forgeCustomThemeSchema,
  forgeThemePreferenceSchema
} from "@/lib/theme-system";

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
  workflowStatus: z.enum(["backlog", "focus", "in_progress", "blocked", "done"]),
  userId: z.string().trim().nullable().optional(),
  assigneeUserIds: z.array(z.string().trim()),
  targetPoints: z.coerce.number().int().min(25).max(10000),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a valid hex value"),
  productRequirementsDocument: z.string().trim(),
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
  themePreference: forgeThemePreferenceSchema,
  customTheme: forgeCustomThemeSchema.nullable().optional(),
  localePreference: appLocaleSchema,
  calendarProviders: z
    .object({
      google: z
        .object({
          clientId: z.string().trim().optional(),
          clientSecret: z.string().trim().optional(),
          storedClientId: z.string().optional(),
          storedClientSecret: z.string().optional(),
          appBaseUrl: z.string().optional(),
          redirectUri: z.string().optional(),
          allowedOrigins: z.array(z.string()).optional(),
          usesPkce: z.literal(true).optional(),
          requiresServerClientSecret: z.literal(false).optional(),
          oauthClientType: z.literal("desktop_app").optional(),
          authMode: z.literal("localhost_pkce").optional(),
          isConfigured: z.boolean().optional(),
          isReadyForPairing: z.boolean().optional(),
          isLocalOnly: z.literal(true).optional(),
          runtimeOrigin: z.string().optional(),
          setupMessage: z.string().optional()
        })
        .optional(),
      microsoft: z
        .object({
          clientId: z.string().trim(),
          tenantId: z.string().trim(),
          redirectUri: z.string().trim()
        })
        .optional()
    })
    .optional()
    .superRefine((value, context) => {
      const google = value?.google;
      if (!google) {
        return;
      }
      const hasClientIdField = google.clientId !== undefined;
      const hasClientSecretField = google.clientSecret !== undefined;
      const hasClientIdValue = (google.clientId?.length ?? 0) > 0;
      const hasClientSecretValue = (google.clientSecret?.length ?? 0) > 0;
      if (hasClientIdField !== hasClientSecretField) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["google", hasClientIdField ? "clientSecret" : "clientId"],
          message:
            "Provide both the Google client ID and client secret together, or clear both together."
        });
        return;
      }
      if (hasClientIdValue !== hasClientSecretValue) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["google", hasClientIdValue ? "clientSecret" : "clientId"],
          message:
            "Provide both the Google client ID and client secret together, or clear both together."
        });
      }
    }),
  modelSettings: z
    .object({
      forgeAgent: z
        .object({
          basicChat: z
            .object({
              connectionId: z.string().trim().nullable().optional(),
              model: z.string().trim().optional()
            })
            .optional(),
          wiki: z
            .object({
              connectionId: z.string().trim().nullable().optional(),
              model: z.string().trim().optional()
            })
            .optional()
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
  scopes: z.array(z.string().trim().min(1)).min(1),
  bootstrapPolicy: z.object({
    mode: z.enum(["disabled", "active_only", "scoped", "full"]),
    goalsLimit: z.coerce.number().int().min(0).max(100),
    projectsLimit: z.coerce.number().int().min(0).max(100),
    tasksLimit: z.coerce.number().int().min(0).max(100),
    habitsLimit: z.coerce.number().int().min(0).max(100),
    strategiesLimit: z.coerce.number().int().min(0).max(100),
    peoplePageLimit: z.coerce.number().int().min(0).max(50),
    includePeoplePages: z.boolean()
  })
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
  level: z.enum(["issue", "task", "subtask"]),
  owner: z.string().trim().min(1, "Owner is required"),
  userId: z.string().trim().nullable().optional(),
  assigneeUserIds: z.array(z.string().trim()),
  goalId: z.string().trim(),
  projectId: z.string().trim().min(1, "Project is required"),
  parentWorkItemId: z.string().trim().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["backlog", "focus", "in_progress", "blocked", "done"]),
  effort: z.enum(["light", "deep", "marathon"]),
  energy: z.enum(["low", "steady", "high"]),
  dueDate: z.string().trim(),
  points: z.coerce.number().int().min(5).max(500),
  plannedDurationSeconds: z.coerce.number().int().min(60).max(7 * 86_400).nullable().optional(),
  actionCostBand: z
    .enum(["tiny", "light", "standard", "heavy", "brutal"])
    .optional(),
  aiInstructions: z.string().trim(),
  executionMode: z.enum(["afk", "hitl"]).nullable().optional(),
  acceptanceCriteria: z.array(z.string().trim()),
  blockerLinks: z.array(
    z.object({
      entityType: z.string().trim().min(1),
      entityId: z.string().trim().min(1),
      label: z.string().trim().optional()
    })
  ),
  completionReport: z
    .object({
      modifiedFiles: z.array(z.string().trim()),
      workSummary: z.string().trim(),
      linkedGitRefIds: z.array(z.string().trim())
    })
    .nullable()
    .optional(),
  gitRefs: z
    .array(
      z.object({
        id: z.string().trim().min(1).optional(),
        workItemId: z.string().trim().optional(),
        refType: z.enum(["commit", "branch", "pull_request"]),
        provider: z.string().trim().default("git"),
        repository: z.string().trim().default(""),
        refValue: z.string().trim().min(1),
        url: z.string().trim().url().nullable().optional(),
        displayTitle: z.string().trim().default("")
      })
    )
    .default([]),
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
