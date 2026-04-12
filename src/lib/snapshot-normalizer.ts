import type {
  CalendarSchedulingRules,
  ForgeSnapshot,
  Goal,
  Habit,
  ProjectSummary,
  Strategy,
  Tag,
  Task,
  UserSummary
} from "./types";

const EMPTY_CALENDAR_RULES: CalendarSchedulingRules = {
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

type LegacyProjectLike = Partial<ProjectSummary> & {
  summary?: string;
  totalPoints?: number;
  derived?: boolean;
};

type LegacySnapshot = Partial<ForgeSnapshot> & {
  dashboard?: Partial<ForgeSnapshot["dashboard"]> & {
    campaigns?: LegacyProjectLike[];
  };
  overview?: Partial<ForgeSnapshot["overview"]> & {
    campaigns?: LegacyProjectLike[];
  };
  projects?: ProjectSummary[];
  campaigns?: LegacyProjectLike[];
};

function normalizeTask(task: Partial<Task> | undefined): Task {
  return {
    id: task?.id ?? "",
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? "backlog",
    priority: task?.priority ?? "medium",
    owner: task?.owner ?? "Albert",
    goalId: task?.goalId ?? null,
    projectId: task?.projectId ?? null,
    dueDate: task?.dueDate ?? null,
    effort: task?.effort ?? "deep",
    energy: task?.energy ?? "steady",
    points: task?.points ?? 0,
    plannedDurationSeconds: task?.plannedDurationSeconds ?? null,
    schedulingRules: task?.schedulingRules ?? null,
    sortOrder: task?.sortOrder ?? 0,
    resolutionKind: task?.resolutionKind ?? null,
    splitParentTaskId: task?.splitParentTaskId ?? null,
    completedAt: task?.completedAt ?? null,
    createdAt: task?.createdAt ?? new Date(0).toISOString(),
    updatedAt: task?.updatedAt ?? new Date(0).toISOString(),
    tagIds: task?.tagIds ?? [],
    userId: task?.userId ?? null,
    user: (task?.user as UserSummary | null | undefined) ?? null,
    time: task?.time ?? {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    },
    actionPointSummary: task?.actionPointSummary ?? {
      costBand: "standard",
      totalCostAp: 100,
      expectedDurationSeconds: 86_400,
      sustainRateApPerHour: 100 / 24,
      spentTodayAp: 0,
      spentTotalAp: 0,
      remainingAp: 100
    },
    splitSuggestion: task?.splitSuggestion ?? {
      shouldSplit: false,
      reason: null,
      thresholdSeconds: 2 * 86_400
    }
  };
}

function normalizeGoal(goal: Partial<Goal> | undefined): Goal {
  return {
    id: goal?.id ?? "",
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    horizon:
      goal?.horizon === "quarter" || goal?.horizon === "lifetime"
        ? goal.horizon
        : "year",
    status:
      goal?.status === "paused" || goal?.status === "completed"
        ? goal.status
        : "active",
    targetPoints: goal?.targetPoints ?? 0,
    themeColor: goal?.themeColor ?? "#c8a46b",
    createdAt: goal?.createdAt ?? new Date(0).toISOString(),
    updatedAt: goal?.updatedAt ?? new Date(0).toISOString(),
    tagIds: goal?.tagIds ?? [],
    userId: goal?.userId ?? null,
    user: (goal?.user as UserSummary | null | undefined) ?? null
  };
}

function normalizeTag(tag: Partial<Tag> | undefined): Tag {
  return {
    id: tag?.id ?? "",
    name: tag?.name ?? "",
    kind:
      tag?.kind === "value" || tag?.kind === "execution"
        ? tag.kind
        : "category",
    color: tag?.color ?? "#71717a",
    description: tag?.description ?? "",
    userId: tag?.userId ?? null,
    user: (tag?.user as UserSummary | null | undefined) ?? null
  };
}

function normalizeProject(
  project: LegacyProjectLike | undefined
): ProjectSummary {
  return {
    id: project?.id ?? "",
    goalId: project?.goalId ?? "",
    title: project?.title ?? "",
    description: project?.description ?? project?.summary ?? "",
    status:
      project?.status === "paused" || project?.status === "completed"
        ? project.status
        : "active",
    targetPoints: project?.targetPoints ?? project?.totalPoints ?? 0,
    themeColor: project?.themeColor ?? "#c0c1ff",
    schedulingRules: project?.schedulingRules ?? EMPTY_CALENDAR_RULES,
    createdAt: project?.createdAt ?? new Date(0).toISOString(),
    updatedAt: project?.updatedAt ?? new Date(0).toISOString(),
    goalTitle: project?.goalTitle ?? "",
    activeTaskCount: project?.activeTaskCount ?? 0,
    completedTaskCount: project?.completedTaskCount ?? 0,
    totalTasks: project?.totalTasks ?? 0,
    earnedPoints: project?.earnedPoints ?? project?.totalPoints ?? 0,
    progress: project?.progress ?? 0,
    nextTaskId: project?.nextTaskId ?? null,
    nextTaskTitle: project?.nextTaskTitle ?? null,
    momentumLabel: project?.momentumLabel ?? "No momentum yet",
    userId: (project as Partial<ProjectSummary> | undefined)?.userId ?? null,
    user:
      ((project as Partial<ProjectSummary> | undefined)?.user as
        | UserSummary
        | null
        | undefined) ?? null,
    time: project?.time ?? {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    }
  };
}

function normalizeHabit(habit: Partial<Habit> | undefined): Habit {
  return {
    id: habit?.id ?? "",
    title: habit?.title ?? "",
    description: habit?.description ?? "",
    status: habit?.status ?? "active",
    polarity: habit?.polarity ?? "positive",
    frequency: habit?.frequency ?? "daily",
    targetCount: habit?.targetCount ?? 1,
    weekDays: habit?.weekDays ?? [],
    linkedGoalIds: habit?.linkedGoalIds ?? [],
    linkedProjectIds: habit?.linkedProjectIds ?? [],
    linkedTaskIds: habit?.linkedTaskIds ?? [],
    linkedValueIds: habit?.linkedValueIds ?? [],
    linkedPatternIds: habit?.linkedPatternIds ?? [],
    linkedBehaviorIds: habit?.linkedBehaviorIds ?? [],
    linkedBeliefIds: habit?.linkedBeliefIds ?? [],
    linkedModeIds: habit?.linkedModeIds ?? [],
    linkedReportIds: habit?.linkedReportIds ?? [],
    linkedBehaviorId: habit?.linkedBehaviorId ?? null,
    linkedBehaviorTitle: habit?.linkedBehaviorTitle ?? null,
    linkedBehaviorTitles: habit?.linkedBehaviorTitles ?? [],
    rewardXp: habit?.rewardXp ?? 12,
    penaltyXp: habit?.penaltyXp ?? 8,
    generatedHealthEventTemplate: habit?.generatedHealthEventTemplate ?? {
      enabled: false,
      workoutType: "",
      title: "",
      durationMinutes: 60,
      xpReward: 0,
      tags: [],
      links: [],
      notesTemplate: ""
    },
    createdAt: habit?.createdAt ?? new Date(0).toISOString(),
    updatedAt: habit?.updatedAt ?? new Date(0).toISOString(),
    lastCheckInAt: habit?.lastCheckInAt ?? null,
    lastCheckInStatus: habit?.lastCheckInStatus ?? null,
    streakCount: habit?.streakCount ?? 0,
    completionRate: habit?.completionRate ?? 0,
    dueToday: habit?.dueToday ?? false,
    userId: habit?.userId ?? null,
    user: (habit?.user as UserSummary | null | undefined) ?? null,
    checkIns: habit?.checkIns ?? []
  };
}

function normalizeUser(user: Partial<UserSummary> | undefined): UserSummary {
  return {
    id: user?.id ?? "",
    kind: user?.kind ?? "human",
    handle: user?.handle ?? "",
    displayName: user?.displayName ?? "",
    description: user?.description ?? "",
    accentColor: user?.accentColor ?? "#c0c1ff",
    createdAt: user?.createdAt ?? new Date(0).toISOString(),
    updatedAt: user?.updatedAt ?? new Date(0).toISOString()
  };
}

function normalizeStrategy(strategy: Partial<Strategy> | undefined): Strategy {
  return {
    id: strategy?.id ?? "",
    title: strategy?.title ?? "",
    overview: strategy?.overview ?? "",
    endStateDescription: strategy?.endStateDescription ?? "",
    status:
      strategy?.status === "paused" || strategy?.status === "completed"
        ? strategy.status
        : "active",
    targetGoalIds: strategy?.targetGoalIds ?? [],
    targetProjectIds: strategy?.targetProjectIds ?? [],
    linkedEntities: strategy?.linkedEntities ?? [],
    graph: strategy?.graph ?? { nodes: [], edges: [] },
    metrics: strategy?.metrics ?? {
      alignmentScore: 0,
      planCoverageScore: 0,
      sequencingScore: 100,
      scopeDisciplineScore: 100,
      qualityScore: 0,
      targetProgressScore: 0,
      completedNodeCount: 0,
      startedNodeCount: 0,
      readyNodeCount: 0,
      totalNodeCount: 1,
      completedTargetCount: 0,
      totalTargetCount: 0,
      offPlanEntityCount: 0,
      offPlanActiveEntityCount: 0,
      offPlanCompletedEntityCount: 0,
      activeNodeIds: [],
      nextNodeIds: [],
      blockedNodeIds: [],
      outOfOrderNodeIds: []
    },
    isLocked: strategy?.isLocked ?? false,
    lockedAt: strategy?.lockedAt ?? null,
    lockedByUserId: strategy?.lockedByUserId ?? null,
    lockedByUser:
      (strategy?.lockedByUser as UserSummary | null | undefined) ?? null,
    createdAt: strategy?.createdAt ?? new Date(0).toISOString(),
    updatedAt: strategy?.updatedAt ?? new Date(0).toISOString(),
    userId: strategy?.userId ?? null,
    user: (strategy?.user as UserSummary | null | undefined) ?? null
  };
}

export function normalizeForgeSnapshot(
  raw: ForgeSnapshot | LegacySnapshot
): ForgeSnapshot {
  const legacy = raw as LegacySnapshot;
  const rootProjects = (legacy.projects ?? legacy.campaigns ?? []).map(
    normalizeProject
  );
  const dashboardProjects = (
    legacy.dashboard?.projects ??
    legacy.dashboard?.campaigns ??
    rootProjects
  ).map(normalizeProject);
  const overviewProjects = (
    legacy.overview?.projects ??
    legacy.overview?.campaigns ??
    dashboardProjects
  ).map(normalizeProject);

  return {
    ...raw,
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: raw.meta?.generatedAt ?? new Date().toISOString(),
      backend: raw.meta?.backend ?? "forge-node-runtime",
      mode: raw.meta?.mode ?? "transitional-node"
    },
    metrics: {
      totalXp: raw.metrics?.totalXp ?? 0,
      level: raw.metrics?.level ?? 1,
      currentLevelXp: raw.metrics?.currentLevelXp ?? 0,
      nextLevelXp: raw.metrics?.nextLevelXp ?? 120,
      weeklyXp: raw.metrics?.weeklyXp ?? 0,
      streakDays: raw.metrics?.streakDays ?? 0,
      comboMultiplier: raw.metrics?.comboMultiplier ?? 1,
      momentumScore: raw.metrics?.momentumScore ?? 0,
      topGoalId: raw.metrics?.topGoalId ?? null,
      topGoalTitle: raw.metrics?.topGoalTitle ?? null
    },
    users: (raw.users ?? []).map(normalizeUser),
    strategies: (raw.strategies ?? []).map(normalizeStrategy),
    userScope: {
      selectedUserIds: raw.userScope?.selectedUserIds ?? [],
      selectedUsers: (raw.userScope?.selectedUsers ?? []).map(normalizeUser)
    },
    dashboard: {
      stats: {
        totalPoints: raw.dashboard?.stats?.totalPoints ?? 0,
        completedThisWeek: raw.dashboard?.stats?.completedThisWeek ?? 0,
        activeGoals: raw.dashboard?.stats?.activeGoals ?? 0,
        alignmentScore: raw.dashboard?.stats?.alignmentScore ?? 0,
        focusTasks: raw.dashboard?.stats?.focusTasks ?? 0,
        overdueTasks: raw.dashboard?.stats?.overdueTasks ?? 0,
        dueThisWeek: raw.dashboard?.stats?.dueThisWeek ?? 0
      },
      goals: (raw.dashboard?.goals ?? []).map((goal) => ({
        ...goal,
        ...normalizeGoal(goal)
      })),
      projects: dashboardProjects,
      tasks: (raw.dashboard?.tasks ?? []).map(normalizeTask),
      habits: (raw.dashboard?.habits ?? raw.habits ?? []).map(normalizeHabit),
      tags: (raw.dashboard?.tags ?? []).map(normalizeTag),
      suggestedTags: (raw.dashboard?.suggestedTags ?? []).map(normalizeTag),
      owners: raw.dashboard?.owners ?? [],
      executionBuckets: (raw.dashboard?.executionBuckets ?? []).map(
        (bucket) => ({
          ...bucket,
          tasks: (bucket.tasks ?? []).map(normalizeTask)
        })
      ),
      gamification: raw.dashboard?.gamification ?? {
        totalXp: raw.metrics?.totalXp ?? 0,
        level: raw.metrics?.level ?? 1,
        currentLevelXp: raw.metrics?.currentLevelXp ?? 0,
        nextLevelXp: raw.metrics?.nextLevelXp ?? 120,
        weeklyXp: raw.metrics?.weeklyXp ?? 0,
        streakDays: raw.metrics?.streakDays ?? 0,
        comboMultiplier: raw.metrics?.comboMultiplier ?? 1,
        momentumScore: raw.metrics?.momentumScore ?? 0,
        topGoalId: raw.metrics?.topGoalId ?? null,
        topGoalTitle: raw.metrics?.topGoalTitle ?? null
      },
      achievements: raw.dashboard?.achievements ?? [],
      milestoneRewards: raw.dashboard?.milestoneRewards ?? [],
      recentActivity: raw.dashboard?.recentActivity ?? [],
      notesSummaryByEntity: raw.dashboard?.notesSummaryByEntity ?? {}
    },
    overview: {
      generatedAt: raw.overview?.generatedAt ?? new Date().toISOString(),
      strategicHeader: {
        streakDays:
          raw.overview?.strategicHeader?.streakDays ??
          raw.metrics?.streakDays ??
          0,
        level: raw.overview?.strategicHeader?.level ?? raw.metrics?.level ?? 1,
        totalXp:
          raw.overview?.strategicHeader?.totalXp ?? raw.metrics?.totalXp ?? 0,
        currentLevelXp:
          raw.overview?.strategicHeader?.currentLevelXp ??
          raw.metrics?.currentLevelXp ??
          0,
        nextLevelXp:
          raw.overview?.strategicHeader?.nextLevelXp ??
          raw.metrics?.nextLevelXp ??
          120,
        momentumScore:
          raw.overview?.strategicHeader?.momentumScore ??
          raw.metrics?.momentumScore ??
          0,
        focusTasks: raw.overview?.strategicHeader?.focusTasks ?? 0,
        overdueTasks: raw.overview?.strategicHeader?.overdueTasks ?? 0
      },
      projects: overviewProjects,
      activeGoals: (raw.overview?.activeGoals ?? []).map((goal) => ({
        ...goal,
        ...normalizeGoal(goal)
      })),
      topTasks: (raw.overview?.topTasks ?? []).map(normalizeTask),
      dueHabits: (
        raw.overview?.dueHabits ??
        raw.today?.dueHabits ??
        raw.dashboard?.habits ??
        []
      ).map(normalizeHabit),
      recentEvidence: raw.overview?.recentEvidence ?? [],
      achievements: raw.overview?.achievements ?? [],
      domainBalance: raw.overview?.domainBalance ?? [],
      neglectedGoals: raw.overview?.neglectedGoals ?? []
    },
    today: {
      generatedAt: raw.today?.generatedAt ?? new Date().toISOString(),
      directive: {
        task: raw.today?.directive?.task
          ? normalizeTask(raw.today.directive.task)
          : null,
        goalTitle: raw.today?.directive?.goalTitle ?? null,
        rewardXp: raw.today?.directive?.rewardXp ?? 0,
        sessionLabel: raw.today?.directive?.sessionLabel ?? "No active session"
      },
      timeline: (raw.today?.timeline ?? []).map((bucket) => ({
        ...bucket,
        tasks: (bucket.tasks ?? []).map(normalizeTask)
      })),
      dueHabits: (
        raw.today?.dueHabits ??
        raw.overview?.dueHabits ??
        raw.dashboard?.habits ??
        []
      ).map(normalizeHabit),
      dailyQuests: raw.today?.dailyQuests ?? [],
      milestoneRewards: raw.today?.milestoneRewards ?? [],
      recentHabitRewards: raw.today?.recentHabitRewards ?? [],
      momentum: {
        streakDays: raw.today?.momentum?.streakDays ?? 0,
        momentumScore: raw.today?.momentum?.momentumScore ?? 0,
        recoveryHint: raw.today?.momentum?.recoveryHint ?? ""
      }
    },
    risk: {
      generatedAt: raw.risk?.generatedAt ?? new Date().toISOString(),
      overdueTasks: (raw.risk?.overdueTasks ?? []).map(normalizeTask),
      blockedTasks: (raw.risk?.blockedTasks ?? []).map(normalizeTask),
      neglectedGoals: raw.risk?.neglectedGoals ?? [],
      summary: raw.risk?.summary ?? ""
    },
    goals: (raw.goals ?? []).map(normalizeGoal),
    projects: rootProjects,
    tags: (raw.tags ?? []).map(normalizeTag),
    tasks: (raw.tasks ?? []).map(normalizeTask),
    habits: (raw.habits ?? raw.dashboard?.habits ?? []).map(normalizeHabit),
    activity: raw.activity ?? [],
    activeTaskRuns: raw.activeTaskRuns ?? [],
    lifeForce: raw.lifeForce ?? {
      userId: "",
      dateKey: new Date().toISOString().slice(0, 10),
      baselineDailyAp: 200,
      dailyBudgetAp: 200,
      spentTodayAp: 0,
      remainingAp: 200,
      forecastAp: 0,
      plannedRemainingAp: 0,
      targetBandMinAp: 170,
      targetBandMaxAp: 200,
      instantCapacityApPerHour: 0,
      instantFreeApPerHour: 0,
      overloadApPerHour: 0,
      currentDrainApPerHour: 0,
      fatigueBufferApPerHour: 0,
      sleepRecoveryMultiplier: 1,
      readinessMultiplier: 1,
      fatigueDebtCarry: 0,
      stats: [],
      currentCurve: [],
      activeDrains: [],
      plannedDrains: [],
      warnings: [],
      recommendations: [],
      topTaskIdsNeedingSplit: [],
      updatedAt: new Date(0).toISOString()
    }
  };
}
