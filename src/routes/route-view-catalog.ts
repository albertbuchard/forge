export type RouteViewTone =
  | "core"
  | "execution"
  | "health"
  | "knowledge"
  | "psyche"
  | "settings";

export type RouteViewSkeleton = {
  blocks?: number;
  columns?: 1 | 2 | 3;
  header?: boolean;
  sideRail?: boolean;
};

export type RouteViewMeta = {
  surfaceId: string;
  title: string;
  description: string;
  tone: RouteViewTone;
  skeleton?: RouteViewSkeleton;
};

type RouteViewPathMatcher = {
  viewId: RouteViewId;
  match: (pathname: string) => boolean;
};

export const ROUTE_VIEW_CATALOG = {
  overview: {
    surfaceId: "overview",
    title: "Overview",
    description: "Daily signal, momentum, and current Forge state.",
    tone: "core",
    skeleton: { blocks: 5, columns: 3, sideRail: true }
  },
  "life-force-index": {
    surfaceId: "life-force-index",
    title: "Life Force",
    description: "Action Point capacity, weekday curves, and dynamic drains.",
    tone: "core",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "goals-index": {
    surfaceId: "goals-index",
    title: "Goals",
    description: "Goal planning and long-horizon direction.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "habits-index": {
    surfaceId: "habits-index",
    title: "Habits",
    description: "Recurring commitments, streaks, and check-ins.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "goal-detail": {
    surfaceId: "goal-detail",
    title: "Goal detail",
    description: "Goal detail, progress, and linked execution context.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "projects-index": {
    surfaceId: "projects-index",
    title: "Projects",
    description: "PRD-backed projects and execution initiatives.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "project-hierarchy": {
    surfaceId: "project-hierarchy",
    title: "Project hierarchy",
    description: "Full hierarchy from goals down to subtasks.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "project-detail": {
    surfaceId: "project-detail",
    title: "Project detail",
    description: "Project detail, tasks, and execution health.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "strategies-index": {
    surfaceId: "strategies-index",
    title: "Strategies",
    description: "Strategy graphs and long-range execution plans.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "strategy-detail": {
    surfaceId: "strategy-detail",
    title: "Strategy detail",
    description: "Strategy DAG detail, targets, and progress.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "preferences-index": {
    surfaceId: "preferences-index",
    title: "Preferences",
    description: "Preference profiles, pairwise judgments, and model state.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "calendar-index": {
    surfaceId: "calendar-index",
    title: "Calendar",
    description: "Calendar planning, timeboxes, and provider sync.",
    tone: "core",
    skeleton: { blocks: 6, columns: 3, sideRail: false }
  },
  "knowledge-graph-index": {
    surfaceId: "knowledge-graph-index",
    title: "Knowledge Graph",
    description: "One connected map of Forge entities and relationships.",
    tone: "knowledge",
    skeleton: { blocks: 4, columns: 2, sideRail: true }
  },
  "movement-index": {
    surfaceId: "movement-index",
    title: "Movement",
    description: "Movement traces, places, and trip evidence.",
    tone: "health",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "sleep-index": {
    surfaceId: "sleep-index",
    title: "Sleep",
    description: "Sleep sessions, health context, and recovery trends.",
    tone: "health",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "sports-index": {
    surfaceId: "sports-index",
    title: "Sports",
    description: "Fitness, workouts, and sports context.",
    tone: "health",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "sports-workout-detail": {
    surfaceId: "sports-workout-detail",
    title: "Workout detail",
    description: "Raw workout evidence, heart-rate zones, and session context.",
    tone: "health",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "training-load-index": {
    surfaceId: "training-load-index",
    title: "Training Load",
    description: "Cardiovascular load, intensity distribution, and targets.",
    tone: "health",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "vitals-index": {
    surfaceId: "vitals-index",
    title: "Vitals",
    description: "Body signals, recovery, cardio fitness, and daily metrics.",
    tone: "health",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "psyche-index": {
    surfaceId: "psyche-index",
    title: "Psyche",
    description: "Values, modes, reports, and reflective context.",
    tone: "psyche",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "psyche-metrics": {
    surfaceId: "psyche-metrics",
    title: "Psyche metrics",
    description: "Daily Psyche metric history with plots and statistics.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 3, sideRail: true }
  },
  "psyche-flashcards": {
    surfaceId: "psyche-flashcards",
    title: "Psyche flashcards",
    description: "Therapeutic reminder cards for urges and triggers.",
    tone: "psyche",
    skeleton: { blocks: 6, columns: 3, sideRail: false }
  },
  "psyche-values": {
    surfaceId: "psyche-values",
    title: "Psyche values",
    description: "Values and linked goal context.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-patterns": {
    surfaceId: "psyche-patterns",
    title: "Psyche patterns",
    description: "Behavior patterns and recurring loops.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-questionnaires": {
    surfaceId: "psyche-questionnaires",
    title: "Questionnaires",
    description: "Questionnaire library and recent runs.",
    tone: "psyche",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "psyche-questionnaire-new": {
    surfaceId: "psyche-questionnaire-new",
    title: "New questionnaire",
    description: "Questionnaire builder workspace.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: false }
  },
  "psyche-questionnaire-detail": {
    surfaceId: "psyche-questionnaire-detail",
    title: "Questionnaire detail",
    description: "Questionnaire detail and scores.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-questionnaire-edit": {
    surfaceId: "psyche-questionnaire-edit",
    title: "Edit questionnaire",
    description: "Questionnaire builder workspace.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: false }
  },
  "psyche-questionnaire-run": {
    surfaceId: "psyche-questionnaire-run",
    title: "Take questionnaire",
    description: "Questionnaire runner and answers.",
    tone: "psyche",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "psyche-questionnaire-run-detail": {
    surfaceId: "psyche-questionnaire-run-detail",
    title: "Questionnaire run detail",
    description: "Questionnaire result review.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-self-observation": {
    surfaceId: "psyche-self-observation",
    title: "Self observation",
    description: "Self-observation notes and reflective tracking.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-screen-time": {
    surfaceId: "psyche-screen-time",
    title: "Screen Time",
    description: "Device-activity patterns and reflective usage history.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-behaviors": {
    surfaceId: "psyche-behaviors",
    title: "Behaviors",
    description: "Behavior records and linked evidence.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-reports": {
    surfaceId: "psyche-reports",
    title: "Reports",
    description: "Trigger and reflective report review.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-report-detail": {
    surfaceId: "psyche-report-detail",
    title: "Report detail",
    description: "Detailed reflective report view.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-goal-map": {
    surfaceId: "psyche-goal-map",
    title: "Goal map",
    description: "Goal-to-values relationship map.",
    tone: "psyche",
    skeleton: { blocks: 4, columns: 2, sideRail: true }
  },
  "psyche-schemas-beliefs": {
    surfaceId: "psyche-schemas-beliefs",
    title: "Schemas and beliefs",
    description: "Beliefs, schemas, and linked patterns.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-modes": {
    surfaceId: "psyche-modes",
    title: "Modes",
    description: "Mode profiles and guides.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-mode-guide": {
    surfaceId: "psyche-mode-guide",
    title: "Mode guide",
    description: "Guided mode session flow.",
    tone: "psyche",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "kanban-index": {
    surfaceId: "kanban-index",
    title: "Kanban",
    description: "Task board execution surface.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 3, sideRail: false }
  },
  "notes-index": {
    surfaceId: "notes-index",
    title: "Notes",
    description: "Notes, evidence, and writing surfaces.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "wiki-index": {
    surfaceId: "wiki-index",
    title: "KarpaWiki",
    description: "KarpaWiki search and page navigation.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "wiki-ingest-history": {
    surfaceId: "wiki-ingest-history",
    title: "KarpaWiki ingest history",
    description: "Ingest jobs and processing history.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "wiki-page-detail": {
    surfaceId: "wiki-page-detail",
    title: "KarpaWiki page",
    description: "KarpaWiki page detail and backlinks.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "wiki-new": {
    surfaceId: "wiki-new",
    title: "New KarpaWiki page",
    description: "KarpaWiki editor for new pages.",
    tone: "knowledge",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "wiki-edit": {
    surfaceId: "wiki-edit",
    title: "Edit KarpaWiki page",
    description: "KarpaWiki editor for existing pages.",
    tone: "knowledge",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "today-index": {
    surfaceId: "today-index",
    title: "Today",
    description: "Current work, time, and daily runway.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  workbench: {
    surfaceId: "workbench",
    title: "Workbench",
    description: "Search, organize, and launch Forge flows.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "workbench-flow": {
    surfaceId: "workbench-flow",
    title: "Workbench flow",
    description: "Graph editor and runtime surface for a single flow.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: false }
  },
  "activity-index": {
    surfaceId: "activity-index",
    title: "Activity",
    description: "Activity log and event history.",
    tone: "core",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "insights-index": {
    surfaceId: "insights-index",
    title: "Insights",
    description: "Insight review and decisions.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "weekly-review": {
    surfaceId: "weekly-review",
    title: "Weekly review",
    description: "Weekly review workflow and closeout.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-index": {
    surfaceId: "settings-index",
    title: "Settings",
    description: "Operator settings and runtime configuration.",
    tone: "settings",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "settings-data": {
    surfaceId: "settings-data",
    title: "Settings data",
    description: "Runtime storage, backups, exports, and recovery.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-users": {
    surfaceId: "settings-users",
    title: "Settings users",
    description: "User directory and ownership settings.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-calendar": {
    surfaceId: "settings-calendar",
    title: "Settings calendar",
    description: "Calendar provider settings and sync.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-mobile": {
    surfaceId: "settings-mobile",
    title: "Settings mobile",
    description: "Mobile companion settings and pairing.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-mobile-lab": {
    surfaceId: "settings-mobile-lab",
    title: "Companion sync lab",
    description: "Dev-only source-state and movement gap QA fixtures.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-models": {
    surfaceId: "settings-models",
    title: "Settings models",
    description: "Model connections and defaults.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-agents": {
    surfaceId: "settings-agents",
    title: "Settings agents",
    description: "Agent tokens and runtime access.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-rewards": {
    surfaceId: "settings-rewards",
    title: "Settings rewards",
    description: "Rewards and XP rule settings.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  rewards: {
    surfaceId: "rewards",
    title: "Trophy Hall",
    description: "Trophies, unlocks, streak pressure, and progression.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "settings-wiki": {
    surfaceId: "settings-wiki",
    title: "KarpaWiki settings",
    description: "KarpaWiki ingestion and profile settings.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-logs": {
    surfaceId: "settings-logs",
    title: "Settings logs",
    description: "Diagnostics and event logs.",
    tone: "settings",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "settings-bin": {
    surfaceId: "settings-bin",
    title: "Settings bin",
    description: "Deleted entity recovery.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "task-detail": {
    surfaceId: "task-detail",
    title: "Task detail",
    description: "Task detail, timer, and notes.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  }
} satisfies Record<string, RouteViewMeta>;

export type RouteViewId = keyof typeof ROUTE_VIEW_CATALOG;

export const ROUTE_VIEW_IDS = Object.keys(ROUTE_VIEW_CATALOG) as RouteViewId[];

function normalizeRoutePathname(pathname: string) {
  const withoutBase = pathname.startsWith("/forge/")
    ? pathname.slice("/forge".length)
    : pathname === "/forge"
      ? "/"
      : pathname;
  const normalized = withoutBase.startsWith("/")
    ? withoutBase
    : `/${withoutBase}`;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function exactly(...paths: string[]) {
  const normalizedPaths = new Set(paths.map(normalizeRoutePathname));
  return (pathname: string) => normalizedPaths.has(pathname);
}

function startsWithSegment(prefix: string) {
  const normalizedPrefix = normalizeRoutePathname(prefix);
  return (pathname: string) =>
    pathname === normalizedPrefix ||
    pathname.startsWith(`${normalizedPrefix}/`);
}

function matches(pattern: RegExp) {
  return (pathname: string) => pattern.test(pathname);
}

const ROUTE_VIEW_PATH_MATCHERS: RouteViewPathMatcher[] = [
  { viewId: "overview", match: exactly("/", "/overview") },
  { viewId: "life-force-index", match: exactly("/life-force") },
  { viewId: "goals-index", match: exactly("/goals") },
  { viewId: "habits-index", match: exactly("/habits") },
  { viewId: "goal-detail", match: matches(/^\/goals\/[^/]+$/) },
  { viewId: "project-hierarchy", match: exactly("/projects/hierarchy") },
  { viewId: "projects-index", match: exactly("/projects") },
  { viewId: "project-detail", match: matches(/^\/projects\/[^/]+$/) },
  { viewId: "strategies-index", match: exactly("/strategies") },
  { viewId: "strategy-detail", match: matches(/^\/strategies\/[^/]+$/) },
  { viewId: "preferences-index", match: startsWithSegment("/preferences") },
  { viewId: "calendar-index", match: exactly("/calendar") },
  { viewId: "knowledge-graph-index", match: exactly("/knowledge-graph") },
  { viewId: "movement-index", match: exactly("/movement") },
  { viewId: "sleep-index", match: exactly("/sleep") },
  {
    viewId: "sports-workout-detail",
    match: matches(/^\/sports\/workouts\/[^/]+$/)
  },
  { viewId: "sports-index", match: exactly("/sports") },
  { viewId: "training-load-index", match: exactly("/training-load") },
  { viewId: "vitals-index", match: exactly("/vitals") },
  { viewId: "psyche-metrics", match: exactly("/psyche/metrics") },
  { viewId: "psyche-flashcards", match: exactly("/psyche/flashcards") },
  { viewId: "psyche-values", match: exactly("/psyche/values") },
  { viewId: "psyche-patterns", match: exactly("/psyche/patterns") },
  {
    viewId: "psyche-questionnaire-new",
    match: exactly("/psyche/questionnaires/new")
  },
  {
    viewId: "psyche-questionnaire-edit",
    match: matches(/^\/psyche\/questionnaires\/[^/]+\/edit$/)
  },
  {
    viewId: "psyche-questionnaire-run",
    match: matches(/^\/psyche\/questionnaires\/[^/]+\/take$/)
  },
  {
    viewId: "psyche-questionnaire-detail",
    match: matches(/^\/psyche\/questionnaires\/[^/]+$/)
  },
  {
    viewId: "psyche-questionnaires",
    match: exactly("/psyche/questionnaires")
  },
  {
    viewId: "psyche-questionnaire-run-detail",
    match: matches(/^\/psyche\/questionnaire-runs\/[^/]+$/)
  },
  {
    viewId: "psyche-self-observation",
    match: exactly("/psyche/self-observation")
  },
  { viewId: "psyche-screen-time", match: exactly("/psyche/screen-time") },
  { viewId: "psyche-behaviors", match: exactly("/psyche/behaviors") },
  {
    viewId: "psyche-report-detail",
    match: matches(/^\/psyche\/reports\/[^/]+$/)
  },
  { viewId: "psyche-reports", match: exactly("/psyche/reports") },
  { viewId: "psyche-goal-map", match: exactly("/psyche/goal-map") },
  {
    viewId: "psyche-schemas-beliefs",
    match: exactly("/psyche/schemas-beliefs")
  },
  { viewId: "psyche-mode-guide", match: exactly("/psyche/modes/guide") },
  { viewId: "psyche-modes", match: exactly("/psyche/modes") },
  { viewId: "psyche-index", match: exactly("/psyche") },
  { viewId: "kanban-index", match: exactly("/kanban") },
  { viewId: "notes-index", match: exactly("/notes") },
  { viewId: "wiki-ingest-history", match: exactly("/wiki/ingest-history") },
  { viewId: "wiki-page-detail", match: matches(/^\/wiki\/page\/[^/]+$/) },
  { viewId: "wiki-new", match: exactly("/wiki/new") },
  { viewId: "wiki-edit", match: matches(/^\/wiki\/edit\/[^/]+$/) },
  { viewId: "wiki-index", match: exactly("/wiki") },
  { viewId: "today-index", match: exactly("/today") },
  { viewId: "workbench-flow", match: matches(/^\/workbench\/[^/]+$/) },
  { viewId: "workbench", match: exactly("/workbench") },
  { viewId: "activity-index", match: exactly("/activity") },
  { viewId: "insights-index", match: exactly("/insights") },
  { viewId: "weekly-review", match: exactly("/review/weekly") },
  { viewId: "settings-data", match: exactly("/settings/data") },
  { viewId: "settings-users", match: exactly("/settings/users") },
  { viewId: "settings-calendar", match: exactly("/settings/calendar") },
  { viewId: "settings-mobile-lab", match: exactly("/settings/mobile/lab") },
  { viewId: "settings-mobile", match: exactly("/settings/mobile") },
  { viewId: "settings-models", match: exactly("/settings/models") },
  { viewId: "settings-agents", match: exactly("/settings/agents") },
  { viewId: "settings-rewards", match: exactly("/settings/rewards") },
  { viewId: "settings-wiki", match: exactly("/settings/wiki") },
  { viewId: "settings-logs", match: exactly("/settings/logs") },
  { viewId: "settings-bin", match: exactly("/settings/bin") },
  { viewId: "settings-index", match: exactly("/settings") },
  { viewId: "rewards", match: exactly("/rewards") },
  { viewId: "task-detail", match: matches(/^\/tasks\/[^/]+$/) }
];

export function resolveRouteViewIdFromPathname(pathname: string): RouteViewId {
  const normalized = normalizeRoutePathname(pathname);
  return (
    ROUTE_VIEW_PATH_MATCHERS.find((matcher) => matcher.match(normalized))
      ?.viewId ?? "overview"
  );
}
