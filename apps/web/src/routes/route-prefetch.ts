const routeModules = {
  activity: () => import("@/pages/activity-page"),
  attention: () => import("@/pages/attention-inbox-page"),
  artifacts: () => import("@/pages/artifacts-page"),
  calendar: () => import("@/pages/calendar-page"),
  comparison: () => import("@/pages/comparison-page"),
  companionLab: () => import("@/pages/companion-sync-lab-page"),
  concepts: () => import("@/pages/concepts-page"),
  conceptDetail: () => import("@/pages/concept-detail-page"),
  courses: () => import("@/pages/courses-page"),
  courseDetail: () => import("@/pages/course-detail-page"),
  courseLearn: () => import("@/pages/course-learn-page"),
  goalDetail: () => import("@/pages/goal-detail-page"),
  goals: () => import("@/pages/goals-page"),
  habits: () => import("@/pages/habits-page"),
  insights: () => import("@/pages/insights-page"),
  kanban: () => import("@/pages/kanban-page"),
  knowledgeGraph: () => import("@/pages/knowledge-graph-page"),
  lifeEvents: () => import("@/pages/life-events-page"),
  lifeForce: () => import("@/pages/life-force-page"),
  movement: () => import("@/pages/movement-page"),
  messages: () => import("@/pages/agent-messages-page"),
  notes: () => import("@/pages/notes-page"),
  overview: () => import("@/pages/overview-page"),
  people: () => import("@/pages/people-page"),
  personDetail: () => import("@/pages/person-detail-page"),
  preferences: () => import("@/pages/preferences-page"),
  projectDetail: () => import("@/pages/project-detail-page"),
  projectHierarchy: () => import("@/pages/project-management-hierarchy-page"),
  projects: () => import("@/pages/projects-page"),
  psyche: () => import("@/pages/psyche-page"),
  psycheBehaviors: () => import("@/pages/psyche-behaviors-page"),
  psycheFlashcards: () => import("@/pages/psyche-flashcards-page"),
  psycheGoalMap: () => import("@/pages/psyche-goal-map-page"),
  psycheMetrics: () => import("@/pages/psyche-metrics-page"),
  psycheModeGuide: () => import("@/pages/psyche-mode-guide-page"),
  psycheModes: () => import("@/pages/psyche-modes-page"),
  psychePatterns: () => import("@/pages/psyche-patterns-page"),
  psycheQuestionnaireBuilder: () =>
    import("@/pages/psyche-questionnaire-builder-page"),
  psycheQuestionnaireDetail: () =>
    import("@/pages/psyche-questionnaire-detail-page"),
  psycheQuestionnaireRun: () => import("@/pages/psyche-questionnaire-run-page"),
  psycheQuestionnaireRunDetail: () =>
    import("@/pages/psyche-questionnaire-run-detail-page"),
  psycheQuestionnaires: () => import("@/pages/psyche-questionnaires-page"),
  psycheReportDetail: () => import("@/pages/psyche-report-detail-page"),
  psycheReports: () => import("@/pages/psyche-reports-page"),
  psycheSchemasBeliefs: () => import("@/pages/psyche-schemas-beliefs-page"),
  psycheScreenTime: () => import("@/pages/psyche-screen-time-page"),
  psycheSelfObservation: () => import("@/pages/psyche-self-observation-page"),
  psycheValues: () => import("@/pages/psyche-values-page"),
  rewards: () => import("@/pages/rewards-page"),
  settings: () => import("@/pages/settings-page"),
  settingsAgents: () => import("@/pages/settings-agents-page"),
  settingsBin: () => import("@/pages/settings-bin-page"),
  settingsCalendar: () => import("@/pages/settings-calendar-page"),
  settingsData: () => import("@/pages/settings-data-page"),
  settingsLogs: () => import("@/pages/settings-logs-page"),
  settingsMobile: () => import("@/pages/settings-mobile-page"),
  settingsModels: () => import("@/pages/settings-models-page"),
  settingsRewards: () => import("@/pages/settings-rewards-page"),
  settingsUsers: () => import("@/pages/settings-users-page"),
  settingsWiki: () => import("@/pages/settings-wiki-page"),
  sleep: () => import("@/pages/sleep-page"),
  sports: () => import("@/pages/sports-page"),
  strategyDetail: () => import("@/pages/strategy-detail-page"),
  strategies: () => import("@/pages/strategies-page"),
  taskDetail: () => import("@/pages/task-detail-page"),
  today: () => import("@/pages/today-page"),
  trainingLoad: () => import("@/pages/training-load-page"),
  vitals: () => import("@/pages/vitals-page"),
  weeklyReview: () => import("@/pages/weekly-review-page"),
  weightLoss: () => import("@/pages/weight-loss-page"),
  wiki: () => import("@/pages/wiki-page"),
  wikiEditor: () => import("@/pages/wiki-editor-page"),
  wikiIngestHistory: () => import("@/pages/wiki-ingest-history-page"),
  workbench: () => import("@/pages/workbench-page"),
  workbenchFlow: () => import("@/pages/workbench-flow-page"),
  workoutDetail: () => import("@/pages/workout-detail-page")
} as const;

