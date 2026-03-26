function arrayOf(items: Record<string, unknown>) {
  return {
    type: "array",
    items
  };
}

function nullable(schema: Record<string, unknown>) {
  return {
    anyOf: [schema, { type: "null" }]
  };
}

function jsonResponse(schema: Record<string, unknown>, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema
      }
    }
  };
}

export function buildOpenApiDocument() {
  const validationIssue = {
    type: "object",
    additionalProperties: false,
    required: ["path", "message"],
    properties: {
      path: { type: "string" },
      message: { type: "string" }
    }
  };

  const errorResponse = {
    type: "object",
    additionalProperties: true,
    required: ["code", "error", "statusCode"],
    properties: {
      code: { type: "string" },
      error: { type: "string" },
      statusCode: { type: "integer" },
      details: arrayOf({ $ref: "#/components/schemas/ValidationIssue" })
    }
  };

  const tag = {
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "kind", "color", "description"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: ["value", "category", "execution"] },
      color: { type: "string" },
      description: { type: "string" }
    }
  };

  const goal = {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "description", "horizon", "status", "targetPoints", "themeColor", "createdAt", "updatedAt", "tagIds"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      horizon: { type: "string", enum: ["quarter", "year", "lifetime"] },
      status: { type: "string", enum: ["active", "paused", "completed"] },
      targetPoints: { type: "integer" },
      themeColor: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      tagIds: arrayOf({ type: "string" })
    }
  };

  const dashboardGoal = {
    allOf: [
      { $ref: "#/components/schemas/Goal" },
      {
        type: "object",
        additionalProperties: false,
        required: ["progress", "totalTasks", "completedTasks", "earnedPoints", "momentumLabel", "tags"],
        properties: {
          progress: { type: "number" },
          totalTasks: { type: "integer" },
          completedTasks: { type: "integer" },
          earnedPoints: { type: "integer" },
          momentumLabel: { type: "string" },
          tags: arrayOf({ $ref: "#/components/schemas/Tag" })
        }
      }
    ]
  };

  const project = {
    type: "object",
    additionalProperties: false,
    required: ["id", "goalId", "title", "description", "status", "targetPoints", "themeColor", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      goalId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["active", "paused", "completed"] },
      targetPoints: { type: "integer" },
      themeColor: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const taskTimeSummary = {
    type: "object",
    additionalProperties: false,
    required: ["totalTrackedSeconds", "totalCreditedSeconds", "activeRunCount", "hasCurrentRun", "currentRunId"],
    properties: {
      totalTrackedSeconds: { type: "integer" },
      totalCreditedSeconds: { type: "number" },
      activeRunCount: { type: "integer" },
      hasCurrentRun: { type: "boolean" },
      currentRunId: nullable({ type: "string" })
    }
  };

  const projectSummary = {
    allOf: [
      { $ref: "#/components/schemas/Project" },
      {
        type: "object",
        additionalProperties: false,
        required: [
          "goalTitle",
          "activeTaskCount",
          "completedTaskCount",
          "totalTasks",
          "earnedPoints",
          "progress",
          "nextTaskId",
          "nextTaskTitle",
          "momentumLabel",
          "time"
        ],
        properties: {
          goalTitle: { type: "string" },
          activeTaskCount: { type: "integer" },
          completedTaskCount: { type: "integer" },
          totalTasks: { type: "integer" },
          earnedPoints: { type: "integer" },
          progress: { type: "number" },
          nextTaskId: nullable({ type: "string" }),
          nextTaskTitle: nullable({ type: "string" }),
          momentumLabel: { type: "string" },
          time: { $ref: "#/components/schemas/TaskTimeSummary" }
        }
      }
    ]
  };

  const task = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "description",
      "status",
      "priority",
      "owner",
      "goalId",
      "projectId",
      "dueDate",
      "effort",
      "energy",
      "points",
      "sortOrder",
      "completedAt",
      "createdAt",
      "updatedAt",
      "tagIds",
      "time"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["backlog", "focus", "in_progress", "blocked", "done"] },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      owner: { type: "string" },
      goalId: nullable({ type: "string" }),
      projectId: nullable({ type: "string" }),
      dueDate: nullable({ type: "string", format: "date" }),
      effort: { type: "string", enum: ["light", "deep", "marathon"] },
      energy: { type: "string", enum: ["low", "steady", "high"] },
      points: { type: "integer" },
      sortOrder: { type: "integer" },
      completedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      tagIds: arrayOf({ type: "string" }),
      time: { $ref: "#/components/schemas/TaskTimeSummary" }
    }
  };

  const taskRun = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "taskId",
      "taskTitle",
      "actor",
      "status",
      "note",
      "leaseTtlSeconds",
      "claimedAt",
      "heartbeatAt",
      "leaseExpiresAt",
      "completedAt",
      "releasedAt",
      "timedOutAt",
      "updatedAt",
      "timerMode",
      "plannedDurationSeconds",
      "elapsedWallSeconds",
      "creditedSeconds",
      "remainingSeconds",
      "overtimeSeconds",
      "isCurrent"
    ],
    properties: {
      id: { type: "string" },
      taskId: { type: "string" },
      taskTitle: { type: "string" },
      actor: { type: "string" },
      status: { type: "string", enum: ["active", "completed", "released", "timed_out"] },
      note: { type: "string" },
      leaseTtlSeconds: { type: "integer" },
      claimedAt: { type: "string", format: "date-time" },
      heartbeatAt: { type: "string", format: "date-time" },
      leaseExpiresAt: { type: "string", format: "date-time" },
      completedAt: nullable({ type: "string", format: "date-time" }),
      releasedAt: nullable({ type: "string", format: "date-time" }),
      timedOutAt: nullable({ type: "string", format: "date-time" }),
      updatedAt: { type: "string", format: "date-time" },
      timerMode: { type: "string", enum: ["planned", "unlimited"] },
      plannedDurationSeconds: nullable({ type: "integer" }),
      elapsedWallSeconds: { type: "integer" },
      creditedSeconds: { type: "number" },
      remainingSeconds: nullable({ type: "integer" }),
      overtimeSeconds: { type: "integer" },
      isCurrent: { type: "boolean" }
    }
  };

  const activityEvent = {
    type: "object",
    additionalProperties: false,
    required: ["id", "entityType", "entityId", "eventType", "title", "description", "actor", "source", "metadata", "createdAt"],
    properties: {
      id: { type: "string" },
      entityType: {
        type: "string",
        enum: [
          "task",
          "goal",
          "project",
          "domain",
          "psyche_value",
          "behavior_pattern",
          "behavior",
          "belief_entry",
          "mode_profile",
          "trigger_report",
          "comment",
          "tag",
          "task_run",
          "system",
          "insight",
          "approval_request",
          "agent_action",
          "reward",
          "session",
          "event_type",
          "emotion_definition"
        ]
      },
      entityId: { type: "string" },
      eventType: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      metadata: {
        type: "object",
        additionalProperties: {
          anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }]
        }
      },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const gamificationProfile = {
    type: "object",
    additionalProperties: false,
    required: ["totalXp", "level", "currentLevelXp", "nextLevelXp", "weeklyXp", "streakDays", "comboMultiplier", "momentumScore", "topGoalId", "topGoalTitle"],
    properties: {
      totalXp: { type: "integer" },
      level: { type: "integer" },
      currentLevelXp: { type: "integer" },
      nextLevelXp: { type: "integer" },
      weeklyXp: { type: "integer" },
      streakDays: { type: "integer" },
      comboMultiplier: { type: "number" },
      momentumScore: { type: "integer" },
      topGoalId: nullable({ type: "string" }),
      topGoalTitle: nullable({ type: "string" })
    }
  };

  const achievementSignal = {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "summary", "tier", "progressLabel", "unlocked", "unlockedAt"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      tier: { type: "string", enum: ["bronze", "silver", "gold", "platinum"] },
      progressLabel: { type: "string" },
      unlocked: { type: "boolean" },
      unlockedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const milestoneReward = {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "summary", "rewardLabel", "progressLabel", "current", "target", "completed"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      rewardLabel: { type: "string" },
      progressLabel: { type: "string" },
      current: { type: "integer" },
      target: { type: "integer" },
      completed: { type: "boolean" }
    }
  };

  const dashboardPayload = {
    type: "object",
    additionalProperties: false,
    required: ["stats", "goals", "projects", "tasks", "tags", "suggestedTags", "owners", "executionBuckets", "gamification", "achievements", "milestoneRewards", "recentActivity"],
    properties: {
      stats: {
        type: "object",
        additionalProperties: false,
        required: ["totalPoints", "completedThisWeek", "activeGoals", "alignmentScore", "focusTasks", "overdueTasks", "dueThisWeek"],
        properties: {
          totalPoints: { type: "integer" },
          completedThisWeek: { type: "integer" },
          activeGoals: { type: "integer" },
          alignmentScore: { type: "integer" },
          focusTasks: { type: "integer" },
          overdueTasks: { type: "integer" },
          dueThisWeek: { type: "integer" }
        }
      },
      goals: arrayOf({ $ref: "#/components/schemas/DashboardGoal" }),
      projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      tasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      tags: arrayOf({ $ref: "#/components/schemas/Tag" }),
      suggestedTags: arrayOf({ $ref: "#/components/schemas/Tag" }),
      owners: arrayOf({ type: "string" }),
      executionBuckets: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "summary", "tone", "tasks"],
        properties: {
          id: { type: "string", enum: ["overdue", "due_soon", "focus_now", "recently_completed"] },
          label: { type: "string" },
          summary: { type: "string" },
          tone: { type: "string", enum: ["urgent", "accent", "neutral", "success"] },
          tasks: arrayOf({ $ref: "#/components/schemas/Task" })
        }
      }),
      gamification: { $ref: "#/components/schemas/GamificationProfile" },
      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
      milestoneRewards: arrayOf({ $ref: "#/components/schemas/MilestoneReward" }),
      recentActivity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" })
    }
  };

  const overviewContext = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "strategicHeader", "projects", "activeGoals", "topTasks", "recentEvidence", "achievements", "domainBalance", "neglectedGoals"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      strategicHeader: {
        type: "object",
        additionalProperties: false,
        required: ["streakDays", "level", "totalXp", "currentLevelXp", "nextLevelXp", "momentumScore", "focusTasks", "overdueTasks"],
        properties: {
          streakDays: { type: "integer" },
          level: { type: "integer" },
          totalXp: { type: "integer" },
          currentLevelXp: { type: "integer" },
          nextLevelXp: { type: "integer" },
          momentumScore: { type: "integer" },
          focusTasks: { type: "integer" },
          overdueTasks: { type: "integer" }
        }
      },
      projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      activeGoals: arrayOf({ $ref: "#/components/schemas/DashboardGoal" }),
      topTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      recentEvidence: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
      domainBalance: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["tagId", "label", "color", "goalCount", "activeTaskCount", "completedPoints", "momentumLabel"],
        properties: {
          tagId: { type: "string" },
          label: { type: "string" },
          color: { type: "string" },
          goalCount: { type: "integer" },
          activeTaskCount: { type: "integer" },
          completedPoints: { type: "integer" },
          momentumLabel: { type: "string" }
        }
      }),
      neglectedGoals: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["goalId", "title", "summary", "risk"],
        properties: {
          goalId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] }
        }
      })
    }
  };

  const todayContext = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "directive", "timeline", "dailyQuests", "milestoneRewards", "momentum"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      directive: {
        type: "object",
        additionalProperties: false,
        required: ["task", "goalTitle", "rewardXp", "sessionLabel"],
        properties: {
          task: nullable({ $ref: "#/components/schemas/Task" }),
          goalTitle: nullable({ type: "string" }),
          rewardXp: { type: "integer" },
          sessionLabel: { type: "string" }
        }
      },
      timeline: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "tasks"],
        properties: {
          id: { type: "string", enum: ["completed", "active", "upcoming", "deferred"] },
          label: { type: "string" },
          tasks: arrayOf({ $ref: "#/components/schemas/Task" })
        }
      }),
      dailyQuests: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "summary", "rewardXp", "progressLabel", "completed"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          rewardXp: { type: "integer" },
          progressLabel: { type: "string" },
          completed: { type: "boolean" }
        }
      }),
      milestoneRewards: arrayOf({ $ref: "#/components/schemas/MilestoneReward" }),
      momentum: {
        type: "object",
        additionalProperties: false,
        required: ["streakDays", "momentumScore", "recoveryHint"],
        properties: {
          streakDays: { type: "integer" },
          momentumScore: { type: "integer" },
          recoveryHint: { type: "string" }
        }
      }
    }
  };

  const riskContext = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "overdueTasks", "blockedTasks", "neglectedGoals", "summary"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      overdueTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      blockedTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      neglectedGoals: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["goalId", "title", "summary", "risk"],
        properties: {
          goalId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] }
        }
      }),
      summary: { type: "string" }
    }
  };

  const forgeSnapshot = {
    type: "object",
    additionalProperties: false,
    required: ["meta", "metrics", "dashboard", "overview", "today", "risk", "goals", "projects", "tags", "tasks", "activeTaskRuns", "activity"],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["apiVersion", "transport", "generatedAt", "backend", "mode"],
        properties: {
          apiVersion: { type: "string", const: "v1" },
          transport: { type: "string" },
          generatedAt: { type: "string", format: "date-time" },
          backend: { type: "string" },
          mode: { type: "string" }
        }
      },
      metrics: { $ref: "#/components/schemas/GamificationProfile" },
      dashboard: { $ref: "#/components/schemas/DashboardPayload" },
      overview: { $ref: "#/components/schemas/OverviewContext" },
      today: { $ref: "#/components/schemas/TodayContext" },
      risk: { $ref: "#/components/schemas/RiskContext" },
      goals: arrayOf({ $ref: "#/components/schemas/Goal" }),
      projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      tags: arrayOf({ $ref: "#/components/schemas/Tag" }),
      tasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      activeTaskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" }),
      activity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" })
    }
  };

  const taskContextPayload = {
    type: "object",
    additionalProperties: false,
    required: ["task", "goal", "project", "activeTaskRun", "taskRuns", "activity"],
    properties: {
      task: { $ref: "#/components/schemas/Task" },
      goal: nullable({ $ref: "#/components/schemas/Goal" }),
      project: nullable({ $ref: "#/components/schemas/ProjectSummary" }),
      activeTaskRun: nullable({ $ref: "#/components/schemas/TaskRun" }),
      taskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" }),
      activity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" })
    }
  };

  const projectBoardPayload = {
    type: "object",
    additionalProperties: false,
    required: ["project", "goal", "tasks", "activity"],
    properties: {
      project: { $ref: "#/components/schemas/ProjectSummary" },
      goal: { $ref: "#/components/schemas/Goal" },
      tasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      activity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" })
    }
  };

  const insightsPayload = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "status", "momentumHeatmap", "executionTrends", "domainBalance", "coaching", "evidenceDigest", "feed", "openCount"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      status: {
        type: "object",
        additionalProperties: false,
        required: ["systemStatus", "streakDays", "momentumScore"],
        properties: {
          systemStatus: { type: "string" },
          streakDays: { type: "integer" },
          momentumScore: { type: "integer" }
        }
      },
      momentumHeatmap: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "completed", "focus", "intensity"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          completed: { type: "integer" },
          focus: { type: "integer" },
          intensity: { type: "integer" }
        }
      }),
      executionTrends: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["label", "xp", "focusScore"],
        properties: {
          label: { type: "string" },
          xp: { type: "integer" },
          focusScore: { type: "integer" }
        }
      }),
      domainBalance: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "color", "note"],
        properties: {
          label: { type: "string" },
          value: { type: "integer" },
          color: { type: "string" },
          note: { type: "string" }
        }
      }),
      coaching: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "recommendation", "ctaLabel"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          recommendation: { type: "string" },
          ctaLabel: { type: "string" }
        }
      },
      evidenceDigest: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      feed: arrayOf({ $ref: "#/components/schemas/Insight" }),
      openCount: { type: "integer" }
    }
  };

  const weeklyReviewPayload = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "windowLabel", "momentumSummary", "chart", "wins", "calibration", "reward"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      windowLabel: { type: "string" },
      momentumSummary: {
        type: "object",
        additionalProperties: false,
        required: ["totalXp", "focusHours", "efficiencyScore", "peakWindow"],
        properties: {
          totalXp: { type: "integer" },
          focusHours: { type: "integer" },
          efficiencyScore: { type: "integer" },
          peakWindow: { type: "string" }
        }
      },
      chart: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["label", "xp", "focusHours"],
        properties: {
          label: { type: "string" },
          xp: { type: "integer" },
          focusHours: { type: "integer" }
        }
      }),
      wins: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "summary", "rewardXp"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          rewardXp: { type: "integer" }
        }
      }),
      calibration: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "mode", "note"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          mode: { type: "string", enum: ["accelerate", "maintain", "recover"] },
          note: { type: "string" }
        }
      }),
      reward: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "rewardXp"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          rewardXp: { type: "integer" }
        }
      }
    }
  };

  const agentTokenSummary = {
    type: "object",
    additionalProperties: false,
    required: ["id", "label", "tokenPrefix", "scopes", "agentId", "agentLabel", "trustLevel", "autonomyMode", "approvalMode", "description", "lastUsedAt", "revokedAt", "createdAt", "updatedAt", "status"],
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      tokenPrefix: { type: "string" },
      scopes: arrayOf({ type: "string" }),
      agentId: nullable({ type: "string" }),
      agentLabel: nullable({ type: "string" }),
      trustLevel: { type: "string", enum: ["standard", "trusted", "autonomous"] },
      autonomyMode: { type: "string", enum: ["approval_required", "scoped_write", "autonomous"] },
      approvalMode: { type: "string", enum: ["approval_by_default", "high_impact_only", "none"] },
      description: { type: "string" },
      lastUsedAt: nullable({ type: "string", format: "date-time" }),
      revokedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      status: { type: "string", enum: ["active", "revoked"] }
    }
  };

  const executionSettings = {
    type: "object",
    additionalProperties: false,
    required: ["maxActiveTasks", "timeAccountingMode"],
    properties: {
      maxActiveTasks: { type: "integer", minimum: 1, maximum: 8 },
      timeAccountingMode: { type: "string", enum: ["split", "parallel", "primary_only"] }
    }
  };

  const taskRunClaimInput = {
    type: "object",
    additionalProperties: false,
    required: ["actor"],
    properties: {
      actor: { type: "string" },
      timerMode: { type: "string", enum: ["planned", "unlimited"], default: "unlimited" },
      plannedDurationSeconds: nullable({ type: "integer", minimum: 60, maximum: 86400 }),
      isCurrent: { type: "boolean", default: true },
      leaseTtlSeconds: { type: "integer", minimum: 1, maximum: 14400, default: 900 },
      note: { type: "string", default: "" }
    }
  };

  const taskRunHeartbeatInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string" },
      leaseTtlSeconds: { type: "integer", minimum: 1, maximum: 14400, default: 900 },
      note: { type: "string" }
    }
  };

  const taskRunFinishInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string" },
      note: { type: "string", default: "" }
    }
  };

  const taskRunFocusInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string" }
    }
  };

  const settingsUpdateInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      profile: {
        type: "object",
        additionalProperties: false,
        properties: {
          operatorName: { type: "string" },
          operatorEmail: { type: "string" },
          operatorTitle: { type: "string" }
        }
      },
      notifications: {
        type: "object",
        additionalProperties: false,
        properties: {
          goalDriftAlerts: { type: "boolean" },
          dailyQuestReminders: { type: "boolean" },
          achievementCelebrations: { type: "boolean" }
        }
      },
      execution: {
        type: "object",
        additionalProperties: false,
        properties: {
          maxActiveTasks: { type: "integer", minimum: 1, maximum: 8 },
          timeAccountingMode: { type: "string", enum: ["split", "parallel", "primary_only"] }
        }
      },
      themePreference: { type: "string", enum: ["obsidian", "solar", "system"] },
      localePreference: { type: "string", enum: ["en", "fr"] }
    }
  };

  const agentIdentity = {
    type: "object",
    additionalProperties: false,
    required: ["id", "label", "agentType", "trustLevel", "autonomyMode", "approvalMode", "description", "tokenCount", "activeTokenCount", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      agentType: { type: "string" },
      trustLevel: { type: "string", enum: ["standard", "trusted", "autonomous"] },
      autonomyMode: { type: "string", enum: ["approval_required", "scoped_write", "autonomous"] },
      approvalMode: { type: "string", enum: ["approval_by_default", "high_impact_only", "none"] },
      description: { type: "string" },
      tokenCount: { type: "integer" },
      activeTokenCount: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const insight = {
    type: "object",
    additionalProperties: false,
    required: ["id", "originType", "originAgentId", "originLabel", "visibility", "status", "entityType", "entityId", "timeframeLabel", "title", "summary", "recommendation", "rationale", "confidence", "ctaLabel", "evidence", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      originType: { type: "string", enum: ["system", "user", "agent"] },
      originAgentId: nullable({ type: "string" }),
      originLabel: nullable({ type: "string" }),
      visibility: { type: "string", enum: ["visible", "pending_review", "archived"] },
      status: { type: "string", enum: ["open", "accepted", "dismissed", "snoozed", "applied", "expired"] },
      entityType: nullable({ type: "string" }),
      entityId: nullable({ type: "string" }),
      timeframeLabel: nullable({ type: "string" }),
      title: { type: "string" },
      summary: { type: "string" },
      recommendation: { type: "string" },
      rationale: { type: "string" },
      confidence: { type: "number" },
      ctaLabel: { type: "string" },
      evidence: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["entityType", "entityId", "label"],
        properties: {
          entityType: { type: "string" },
          entityId: { type: "string" },
          label: { type: "string" }
        }
      }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const insightFeedback = {
    type: "object",
    additionalProperties: false,
    required: ["id", "insightId", "actor", "feedbackType", "note", "createdAt"],
    properties: {
      id: { type: "string" },
      insightId: { type: "string" },
      actor: nullable({ type: "string" }),
      feedbackType: { type: "string", enum: ["accepted", "dismissed", "applied", "snoozed"] },
      note: { type: "string" },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const approvalRequest = {
    type: "object",
    additionalProperties: false,
    required: ["id", "actionType", "status", "title", "summary", "entityType", "entityId", "requestedByAgentId", "requestedByTokenId", "requestedPayload", "approvedBy", "approvedAt", "rejectedBy", "rejectedAt", "resolutionNote", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      actionType: { type: "string" },
      status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled", "executed"] },
      title: { type: "string" },
      summary: { type: "string" },
      entityType: nullable({ type: "string" }),
      entityId: nullable({ type: "string" }),
      requestedByAgentId: nullable({ type: "string" }),
      requestedByTokenId: nullable({ type: "string" }),
      requestedPayload: { type: "object", additionalProperties: true },
      approvedBy: nullable({ type: "string" }),
      approvedAt: nullable({ type: "string", format: "date-time" }),
      rejectedBy: nullable({ type: "string" }),
      rejectedAt: nullable({ type: "string", format: "date-time" }),
      resolutionNote: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const agentAction = {
    type: "object",
    additionalProperties: false,
    required: ["id", "agentId", "tokenId", "actionType", "riskLevel", "status", "title", "summary", "payload", "idempotencyKey", "approvalRequestId", "outcome", "createdAt", "updatedAt", "completedAt"],
    properties: {
      id: { type: "string" },
      agentId: nullable({ type: "string" }),
      tokenId: nullable({ type: "string" }),
      actionType: { type: "string" },
      riskLevel: { type: "string", enum: ["low", "medium", "high"] },
      status: { type: "string", enum: ["pending_approval", "approved", "rejected", "executed"] },
      title: { type: "string" },
      summary: { type: "string" },
      payload: { type: "object", additionalProperties: true },
      idempotencyKey: nullable({ type: "string" }),
      approvalRequestId: nullable({ type: "string" }),
      outcome: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      completedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const rewardRule = {
    type: "object",
    additionalProperties: false,
    required: ["id", "family", "code", "title", "description", "active", "config", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      family: { type: "string", enum: ["completion", "consistency", "alignment", "recovery", "collaboration", "ambient"] },
      code: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      active: { type: "boolean" },
      config: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const rewardLedgerEvent = {
    type: "object",
    additionalProperties: false,
    required: ["id", "ruleId", "eventLogId", "entityType", "entityId", "actor", "source", "deltaXp", "reasonTitle", "reasonSummary", "reversibleGroup", "reversedByRewardId", "metadata", "createdAt"],
    properties: {
      id: { type: "string" },
      ruleId: nullable({ type: "string" }),
      eventLogId: nullable({ type: "string" }),
      entityType: { type: "string" },
      entityId: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      deltaXp: { type: "integer" },
      reasonTitle: { type: "string" },
      reasonSummary: { type: "string" },
      reversibleGroup: nullable({ type: "string" }),
      reversedByRewardId: nullable({ type: "string" }),
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const eventLogEntry = {
    type: "object",
    additionalProperties: false,
    required: ["id", "eventKind", "entityType", "entityId", "actor", "source", "causedByEventId", "metadata", "createdAt"],
    properties: {
      id: { type: "string" },
      eventKind: { type: "string" },
      entityType: { type: "string" },
      entityId: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      causedByEventId: nullable({ type: "string" }),
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const xpMomentumPulse = {
    type: "object",
    additionalProperties: false,
    required: ["status", "headline", "detail", "celebrationLabel", "nextMilestoneId", "nextMilestoneLabel"],
    properties: {
      status: { type: "string", enum: ["surging", "steady", "recovering"] },
      headline: { type: "string" },
      detail: { type: "string" },
      celebrationLabel: { type: "string" },
      nextMilestoneId: nullable({ type: "string" }),
      nextMilestoneLabel: { type: "string" }
    }
  };

  const xpMetricsPayload = {
    type: "object",
    additionalProperties: false,
    required: ["profile", "achievements", "milestoneRewards", "momentumPulse", "recentLedger", "rules", "dailyAmbientXp", "dailyAmbientCap"],
    properties: {
      profile: { $ref: "#/components/schemas/GamificationProfile" },
      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
      milestoneRewards: arrayOf({ $ref: "#/components/schemas/MilestoneReward" }),
      momentumPulse: { $ref: "#/components/schemas/XpMomentumPulse" },
      recentLedger: arrayOf({ $ref: "#/components/schemas/RewardLedgerEvent" }),
      rules: arrayOf({ $ref: "#/components/schemas/RewardRule" }),
      dailyAmbientXp: { type: "integer" },
      dailyAmbientCap: { type: "integer" }
    }
  };

  const operatorContextPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "activeProjects",
      "focusTasks",
      "currentBoard",
      "recentActivity",
      "recentTaskRuns",
      "recommendedNextTask",
      "xp"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      activeProjects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      focusTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      currentBoard: {
        type: "object",
        additionalProperties: false,
        required: ["backlog", "focus", "inProgress", "blocked", "done"],
        properties: {
          backlog: arrayOf({ $ref: "#/components/schemas/Task" }),
          focus: arrayOf({ $ref: "#/components/schemas/Task" }),
          inProgress: arrayOf({ $ref: "#/components/schemas/Task" }),
          blocked: arrayOf({ $ref: "#/components/schemas/Task" }),
          done: arrayOf({ $ref: "#/components/schemas/Task" })
        }
      },
      recentActivity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      recentTaskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" }),
      recommendedNextTask: nullable({ $ref: "#/components/schemas/Task" }),
      xp: { $ref: "#/components/schemas/XpMetricsPayload" }
    }
  };

  const operatorOverviewPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "snapshot",
      "operator",
      "domains",
      "psyche",
      "onboarding",
      "capabilities",
      "warnings",
      "routeGuide"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      snapshot: { $ref: "#/components/schemas/ForgeSnapshot" },
      operator: { $ref: "#/components/schemas/OperatorContextPayload" },
      domains: arrayOf({ $ref: "#/components/schemas/Domain" }),
      psyche: nullable({ $ref: "#/components/schemas/PsycheOverviewPayload" }),
      onboarding: { $ref: "#/components/schemas/AgentOnboardingPayload" },
      capabilities: {
        type: "object",
        additionalProperties: false,
        required: ["tokenPresent", "scopes", "canReadPsyche", "canWritePsyche", "canManageModes", "canManageRewards"],
        properties: {
          tokenPresent: { type: "boolean" },
          scopes: arrayOf({ type: "string" }),
          canReadPsyche: { type: "boolean" },
          canWritePsyche: { type: "boolean" },
          canManageModes: { type: "boolean" },
          canManageRewards: { type: "boolean" }
        }
      },
      warnings: arrayOf({ type: "string" }),
      routeGuide: {
        type: "object",
        additionalProperties: false,
        required: ["preferredStart", "mainRoutes"],
        properties: {
          preferredStart: { type: "string" },
          mainRoutes: arrayOf({
            type: "object",
            additionalProperties: false,
            required: ["id", "path", "summary", "requiredScope"],
            properties: {
              id: { type: "string" },
              path: { type: "string" },
              summary: { type: "string" },
              requiredScope: nullable({ type: "string" })
            }
          })
        }
      }
    }
  };

  const settingsPayload = {
    type: "object",
    additionalProperties: false,
    required: ["profile", "notifications", "execution", "themePreference", "localePreference", "security", "agents", "agentTokens"],
    properties: {
      profile: {
        type: "object",
        additionalProperties: false,
        required: ["operatorName", "operatorEmail", "operatorTitle"],
        properties: {
          operatorName: { type: "string" },
          operatorEmail: { type: "string" },
          operatorTitle: { type: "string" }
        }
      },
      notifications: {
        type: "object",
        additionalProperties: false,
        required: ["goalDriftAlerts", "dailyQuestReminders", "achievementCelebrations"],
        properties: {
          goalDriftAlerts: { type: "boolean" },
          dailyQuestReminders: { type: "boolean" },
          achievementCelebrations: { type: "boolean" }
        }
      },
      execution: { $ref: "#/components/schemas/ExecutionSettings" },
      themePreference: { type: "string", enum: ["obsidian", "solar", "system"] },
      localePreference: { type: "string", enum: ["en", "fr"] },
      security: {
        type: "object",
        additionalProperties: false,
        required: ["integrityScore", "lastAuditAt", "storageMode", "activeSessions", "tokenCount"],
        properties: {
          integrityScore: { type: "integer" },
          lastAuditAt: { type: "string", format: "date-time" },
          storageMode: { type: "string", const: "local-first" },
          activeSessions: { type: "integer" },
          tokenCount: { type: "integer" }
        }
      },
      agents: arrayOf({ $ref: "#/components/schemas/AgentIdentity" }),
      agentTokens: arrayOf({ $ref: "#/components/schemas/AgentTokenSummary" })
    }
  };

  const agentOnboardingPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "forgeBaseUrl",
      "webAppUrl",
      "apiBaseUrl",
      "openApiUrl",
      "healthUrl",
      "settingsUrl",
      "tokenCreateUrl",
      "pluginBasePath",
      "defaultConnectionMode",
      "defaultActorLabel",
      "defaultTimeoutMs",
      "recommendedScopes",
      "recommendedTrustLevel",
      "recommendedAutonomyMode",
      "recommendedApprovalMode",
      "authModes",
      "tokenRecovery",
      "requiredHeaders",
      "verificationPaths",
      "recommendedPluginTools",
      "interactionGuidance",
      "mutationGuidance"
    ],
    properties: {
      forgeBaseUrl: { type: "string" },
      webAppUrl: { type: "string" },
      apiBaseUrl: { type: "string" },
      openApiUrl: { type: "string" },
      healthUrl: { type: "string" },
      settingsUrl: { type: "string" },
      tokenCreateUrl: { type: "string" },
      pluginBasePath: { type: "string" },
      defaultConnectionMode: { type: "string", enum: ["operator_session", "managed_token"] },
      defaultActorLabel: { type: "string" },
      defaultTimeoutMs: { type: "integer" },
      recommendedScopes: arrayOf({ type: "string" }),
      recommendedTrustLevel: { type: "string", enum: ["standard", "trusted", "autonomous"] },
      recommendedAutonomyMode: { type: "string", enum: ["approval_required", "scoped_write", "autonomous"] },
      recommendedApprovalMode: { type: "string", enum: ["approval_by_default", "high_impact_only", "none"] },
      authModes: {
        type: "object",
        additionalProperties: false,
        required: ["operatorSession", "managedToken"],
        properties: {
          operatorSession: {
            type: "object",
            additionalProperties: false,
            required: ["label", "summary", "tokenRequired", "trustedTargets"],
            properties: {
              label: { type: "string" },
              summary: { type: "string" },
              tokenRequired: { type: "boolean" },
              trustedTargets: arrayOf({ type: "string" })
            }
          },
          managedToken: {
            type: "object",
            additionalProperties: false,
            required: ["label", "summary", "tokenRequired"],
            properties: {
              label: { type: "string" },
              summary: { type: "string" },
              tokenRequired: { type: "boolean" }
            }
          }
        }
      },
      tokenRecovery: {
        type: "object",
        additionalProperties: false,
        required: ["rawTokenStoredByForge", "recoveryAction", "rotationSummary", "settingsSummary"],
        properties: {
          rawTokenStoredByForge: { type: "boolean" },
          recoveryAction: { type: "string" },
          rotationSummary: { type: "string" },
          settingsSummary: { type: "string" }
        }
      },
      requiredHeaders: {
        type: "object",
        additionalProperties: false,
        required: ["authorization", "source", "actor"],
        properties: {
          authorization: { type: "string" },
          source: { type: "string" },
          actor: { type: "string" }
        }
      },
      verificationPaths: {
        type: "object",
        additionalProperties: false,
        required: ["context", "xpMetrics", "weeklyReview", "settingsBin", "batchSearch"],
        properties: {
          context: { type: "string" },
          xpMetrics: { type: "string" },
          weeklyReview: { type: "string" },
          settingsBin: { type: "string" },
          batchSearch: { type: "string" }
        }
      },
      recommendedPluginTools: {
        type: "object",
        additionalProperties: false,
        required: ["bootstrap", "readModels", "uiWorkflow", "entityWorkflow", "workWorkflow", "insightWorkflow"],
        properties: {
          bootstrap: arrayOf({ type: "string" }),
          readModels: arrayOf({ type: "string" }),
          uiWorkflow: arrayOf({ type: "string" }),
          entityWorkflow: arrayOf({ type: "string" }),
          workWorkflow: arrayOf({ type: "string" }),
          insightWorkflow: arrayOf({ type: "string" })
        }
      },
      interactionGuidance: {
        type: "object",
        additionalProperties: false,
        required: [
          "conversationMode",
          "saveSuggestionPlacement",
          "saveSuggestionTone",
          "maxQuestionsPerTurn",
          "duplicateCheckRoute",
          "uiSuggestionRule",
          "browserFallbackRule",
          "writeConsentRule"
        ],
        properties: {
          conversationMode: { type: "string" },
          saveSuggestionPlacement: { type: "string" },
          saveSuggestionTone: { type: "string" },
          maxQuestionsPerTurn: { type: "integer" },
          duplicateCheckRoute: { type: "string" },
          uiSuggestionRule: { type: "string" },
          browserFallbackRule: { type: "string" },
          writeConsentRule: { type: "string" }
        }
      },
      mutationGuidance: {
        type: "object",
        additionalProperties: false,
        required: [
          "preferredBatchRoutes",
          "deleteDefault",
          "hardDeleteRequiresExplicitMode",
          "restoreSummary",
          "entityDeleteSummary",
          "batchingRule",
          "searchRule",
          "createRule",
          "updateRule",
          "createExample",
          "updateExample"
        ],
        properties: {
          preferredBatchRoutes: {
            type: "object",
            additionalProperties: false,
            required: ["create", "update", "delete", "restore", "search"],
            properties: {
              create: { type: "string" },
              update: { type: "string" },
              delete: { type: "string" },
              restore: { type: "string" },
              search: { type: "string" }
            }
          },
          deleteDefault: { type: "string", enum: ["soft", "hard"] },
          hardDeleteRequiresExplicitMode: { type: "boolean" },
          restoreSummary: { type: "string" },
          entityDeleteSummary: { type: "string" },
          batchingRule: { type: "string" },
          searchRule: { type: "string" },
          createRule: { type: "string" },
          updateRule: { type: "string" },
          createExample: { type: "string" },
          updateExample: { type: "string" }
        }
      }
    }
  };

  const deletedEntityRecord = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "title", "deletedAt", "snapshot"],
    properties: {
      entityType: { type: "string" },
      entityId: { type: "string" },
      title: { type: "string" },
      subtitle: { type: ["string", "null"] },
      deletedAt: { type: "string", format: "date-time" },
      deletedByActor: { type: ["string", "null"] },
      deletedSource: { type: ["string", "null"] },
      deleteReason: { type: ["string", "null"] },
      snapshot: { type: "object", additionalProperties: true }
    }
  };

  const settingsBinPayload = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "totalCount", "countsByEntityType", "records"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      totalCount: { type: "integer" },
      countsByEntityType: { type: "object", additionalProperties: { type: "integer" } },
      records: arrayOf({ $ref: "#/components/schemas/DeletedEntityRecord" })
    }
  };

  const batchEntityResult = {
    type: "object",
    additionalProperties: true,
    required: ["ok", "entityType"],
    properties: {
      ok: { type: "boolean" },
      entityType: { type: "string" },
      id: { type: "string" },
      clientRef: { type: "string" },
      entity: { type: "object", additionalProperties: true },
      matches: arrayOf({ type: "object", additionalProperties: true }),
      deletedRecord: { $ref: "#/components/schemas/DeletedEntityRecord" },
      error: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          message: { type: "string" }
        }
      }
    }
  };

  const agentTokenMutationResult = {
    type: "object",
    additionalProperties: false,
    required: ["token", "tokenSummary"],
    properties: {
      token: { type: "string" },
      tokenSummary: { $ref: "#/components/schemas/AgentTokenSummary" }
    }
  };

  const domain = {
    type: "object",
    additionalProperties: false,
    required: ["id", "slug", "title", "description", "themeColor", "sensitive", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      themeColor: { type: "string" },
      sensitive: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const psycheValue = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "title",
      "description",
      "valuedDirection",
      "whyItMatters",
      "linkedGoalIds",
      "linkedProjectIds",
      "linkedTaskIds",
      "committedActions",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      valuedDirection: { type: "string" },
      whyItMatters: { type: "string" },
      linkedGoalIds: arrayOf({ type: "string" }),
      linkedProjectIds: arrayOf({ type: "string" }),
      linkedTaskIds: arrayOf({ type: "string" }),
      committedActions: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const behaviorPattern = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "title",
      "description",
      "targetBehavior",
      "cueContexts",
      "shortTermPayoff",
      "longTermCost",
      "preferredResponse",
      "linkedValueIds",
      "linkedSchemaLabels",
      "linkedModeLabels",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      targetBehavior: { type: "string" },
      cueContexts: arrayOf({ type: "string" }),
      shortTermPayoff: { type: "string" },
      longTermCost: { type: "string" },
      preferredResponse: { type: "string" },
      linkedValueIds: arrayOf({ type: "string" }),
      linkedSchemaLabels: arrayOf({ type: "string" }),
      linkedModeLabels: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const schemaCatalogEntry = {
    type: "object",
    additionalProperties: false,
    required: ["id", "slug", "title", "family", "schemaType", "description", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      family: { type: "string" },
      schemaType: { type: "string", enum: ["maladaptive", "adaptive"] },
      description: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const eventType = {
    type: "object",
    additionalProperties: false,
    required: ["id", "domainId", "label", "description", "system", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      label: { type: "string" },
      description: { type: "string" },
      system: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const emotionDefinition = {
    type: "object",
    additionalProperties: false,
    required: ["id", "domainId", "label", "description", "category", "system", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      label: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      system: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const behavior = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "kind",
      "title",
      "description",
      "commonCues",
      "urgeStory",
      "shortTermPayoff",
      "longTermCost",
      "replacementMove",
      "repairPlan",
      "linkedPatternIds",
      "linkedValueIds",
      "linkedSchemaIds",
      "linkedModeIds",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      kind: { type: "string", enum: ["away", "committed", "recovery"] },
      title: { type: "string" },
      description: { type: "string" },
      commonCues: arrayOf({ type: "string" }),
      urgeStory: { type: "string" },
      shortTermPayoff: { type: "string" },
      longTermCost: { type: "string" },
      replacementMove: { type: "string" },
      repairPlan: { type: "string" },
      linkedPatternIds: arrayOf({ type: "string" }),
      linkedValueIds: arrayOf({ type: "string" }),
      linkedSchemaIds: arrayOf({ type: "string" }),
      linkedModeIds: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const beliefEntry = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "schemaId",
      "statement",
      "beliefType",
      "originNote",
      "confidence",
      "evidenceFor",
      "evidenceAgainst",
      "flexibleAlternative",
      "linkedValueIds",
      "linkedBehaviorIds",
      "linkedModeIds",
      "linkedReportIds",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      schemaId: nullable({ type: "string" }),
      statement: { type: "string" },
      beliefType: { type: "string", enum: ["absolute", "conditional"] },
      originNote: { type: "string" },
      confidence: { type: "integer" },
      evidenceFor: arrayOf({ type: "string" }),
      evidenceAgainst: arrayOf({ type: "string" }),
      flexibleAlternative: { type: "string" },
      linkedValueIds: arrayOf({ type: "string" }),
      linkedBehaviorIds: arrayOf({ type: "string" }),
      linkedModeIds: arrayOf({ type: "string" }),
      linkedReportIds: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const modeProfile = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "family",
      "archetype",
      "title",
      "persona",
      "imagery",
      "symbolicForm",
      "facialExpression",
      "fear",
      "burden",
      "protectiveJob",
      "originContext",
      "firstAppearanceAt",
      "linkedPatternIds",
      "linkedBehaviorIds",
      "linkedValueIds",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      family: { type: "string", enum: ["coping", "child", "critic_parent", "healthy_adult", "happy_child"] },
      archetype: { type: "string" },
      title: { type: "string" },
      persona: { type: "string" },
      imagery: { type: "string" },
      symbolicForm: { type: "string" },
      facialExpression: { type: "string" },
      fear: { type: "string" },
      burden: { type: "string" },
      protectiveJob: { type: "string" },
      originContext: { type: "string" },
      firstAppearanceAt: nullable({ type: "string", format: "date-time" }),
      linkedPatternIds: arrayOf({ type: "string" }),
      linkedBehaviorIds: arrayOf({ type: "string" }),
      linkedValueIds: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const modeGuideSession = {
    type: "object",
    additionalProperties: false,
    required: ["id", "summary", "answers", "results", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      summary: { type: "string" },
      answers: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["questionKey", "value"],
        properties: {
          questionKey: { type: "string" },
          value: { type: "string" }
        }
      }),
      results: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["family", "archetype", "label", "confidence", "reasoning"],
        properties: {
          family: { type: "string", enum: ["coping", "child", "critic_parent", "healthy_adult", "happy_child"] },
          archetype: { type: "string" },
          label: { type: "string" },
          confidence: { type: "number" },
          reasoning: { type: "string" }
        }
      }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const comment = {
    type: "object",
    additionalProperties: false,
    required: ["id", "entityType", "entityId", "anchorKey", "body", "author", "source", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      entityType: { type: "string" },
      entityId: { type: "string" },
      anchorKey: nullable({ type: "string" }),
      body: { type: "string" },
      author: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const triggerReport = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "title",
      "status",
      "eventTypeId",
      "customEventType",
      "eventSituation",
      "occurredAt",
      "emotions",
      "thoughts",
      "behaviors",
      "consequences",
      "linkedPatternIds",
      "linkedValueIds",
      "linkedGoalIds",
      "linkedProjectIds",
      "linkedTaskIds",
      "linkedBehaviorIds",
      "linkedBeliefIds",
      "linkedModeIds",
      "modeOverlays",
      "schemaLinks",
      "modeTimeline",
      "nextMoves",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      title: { type: "string" },
      status: { type: "string", enum: ["draft", "reviewed", "integrated"] },
      eventTypeId: nullable({ type: "string" }),
      customEventType: { type: "string" },
      eventSituation: { type: "string" },
      occurredAt: nullable({ type: "string", format: "date-time" }),
      emotions: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "emotionDefinitionId", "label", "intensity", "note"],
        properties: {
          id: { type: "string" },
          emotionDefinitionId: nullable({ type: "string" }),
          label: { type: "string" },
          intensity: { type: "integer" },
          note: { type: "string" }
        }
      }),
      thoughts: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "parentMode", "criticMode", "beliefId"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          parentMode: { type: "string" },
          criticMode: { type: "string" },
          beliefId: nullable({ type: "string" })
        }
      }),
      behaviors: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "mode", "behaviorId"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          mode: { type: "string" },
          behaviorId: nullable({ type: "string" })
        }
      }),
      consequences: {
        type: "object",
        additionalProperties: false,
        required: ["selfShortTerm", "selfLongTerm", "othersShortTerm", "othersLongTerm"],
        properties: {
          selfShortTerm: arrayOf({ type: "string" }),
          selfLongTerm: arrayOf({ type: "string" }),
          othersShortTerm: arrayOf({ type: "string" }),
          othersLongTerm: arrayOf({ type: "string" })
        }
      },
      linkedPatternIds: arrayOf({ type: "string" }),
      linkedValueIds: arrayOf({ type: "string" }),
      linkedGoalIds: arrayOf({ type: "string" }),
      linkedProjectIds: arrayOf({ type: "string" }),
      linkedTaskIds: arrayOf({ type: "string" }),
      linkedBehaviorIds: arrayOf({ type: "string" }),
      linkedBeliefIds: arrayOf({ type: "string" }),
      linkedModeIds: arrayOf({ type: "string" }),
      modeOverlays: arrayOf({ type: "string" }),
      schemaLinks: arrayOf({ type: "string" }),
      modeTimeline: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "stage", "modeId", "label", "note"],
        properties: {
          id: { type: "string" },
          stage: { type: "string" },
          modeId: nullable({ type: "string" }),
          label: { type: "string" },
          note: { type: "string" }
        }
      }),
      nextMoves: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const psycheOverviewPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "domain",
      "values",
      "patterns",
      "behaviors",
      "beliefs",
      "modes",
      "schemaPressure",
      "reports",
      "openInsights",
      "unresolvedComments",
      "committedActions"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      domain: { $ref: "#/components/schemas/Domain" },
      values: arrayOf({ $ref: "#/components/schemas/PsycheValue" }),
      patterns: arrayOf({ $ref: "#/components/schemas/BehaviorPattern" }),
      behaviors: arrayOf({ $ref: "#/components/schemas/Behavior" }),
      beliefs: arrayOf({ $ref: "#/components/schemas/BeliefEntry" }),
      modes: arrayOf({ $ref: "#/components/schemas/ModeProfile" }),
      schemaPressure: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["schemaId", "title", "activationCount"],
        properties: {
          schemaId: { type: "string" },
          title: { type: "string" },
          activationCount: { type: "integer" }
        }
      }),
      reports: arrayOf({ $ref: "#/components/schemas/TriggerReport" }),
      openInsights: { type: "integer" },
      unresolvedComments: { type: "integer" },
      committedActions: arrayOf({ type: "string" })
    }
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Forge API",
      version: "v1",
      description: "Projects-first API for the Forge life-goal, project, task, and evidence system."
    },
    servers: [
      {
        url: "/",
        description: "Forge runtime"
      }
    ],
    components: {
      schemas: {
        ValidationIssue: validationIssue,
        ErrorResponse: errorResponse,
        Tag: tag,
        Goal: goal,
        DashboardGoal: dashboardGoal,
        Project: project,
        TaskTimeSummary: taskTimeSummary,
        ProjectSummary: projectSummary,
        Task: task,
        TaskRun: taskRun,
        ActivityEvent: activityEvent,
        GamificationProfile: gamificationProfile,
        AchievementSignal: achievementSignal,
        MilestoneReward: milestoneReward,
        XpMomentumPulse: xpMomentumPulse,
        DashboardPayload: dashboardPayload,
        OverviewContext: overviewContext,
        TodayContext: todayContext,
        RiskContext: riskContext,
        ForgeSnapshot: forgeSnapshot,
        TaskContextPayload: taskContextPayload,
        ProjectBoardPayload: projectBoardPayload,
        InsightsPayload: insightsPayload,
        WeeklyReviewPayload: weeklyReviewPayload,
        SettingsPayload: settingsPayload,
        ExecutionSettings: executionSettings,
        TaskRunClaimInput: taskRunClaimInput,
        TaskRunHeartbeatInput: taskRunHeartbeatInput,
        TaskRunFinishInput: taskRunFinishInput,
        TaskRunFocusInput: taskRunFocusInput,
        SettingsUpdateInput: settingsUpdateInput,
        AgentOnboardingPayload: agentOnboardingPayload,
        DeletedEntityRecord: deletedEntityRecord,
        SettingsBinPayload: settingsBinPayload,
        BatchEntityResult: batchEntityResult,
        AgentIdentity: agentIdentity,
        AgentTokenSummary: agentTokenSummary,
        AgentTokenMutationResult: agentTokenMutationResult,
        Domain: domain,
        SchemaCatalogEntry: schemaCatalogEntry,
        EventType: eventType,
        EmotionDefinition: emotionDefinition,
        PsycheValue: psycheValue,
        BehaviorPattern: behaviorPattern,
        Behavior: behavior,
        BeliefEntry: beliefEntry,
        ModeProfile: modeProfile,
        ModeGuideSession: modeGuideSession,
        TriggerReport: triggerReport,
        Comment: comment,
        PsycheOverviewPayload: psycheOverviewPayload,
        Insight: insight,
        InsightFeedback: insightFeedback,
        ApprovalRequest: approvalRequest,
        AgentAction: agentAction,
        RewardRule: rewardRule,
        RewardLedgerEvent: rewardLedgerEvent,
        EventLogEntry: eventLogEntry,
        XpMetricsPayload: xpMetricsPayload,
        OperatorContextPayload: operatorContextPayload,
        OperatorOverviewPayload: operatorOverviewPayload
      },
      responses: {
        Error: jsonResponse({ $ref: "#/components/schemas/ErrorResponse" }, "Error response")
      }
    },
    paths: {
      "/api/v1/health": {
        get: {
          summary: "Get Forge API health and watchdog status",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["ok", "app", "now", "watchdog"],
                properties: {
                  ok: { type: "boolean" },
                  app: { type: "string", enum: ["forge"] },
                  now: { type: "string", format: "date-time" },
                  watchdog: {
                    type: "object",
                    required: ["enabled", "healthy", "state", "reason", "status"],
                    properties: {
                      enabled: { type: "boolean" },
                      healthy: { type: "boolean" },
                      state: { type: "string", enum: ["disabled", "idle", "healthy", "degraded"] },
                      reason: { anyOf: [{ type: "string" }, { type: "null" }] },
                      status: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] }
                    }
                  }
                }
              },
              "Forge health payload"
            )
          }
        }
      },
      "/api/v1/context": {
        get: {
          summary: "Get the full Forge snapshot for the routed app shell",
          responses: {
            "200": jsonResponse({ $ref: "#/components/schemas/ForgeSnapshot" }, "Forge snapshot"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/operator/context": {
        get: {
          summary: "Get the operator-focused Forge context for agents and assistant workflows",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["context"],
                properties: {
                  context: { $ref: "#/components/schemas/OperatorContextPayload" }
                }
              },
              "Operator context"
            )
          }
        }
      },
      "/api/v1/operator/overview": {
        get: {
          summary: "Get the one-shot operator overview with full current state, route guidance, and optional Psyche summary",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["overview"],
                properties: {
                  overview: { $ref: "#/components/schemas/OperatorOverviewPayload" }
                }
              },
              "Operator overview"
            )
          }
        }
      },
      "/api/v1/domains": {
        get: {
          summary: "List canonical Forge domains",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["domains"],
                properties: {
                  domains: arrayOf({ $ref: "#/components/schemas/Domain" })
                }
              },
              "Domain collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/overview": {
        get: {
          summary: "Get the Psyche hub overview",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["overview"],
                properties: {
                  overview: { $ref: "#/components/schemas/PsycheOverviewPayload" }
                }
              },
              "Psyche overview"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/values": {
        get: {
          summary: "List ACT-style values",
          responses: {
            "200": jsonResponse({ type: "object", required: ["values"], properties: { values: arrayOf({ $ref: "#/components/schemas/PsycheValue" }) } }, "Psyche value collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Psyche value",
          responses: {
            "201": jsonResponse({ type: "object", required: ["value"], properties: { value: { $ref: "#/components/schemas/PsycheValue" } } }, "Created value"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/values/{id}": {
        get: {
          summary: "Get a Psyche value",
          responses: {
            "200": jsonResponse({ type: "object", required: ["value"], properties: { value: { $ref: "#/components/schemas/PsycheValue" } } }, "Psyche value"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Psyche value",
          responses: {
            "200": jsonResponse({ type: "object", required: ["value"], properties: { value: { $ref: "#/components/schemas/PsycheValue" } } }, "Updated value"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Psyche value",
          responses: {
            "200": jsonResponse({ type: "object", required: ["value"], properties: { value: { $ref: "#/components/schemas/PsycheValue" } } }, "Deleted value"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/patterns": {
        get: {
          summary: "List behavior patterns",
          responses: {
            "200": jsonResponse({ type: "object", required: ["patterns"], properties: { patterns: arrayOf({ $ref: "#/components/schemas/BehaviorPattern" }) } }, "Behavior pattern collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a behavior pattern",
          responses: {
            "201": jsonResponse({ type: "object", required: ["pattern"], properties: { pattern: { $ref: "#/components/schemas/BehaviorPattern" } } }, "Created behavior pattern"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/patterns/{id}": {
        get: {
          summary: "Get a behavior pattern",
          responses: {
            "200": jsonResponse({ type: "object", required: ["pattern"], properties: { pattern: { $ref: "#/components/schemas/BehaviorPattern" } } }, "Behavior pattern"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a behavior pattern",
          responses: {
            "200": jsonResponse({ type: "object", required: ["pattern"], properties: { pattern: { $ref: "#/components/schemas/BehaviorPattern" } } }, "Updated behavior pattern"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a behavior pattern",
          responses: {
            "200": jsonResponse({ type: "object", required: ["pattern"], properties: { pattern: { $ref: "#/components/schemas/BehaviorPattern" } } }, "Deleted behavior pattern"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/behaviors": {
        get: {
          summary: "List tracked Psyche behaviors",
          responses: {
            "200": jsonResponse({ type: "object", required: ["behaviors"], properties: { behaviors: arrayOf({ $ref: "#/components/schemas/Behavior" }) } }, "Behavior collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Psyche behavior",
          responses: {
            "201": jsonResponse({ type: "object", required: ["behavior"], properties: { behavior: { $ref: "#/components/schemas/Behavior" } } }, "Created behavior"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/behaviors/{id}": {
        get: {
          summary: "Get a Psyche behavior",
          responses: {
            "200": jsonResponse({ type: "object", required: ["behavior"], properties: { behavior: { $ref: "#/components/schemas/Behavior" } } }, "Behavior detail"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Psyche behavior",
          responses: {
            "200": jsonResponse({ type: "object", required: ["behavior"], properties: { behavior: { $ref: "#/components/schemas/Behavior" } } }, "Updated behavior"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Psyche behavior",
          responses: {
            "200": jsonResponse({ type: "object", required: ["behavior"], properties: { behavior: { $ref: "#/components/schemas/Behavior" } } }, "Deleted behavior"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/schema-catalog": {
        get: {
          summary: "List the fixed schema-therapy catalog",
          responses: {
            "200": jsonResponse({ type: "object", required: ["schemas"], properties: { schemas: arrayOf({ $ref: "#/components/schemas/SchemaCatalogEntry" }) } }, "Schema catalog"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/beliefs": {
        get: {
          summary: "List belief entries linked to schemas and reports",
          responses: {
            "200": jsonResponse({ type: "object", required: ["beliefs"], properties: { beliefs: arrayOf({ $ref: "#/components/schemas/BeliefEntry" }) } }, "Belief collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a belief entry",
          responses: {
            "201": jsonResponse({ type: "object", required: ["belief"], properties: { belief: { $ref: "#/components/schemas/BeliefEntry" } } }, "Created belief"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/beliefs/{id}": {
        get: {
          summary: "Get a belief entry",
          responses: {
            "200": jsonResponse({ type: "object", required: ["belief"], properties: { belief: { $ref: "#/components/schemas/BeliefEntry" } } }, "Belief detail"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a belief entry",
          responses: {
            "200": jsonResponse({ type: "object", required: ["belief"], properties: { belief: { $ref: "#/components/schemas/BeliefEntry" } } }, "Updated belief"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a belief entry",
          responses: {
            "200": jsonResponse({ type: "object", required: ["belief"], properties: { belief: { $ref: "#/components/schemas/BeliefEntry" } } }, "Deleted belief"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/modes": {
        get: {
          summary: "List Psyche mode profiles",
          responses: {
            "200": jsonResponse({ type: "object", required: ["modes"], properties: { modes: arrayOf({ $ref: "#/components/schemas/ModeProfile" }) } }, "Mode collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Psyche mode profile",
          responses: {
            "201": jsonResponse({ type: "object", required: ["mode"], properties: { mode: { $ref: "#/components/schemas/ModeProfile" } } }, "Created mode"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/modes/{id}": {
        get: {
          summary: "Get a Psyche mode profile",
          responses: {
            "200": jsonResponse({ type: "object", required: ["mode"], properties: { mode: { $ref: "#/components/schemas/ModeProfile" } } }, "Mode detail"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Psyche mode profile",
          responses: {
            "200": jsonResponse({ type: "object", required: ["mode"], properties: { mode: { $ref: "#/components/schemas/ModeProfile" } } }, "Updated mode"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Psyche mode profile",
          responses: {
            "200": jsonResponse({ type: "object", required: ["mode"], properties: { mode: { $ref: "#/components/schemas/ModeProfile" } } }, "Deleted mode"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/mode-guides": {
        get: {
          summary: "List guided mode-identification sessions",
          responses: {
            "200": jsonResponse({ type: "object", required: ["sessions"], properties: { sessions: arrayOf({ $ref: "#/components/schemas/ModeGuideSession" }) } }, "Mode guide sessions"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a guided mode-identification session",
          responses: {
            "201": jsonResponse({ type: "object", required: ["session"], properties: { session: { $ref: "#/components/schemas/ModeGuideSession" } } }, "Created mode guide session"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/mode-guides/{id}": {
        get: {
          summary: "Get a guided mode-identification session",
          responses: {
            "200": jsonResponse({ type: "object", required: ["session"], properties: { session: { $ref: "#/components/schemas/ModeGuideSession" } } }, "Mode guide detail"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a guided mode-identification session",
          responses: {
            "200": jsonResponse({ type: "object", required: ["session"], properties: { session: { $ref: "#/components/schemas/ModeGuideSession" } } }, "Updated mode guide session"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a guided mode-identification session",
          responses: {
            "200": jsonResponse({ type: "object", required: ["session"], properties: { session: { $ref: "#/components/schemas/ModeGuideSession" } } }, "Deleted mode guide session"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/event-types": {
        get: {
          summary: "List seeded and custom Psyche event types",
          responses: {
            "200": jsonResponse({ type: "object", required: ["eventTypes"], properties: { eventTypes: arrayOf({ $ref: "#/components/schemas/EventType" }) } }, "Event type collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a custom Psyche event type",
          responses: {
            "201": jsonResponse({ type: "object", required: ["eventType"], properties: { eventType: { $ref: "#/components/schemas/EventType" } } }, "Created event type"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/event-types/{id}": {
        get: {
          summary: "Get a Psyche event type",
          responses: {
            "200": jsonResponse({ type: "object", required: ["eventType"], properties: { eventType: { $ref: "#/components/schemas/EventType" } } }, "Event type detail"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a custom Psyche event type",
          responses: {
            "200": jsonResponse({ type: "object", required: ["eventType"], properties: { eventType: { $ref: "#/components/schemas/EventType" } } }, "Updated event type"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a custom Psyche event type",
          responses: {
            "200": jsonResponse({ type: "object", required: ["eventType"], properties: { eventType: { $ref: "#/components/schemas/EventType" } } }, "Deleted event type"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/emotions": {
        get: {
          summary: "List seeded and custom Psyche emotions",
          responses: {
            "200": jsonResponse({ type: "object", required: ["emotions"], properties: { emotions: arrayOf({ $ref: "#/components/schemas/EmotionDefinition" }) } }, "Emotion collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a custom Psyche emotion",
          responses: {
            "201": jsonResponse({ type: "object", required: ["emotion"], properties: { emotion: { $ref: "#/components/schemas/EmotionDefinition" } } }, "Created emotion"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/emotions/{id}": {
        get: {
          summary: "Get a Psyche emotion definition",
          responses: {
            "200": jsonResponse({ type: "object", required: ["emotion"], properties: { emotion: { $ref: "#/components/schemas/EmotionDefinition" } } }, "Emotion detail"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a custom Psyche emotion definition",
          responses: {
            "200": jsonResponse({ type: "object", required: ["emotion"], properties: { emotion: { $ref: "#/components/schemas/EmotionDefinition" } } }, "Updated emotion"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a custom Psyche emotion definition",
          responses: {
            "200": jsonResponse({ type: "object", required: ["emotion"], properties: { emotion: { $ref: "#/components/schemas/EmotionDefinition" } } }, "Deleted emotion"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/reports": {
        get: {
          summary: "List trigger reports",
          responses: {
            "200": jsonResponse({ type: "object", required: ["reports"], properties: { reports: arrayOf({ $ref: "#/components/schemas/TriggerReport" }) } }, "Trigger report collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a trigger report",
          responses: {
            "201": jsonResponse({ type: "object", required: ["report"], properties: { report: { $ref: "#/components/schemas/TriggerReport" } } }, "Created trigger report"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/reports/{id}": {
        get: {
          summary: "Get a trigger report with comments and linked insights",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["report", "comments", "insights"],
                properties: {
                  report: { $ref: "#/components/schemas/TriggerReport" },
                  comments: arrayOf({ $ref: "#/components/schemas/Comment" }),
                  insights: arrayOf({ $ref: "#/components/schemas/Insight" })
                }
              },
              "Trigger report detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a trigger report",
          responses: {
            "200": jsonResponse({ type: "object", required: ["report"], properties: { report: { $ref: "#/components/schemas/TriggerReport" } } }, "Updated trigger report"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a trigger report",
          responses: {
            "200": jsonResponse({ type: "object", required: ["report"], properties: { report: { $ref: "#/components/schemas/TriggerReport" } } }, "Deleted trigger report"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/comments": {
        get: {
          summary: "List comments on Forge entities",
          responses: {
            "200": jsonResponse({ type: "object", required: ["comments"], properties: { comments: arrayOf({ $ref: "#/components/schemas/Comment" }) } }, "Comment collection"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a comment on a Forge entity",
          responses: {
            "201": jsonResponse({ type: "object", required: ["comment"], properties: { comment: { $ref: "#/components/schemas/Comment" } } }, "Created comment"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/comments/{id}": {
        get: {
          summary: "Get a comment",
          responses: {
            "200": jsonResponse({ type: "object", required: ["comment"], properties: { comment: { $ref: "#/components/schemas/Comment" } } }, "Comment"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a comment",
          responses: {
            "200": jsonResponse({ type: "object", required: ["comment"], properties: { comment: { $ref: "#/components/schemas/Comment" } } }, "Updated comment"),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a comment",
          responses: {
            "200": jsonResponse({ type: "object", required: ["comment"], properties: { comment: { $ref: "#/components/schemas/Comment" } } }, "Deleted comment"),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/projects": {
        get: {
          summary: "List projects",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["projects"],
                properties: {
                  projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" })
                }
              },
              "Project collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a project",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/Project" }
                }
              },
              "Created project"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/campaigns": {
        get: {
          deprecated: true,
          summary: "Deprecated alias for project listing",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["projects"],
                properties: {
                  projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" })
                }
              },
              "Project collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/projects/{id}": {
        get: {
          summary: "Get a project summary",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/ProjectSummary" }
                }
              },
              "Project summary"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a project",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/Project" }
                }
              },
              "Updated project"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a project",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/Project" }
                }
              },
              "Deleted project"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/projects/{id}/board": {
        get: {
          summary: "Get the board and evidence for one project",
          responses: {
            "200": jsonResponse({ $ref: "#/components/schemas/ProjectBoardPayload" }, "Project board"),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/goals": {
        get: {
          summary: "List life goals",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goals"],
                properties: {
                  goals: arrayOf({ $ref: "#/components/schemas/Goal" })
                }
              },
              "Goal collection"
            )
          }
        },
        post: {
          summary: "Create a life goal",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Created goal"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/goals/{id}": {
        get: {
          summary: "Get a life goal",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Goal"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a life goal",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Updated goal"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a life goal",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Deleted goal"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tags": {
        get: {
          summary: "List tags",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tags"],
                properties: {
                  tags: arrayOf({ $ref: "#/components/schemas/Tag" })
                }
              },
              "Tag collection"
            )
          }
        },
        post: {
          summary: "Create a tag",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Created tag"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tags/{id}": {
        get: {
          summary: "Get a tag",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Tag"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a tag",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Updated tag"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a tag",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Deleted tag"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks": {
        get: {
          summary: "List tasks",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tasks"],
                properties: {
                  tasks: arrayOf({ $ref: "#/components/schemas/Task" })
                }
              },
              "Task collection"
            )
          }
        },
        post: {
          summary: "Create a task",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Created task"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/operator/log-work": {
        post: {
          summary: "Log work that already happened by creating or updating a task and returning fresh XP state",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task", "xp"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" },
                  xp: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Updated task and XP state"
            ),
            "201": jsonResponse(
              {
                type: "object",
                required: ["task", "xp"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" },
                  xp: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Created task and XP state"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}": {
        get: {
          summary: "Get a task",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a task",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Updated task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a task",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Deleted task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/context": {
        get: {
          summary: "Get task detail context including project, goal, runs, and evidence",
          responses: {
            "200": jsonResponse({ $ref: "#/components/schemas/TaskContextPayload" }, "Task detail payload"),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/runs": {
        post: {
          summary: "Start or renew a live task timer for a task",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunClaimInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Existing active task timer"
            ),
            "201": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Created task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/uncomplete": {
        post: {
          summary: "Reopen a completed task and remove its completion XP",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Reopened task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs": {
        get: {
          summary: "List task timers with optional task and active-state filters",
          parameters: [
            { name: "taskId", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "completed", "released", "timed_out"] } },
            { name: "active", in: "query", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRuns"],
                properties: {
                  taskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" })
                }
              },
              "Task timers"
            )
          }
        }
      },
      "/api/v1/task-runs/{id}/heartbeat": {
        post: {
          summary: "Renew a live task timer heartbeat",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunHeartbeatInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Updated task timer heartbeat"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/focus": {
        post: {
          summary: "Mark one live task timer as the current primary timer",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunFocusInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Focused task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/complete": {
        post: {
          summary: "Complete a live task timer and complete the task",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunFinishInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Completed task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/release": {
        post: {
          summary: "Pause or release a live task timer without completing the task",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunFinishInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Released task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/activity": {
        get: {
          summary: "List visible activity events",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["activity"],
                properties: {
                  activity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" })
                }
              },
              "Activity archive"
            )
          }
        }
      },
      "/api/v1/activity/{id}/remove": {
        post: {
          summary: "Hide an activity event from the visible archive through a correction record",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["event"],
                properties: {
                  event: { $ref: "#/components/schemas/ActivityEvent" }
                }
              },
              "Correction event"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/metrics": {
        get: {
          summary: "Get gamification metrics",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["metrics"],
                properties: {
                  metrics: {
                    type: "object",
                    additionalProperties: false,
                    required: ["profile", "achievements", "milestoneRewards"],
                    properties: {
                      profile: { $ref: "#/components/schemas/GamificationProfile" },
                      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
                      milestoneRewards: arrayOf({ $ref: "#/components/schemas/MilestoneReward" })
                    }
                  }
                }
              },
              "Gamification metrics"
            )
          }
        }
      },
      "/api/v1/metrics/xp": {
        get: {
          summary: "Get explainable XP metrics and reward-ledger state",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["metrics"],
                properties: {
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "XP metrics payload"
            )
          }
        }
      },
      "/api/v1/insights": {
        get: {
          summary: "Get deterministic coaching and stored insight feed",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insights"],
                properties: {
                  insights: { $ref: "#/components/schemas/InsightsPayload" }
                }
              },
              "Insights payload"
            )
          }
        },
        post: {
          summary: "Store a structured insight",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Created insight"
            )
          }
        }
      },
      "/api/v1/insights/{id}": {
        get: {
          summary: "Get one stored insight",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Insight"
            )
          }
        },
        patch: {
          summary: "Update a stored insight",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Updated insight"
            )
          }
        },
        delete: {
          summary: "Soft delete or permanently delete a stored insight",
          parameters: [
            { name: "mode", in: "query", schema: { type: "string", enum: ["soft", "hard"] } },
            { name: "reason", in: "query", schema: { type: "string" } }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Deleted insight"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/insights/{id}/feedback": {
        post: {
          summary: "Record structured feedback for an insight",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["feedback"],
                properties: {
                  feedback: { $ref: "#/components/schemas/InsightFeedback" }
                }
              },
              "Insight feedback"
            )
          }
        }
      },
      "/api/v1/approval-requests": {
        get: {
          summary: "List approval requests",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["approvalRequests"],
                properties: {
                  approvalRequests: arrayOf({ $ref: "#/components/schemas/ApprovalRequest" })
                }
              },
              "Approval requests"
            )
          }
        }
      },
      "/api/v1/approval-requests/{id}/approve": {
        post: {
          summary: "Approve and execute a pending agent action",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["approvalRequest"],
                properties: {
                  approvalRequest: { $ref: "#/components/schemas/ApprovalRequest" }
                }
              },
              "Approved request"
            )
          }
        }
      },
      "/api/v1/approval-requests/{id}/reject": {
        post: {
          summary: "Reject a pending agent action",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["approvalRequest"],
                properties: {
                  approvalRequest: { $ref: "#/components/schemas/ApprovalRequest" }
                }
              },
              "Rejected request"
            )
          }
        }
      },
      "/api/v1/agents": {
        get: {
          summary: "List registered agent identities",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["agents"],
                properties: {
                  agents: arrayOf({ $ref: "#/components/schemas/AgentIdentity" })
                }
              },
              "Agent identities"
            )
          }
        }
      },
      "/api/v1/agents/onboarding": {
        get: {
          summary: "Get the live onboarding contract for new API agents",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["onboarding"],
                properties: {
                  onboarding: { $ref: "#/components/schemas/AgentOnboardingPayload" }
                }
              },
              "Agent onboarding payload"
            )
          }
        }
      },
      "/api/v1/agents/{id}/actions": {
        get: {
          summary: "List actions created by one agent",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["actions"],
                properties: {
                  actions: arrayOf({ $ref: "#/components/schemas/AgentAction" })
                }
              },
              "Agent actions"
            )
          }
        }
      },
      "/api/v1/agent-actions": {
        post: {
          summary: "Create an agent action that either executes directly or enters the approval queue",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["action", "approvalRequest"],
                properties: {
                  action: { $ref: "#/components/schemas/AgentAction" },
                  approvalRequest: nullable({ $ref: "#/components/schemas/ApprovalRequest" })
                }
              },
              "Executed agent action"
            ),
            "202": jsonResponse(
              {
                type: "object",
                required: ["action", "approvalRequest"],
                properties: {
                  action: { $ref: "#/components/schemas/AgentAction" },
                  approvalRequest: nullable({ $ref: "#/components/schemas/ApprovalRequest" })
                }
              },
              "Pending approval agent action"
            )
          }
        }
      },
      "/api/v1/rewards/rules": {
        get: {
          summary: "List reward rules",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["rules"],
                properties: {
                  rules: arrayOf({ $ref: "#/components/schemas/RewardRule" })
                }
              },
              "Reward rules"
            )
          }
        }
      },
      "/api/v1/rewards/rules/{id}": {
        get: {
          summary: "Get one reward rule",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["rule"],
                properties: {
                  rule: { $ref: "#/components/schemas/RewardRule" }
                }
              },
              "Reward rule"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a reward rule",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["rule"],
                properties: {
                  rule: { $ref: "#/components/schemas/RewardRule" }
                }
              },
              "Updated reward rule"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/rewards/ledger": {
        get: {
          summary: "List reward ledger events",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["ledger"],
                properties: {
                  ledger: arrayOf({ $ref: "#/components/schemas/RewardLedgerEvent" })
                }
              },
              "Reward ledger"
            )
          }
        }
      },
      "/api/v1/rewards/bonus": {
        post: {
          summary: "Create a manual, explainable XP bonus entry",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["reward", "metrics"],
                properties: {
                  reward: { $ref: "#/components/schemas/RewardLedgerEvent" },
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Manual reward bonus"
            )
          }
        }
      },
      "/api/v1/events": {
        get: {
          summary: "List canonical event log entries",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["events"],
                properties: {
                  events: arrayOf({ $ref: "#/components/schemas/EventLogEntry" })
                }
              },
              "Event log"
            )
          }
        }
      },
      "/api/v1/session-events": {
        post: {
          summary: "Record bounded ambient engagement telemetry",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["sessionEvent", "rewardEvent"],
                properties: {
                  sessionEvent: { type: "object", additionalProperties: true },
                  rewardEvent: nullable({ $ref: "#/components/schemas/RewardLedgerEvent" })
                }
              },
              "Recorded session event"
            )
          }
        }
      },
      "/api/v1/reviews/weekly": {
        get: {
          summary: "Get the weekly review payload",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["review"],
                properties: {
                  review: { $ref: "#/components/schemas/WeeklyReviewPayload" }
                }
              },
              "Weekly review payload"
            )
          }
        }
      },
      "/api/v1/settings": {
        get: {
          summary: "Get local operator settings",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["settings"],
                properties: {
                  settings: { $ref: "#/components/schemas/SettingsPayload" }
                }
              },
              "Settings payload"
            )
          }
        },
        patch: {
          summary: "Update local operator settings",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SettingsUpdateInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["settings"],
                properties: {
                  settings: { $ref: "#/components/schemas/SettingsPayload" }
                }
              },
              "Updated settings"
            )
          }
        }
      },
      "/api/v1/settings/bin": {
        get: {
          summary: "Get the deleted-items bin with restore and hard-delete context",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["bin"],
                properties: {
                  bin: { $ref: "#/components/schemas/SettingsBinPayload" }
                }
              },
              "Settings bin payload"
            )
          }
        }
      },
      "/api/v1/entities/create": {
        post: {
          summary: "Create multiple Forge entities in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({ $ref: "#/components/schemas/BatchEntityResult" })
                }
              },
              "Batch create results"
            )
          }
        }
      },
      "/api/v1/entities/update": {
        post: {
          summary: "Update multiple Forge entities in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({ $ref: "#/components/schemas/BatchEntityResult" })
                }
              },
              "Batch update results"
            )
          }
        }
      },
      "/api/v1/entities/delete": {
        post: {
          summary: "Delete multiple Forge entities in one ordered batch request. Soft delete is the default.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({ $ref: "#/components/schemas/BatchEntityResult" })
                }
              },
              "Batch delete results"
            )
          }
        }
      },
      "/api/v1/entities/restore": {
        post: {
          summary: "Restore multiple soft-deleted Forge entities in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({ $ref: "#/components/schemas/BatchEntityResult" })
                }
              },
              "Batch restore results"
            )
          }
        }
      },
      "/api/v1/entities/search": {
        post: {
          summary: "Search across multiple Forge entity types in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({ $ref: "#/components/schemas/BatchEntityResult" })
                }
              },
              "Batch search results"
            )
          }
        }
      },
      "/api/v1/settings/tokens": {
        post: {
          summary: "Create an agent token",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["token"],
                properties: {
                  token: { $ref: "#/components/schemas/AgentTokenMutationResult" }
                }
              },
              "Created agent token"
            )
          }
        }
      }
    }
  };
}