export type RouteModuleKey = keyof typeof routeModules;

const routeMatchers: Array<[RegExp, RouteModuleKey]> = [
  [/^\/compare\/?$/, "comparison"],
  [/^\/courses\/[^/]+\/learn\/?$/, "courseLearn"],
  [/^\/courses\/[^/]+\/?$/, "courseDetail"],
  [/^\/courses\/?$/, "courses"],
  [/^\/concepts\/[^/]+\/?$/, "conceptDetail"],
  [/^\/concepts\/?$/, "concepts"],
  [/^\/projects\/hierarchy\/?$/, "projectHierarchy"],
  [/^\/projects\/[^/]+\/?$/, "projectDetail"],
  [/^\/projects\/?$/, "projects"],
  [/^\/goals\/[^/]+\/?$/, "goalDetail"],
  [/^\/goals\/?$/, "goals"],
  [/^\/strategies\/[^/]+\/?$/, "strategyDetail"],
  [/^\/strategies\/?$/, "strategies"],
  [/^\/people\/[^/]+\/?$/, "personDetail"],
  [/^\/people\/?$/, "people"],
  [/^\/artifacts(?:\/[^/]+)?\/?$/, "artifacts"],
  [/^\/sports\/workouts\/[^/]+\/?$/, "workoutDetail"],
  [/^\/sports\/?$/, "sports"],
  [/^\/psyche\/questionnaires\/new\/?$/, "psycheQuestionnaireBuilder"],
  [/^\/psyche\/questionnaires\/[^/]+\/edit\/?$/, "psycheQuestionnaireBuilder"],
  [/^\/psyche\/questionnaires\/[^/]+\/take\/?$/, "psycheQuestionnaireRun"],
  [/^\/psyche\/questionnaires\/[^/]+\/?$/, "psycheQuestionnaireDetail"],
  [/^\/psyche\/questionnaires\/?$/, "psycheQuestionnaires"],
  [/^\/psyche\/questionnaire-runs\/[^/]+\/?$/, "psycheQuestionnaireRunDetail"],
  [/^\/psyche\/reports\/[^/]+\/?$/, "psycheReportDetail"],
  [/^\/psyche\/reports\/?$/, "psycheReports"],
  [/^\/psyche\/modes\/guide\/?$/, "psycheModeGuide"],
  [/^\/psyche\/modes\/?$/, "psycheModes"],
  [/^\/psyche\/metrics\/?$/, "psycheMetrics"],
  [/^\/psyche\/flashcards\/?$/, "psycheFlashcards"],
  [/^\/psyche\/values\/?$/, "psycheValues"],
  [/^\/psyche\/patterns\/?$/, "psychePatterns"],
  [/^\/psyche\/self-observation\/?$/, "psycheSelfObservation"],
  [/^\/psyche\/screen-time\/?$/, "psycheScreenTime"],
  [/^\/psyche\/behaviors\/?$/, "psycheBehaviors"],
  [/^\/psyche\/goal-map\/?$/, "psycheGoalMap"],
  [/^\/psyche\/schemas-beliefs\/?$/, "psycheSchemasBeliefs"],
  [/^\/psyche\/?$/, "psyche"],
  [/^\/wiki\/ingest-history\/?$/, "wikiIngestHistory"],
  [/^\/wiki\/(?:new|edit\/[^/]+)\/?$/, "wikiEditor"],
  [/^\/wiki(?:\/page\/[^/]+)?\/?$/, "wiki"],
  [/^\/workbench\/[^/]+\/?$/, "workbenchFlow"],
  [/^\/workbench\/?$/, "workbench"],
  [/^\/settings\/mobile\/lab\/?$/, "companionLab"],
  [/^\/settings\/agents\/?$/, "settingsAgents"],
  [/^\/settings\/bin\/?$/, "settingsBin"],
  [/^\/settings\/calendar\/?$/, "settingsCalendar"],
  [/^\/settings\/data\/?$/, "settingsData"],
  [/^\/settings\/logs\/?$/, "settingsLogs"],
  [/^\/settings\/mobile\/?$/, "settingsMobile"],
  [/^\/settings\/models\/?$/, "settingsModels"],
  [/^\/settings\/rewards\/?$/, "settingsRewards"],
  [/^\/settings\/users\/?$/, "settingsUsers"],
  [/^\/settings\/wiki\/?$/, "settingsWiki"],
  [/^\/settings\/?$/, "settings"],
  [/^\/tasks\/[^/]+\/?$/, "taskDetail"],
  [/^\/overview\/?$/, "overview"],
  [/^\/messages(?:\/[^/]+)?\/?$/, "messages"],
  [/^\/attention\/?$/, "attention"],
  [/^\/life-force\/?$/, "lifeForce"],
  [/^\/habits\/?$/, "habits"],
  [/^\/preferences\/?$/, "preferences"],
  [/^\/calendar\/?$/, "calendar"],
  [/^\/life-events\/?$/, "lifeEvents"],
  [/^\/knowledge-graph\/?$/, "knowledgeGraph"],
  [/^\/movement\/?$/, "movement"],
  [/^\/sleep\/?$/, "sleep"],
  [/^\/training-load\/?$/, "trainingLoad"],
  [/^\/vitals\/?$/, "vitals"],
  [/^\/weight-loss\/?$/, "weightLoss"],
  [/^\/kanban\/?$/, "kanban"],
  [/^\/today\/?$/, "today"],
  [/^\/rewards\/?$/, "rewards"],
  [/^\/notes\/?$/, "notes"],
  [/^\/activity\/?$/, "activity"],
  [/^\/insights\/?$/, "insights"],
  [/^\/review\/weekly\/?$/, "weeklyReview"]
];

const prefetchedRoutes = new Map<RouteModuleKey, Promise<unknown>>();

function normalizePathname(to: string) {
  const path = to.split(/[?#]/, 1)[0] || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

export function resolveRouteModuleKey(to: string): RouteModuleKey | null {
  const pathname = normalizePathname(to);
  return routeMatchers.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function prefetchRouteModule(to: string): Promise<unknown> | null {
  const key = resolveRouteModuleKey(to);
  if (!key) {
    return null;
  }
  const existing = prefetchedRoutes.get(key);
  if (existing) {
    return existing;
  }
  const request = routeModules[key]().catch(() => {
    prefetchedRoutes.delete(key);
    return null;
  });
  prefetchedRoutes.set(key, request);
  return request;
}
