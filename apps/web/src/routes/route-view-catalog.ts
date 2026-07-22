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
    description:
      "Review today’s priorities, active work, recent evidence, and overall Forge momentum.",
    tone: "core",
    skeleton: { blocks: 5, columns: 3, sideRail: true }
  },
  "courses-index": {
    surfaceId: "courses-index",
    title: "Courses",
    description:
      "Follow structured learning paths, submit written proofs, and review progress across courses.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "course-detail": {
    surfaceId: "course-detail",
    title: "Course detail",
    description:
      "Review a course syllabus, standing, concepts, and the next daily lesson.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "course-learn": {
    surfaceId: "course-learn",
    title: "Course lesson",
    description:
      "Learn a concept, write the mathematics, and receive evidence-based assessment.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 3, sideRail: true }
  },
  "concepts-index": {
    surfaceId: "concepts-index",
    title: "Concepts",
    description:
      "Browse durable concept entities with definitions, course links, mastery, and review schedules.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 3, sideRail: false }
  },
  "concept-detail": {
    surfaceId: "concept-detail",
    title: "Concept detail",
    description:
      "Inspect one concept's definition, dependencies, course appearances, and proof evidence.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "life-force-index": {
    surfaceId: "life-force-index",
    title: "Life Force",
    description:
      "Model daily Action Point capacity, weekday energy curves, drains, and recovery.",
    tone: "core",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "goals-index": {
    surfaceId: "goals-index",
    title: "Goals",
    description:
      "Define long-term directions and connect them to strategies, projects, and daily execution.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "habits-index": {
    surfaceId: "habits-index",
    title: "Habits",
    description:
      "Track recurring commitments, negative habits, streaks, missed days, and habit-linked evidence.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "goal-detail": {
    surfaceId: "goal-detail",
    title: "Goal detail",
    description:
      "Inspect one goal’s purpose, progress, linked projects, strategies, notes, and execution history.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "projects-index": {
    surfaceId: "projects-index",
    title: "Projects",
    description:
      "Manage PRD-backed initiatives and the work items that move them forward.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "project-hierarchy": {
    surfaceId: "project-hierarchy",
    title: "Project hierarchy",
    description:
      "Trace the execution ladder from goals through strategies, projects, issues, tasks, and subtasks.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "project-detail": {
    surfaceId: "project-detail",
    title: "Project detail",
    description:
      "Review one project’s PRD, linked hierarchy, board state, tasks, and delivery health.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "strategies-index": {
    surfaceId: "strategies-index",
    title: "Strategies",
    description:
      "Build strategy graphs that turn goals and projects into ordered execution paths.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "strategy-detail": {
    surfaceId: "strategy-detail",
    title: "Strategy detail",
    description:
      "Inspect one strategy’s graph, dependencies, target states, linked work, and progress.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "preferences-index": {
    surfaceId: "preferences-index",
    title: "Preferences",
    description:
      "Compare preferences, record tradeoffs, and inspect the evidence behind taste models.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "people-index": {
    surfaceId: "people-index",
    title: "People",
    description:
      "Review private Person records, explicit Wiki associations, peer relationships, shared projections, and pending requests.",
    tone: "core",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "calendar-index": {
    surfaceId: "calendar-index",
    title: "Calendar",
    description:
      "Plan timeboxes, manage calendar events, and sync provider calendars into Forge.",
    tone: "core",
    skeleton: { blocks: 6, columns: 3, sideRail: false }
  },
  "life-events-index": {
    surfaceId: "life-events-index",
    title: "Life Events",
    description:
      "Review important life events as a chronological timeline with travel, calendar, artifacts, and links.",
    tone: "core",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "knowledge-graph-index": {
    surfaceId: "knowledge-graph-index",
    title: "Knowledge Graph",
    description:
      "Explore Forge records as a connected graph of entities, links, clusters, and relationships.",
    tone: "knowledge",
    skeleton: { blocks: 4, columns: 2, sideRail: true }
  },
  "artifacts-index": {
    surfaceId: "artifacts-index",
    title: "Artifacts",
    description:
      "Store trusted files with precise metadata, safety scans, provenance, links, and human downloads.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "movement-index": {
    surfaceId: "movement-index",
    title: "Movement",
    description:
      "Review stays, trips, known places, gaps, and movement evidence captured from the phone.",
    tone: "health",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "sleep-index": {
    surfaceId: "sleep-index",
    title: "Sleep",
    description:
      "Inspect overnight sleep sessions, stages, recovery context, and trends by wake date.",
    tone: "health",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "sports-index": {
    surfaceId: "sports-index",
    title: "Sports",
    description:
      "Review workouts, routes, preserved HealthKit evidence, sport trends, and reflections.",
    tone: "health",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "sports-workout-detail": {
    surfaceId: "sports-workout-detail",
    title: "Workout detail",
    description:
      "Inspect one workout’s heart-rate timeline, route points, zones, events, and raw evidence.",
    tone: "health",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "training-load-index": {
    surfaceId: "training-load-index",
    title: "Training Load",
    description:
      "Track acute and chronic cardiovascular load, HR zones, intensity mix, and training targets.",
    tone: "health",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "vitals-index": {
    surfaceId: "vitals-index",
    title: "Vitals",
    description:
      "Review daily HealthKit body signals, recovery markers, cardio fitness, and metric trends.",
    tone: "health",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "weight-loss-index": {
    surfaceId: "weight-loss-index",
    title: "Weight Loss",
    description:
      "Track food, calorie balance, body composition, gut comfort, energy, and appearance experiments.",
    tone: "health",
    skeleton: { blocks: 7, columns: 3, sideRail: true }
  },
  "psyche-index": {
    surfaceId: "psyche-index",
    title: "Psyche",
    description:
      "Navigate Psyche records for values, modes, beliefs, reports, patterns, and self-observation.",
    tone: "psyche",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "psyche-metrics": {
    surfaceId: "psyche-metrics",
    title: "Psyche metrics",
    description:
      "Review tracked Psyche metrics such as mood, urges, self-regulation, and conversation-derived signals.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 3, sideRail: true }
  },
  "psyche-flashcards": {
    surfaceId: "psyche-flashcards",
    title: "Psyche flashcards",
    description:
      "Create and review therapeutic reminder cards used during urges, triggers, and value pivots.",
    tone: "psyche",
    skeleton: { blocks: 6, columns: 3, sideRail: false }
  },
  "psyche-values": {
    surfaceId: "psyche-values",
    title: "Psyche values",
    description:
      "Define valued directions and connect them to goals, behaviors, beliefs, and reports.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-patterns": {
    surfaceId: "psyche-patterns",
    title: "Psyche patterns",
    description:
      "Map recurring behavior loops, their payoffs, costs, triggers, and replacement moves.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-questionnaires": {
    surfaceId: "psyche-questionnaires",
    title: "Questionnaires",
    description:
      "Manage questionnaire templates, launch runs, and review recent answers and scores.",
    tone: "psyche",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "psyche-questionnaire-new": {
    surfaceId: "psyche-questionnaire-new",
    title: "New questionnaire",
    description:
      "Build a new questionnaire with sections, questions, scoring, and instructions.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: false }
  },
  "psyche-questionnaire-detail": {
    surfaceId: "psyche-questionnaire-detail",
    title: "Questionnaire detail",
    description:
      "Review a questionnaire’s structure, versions, previous runs, and computed scores.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-questionnaire-edit": {
    surfaceId: "psyche-questionnaire-edit",
    title: "Edit questionnaire",
    description:
      "Edit questionnaire sections, questions, scoring rules, and user instructions.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: false }
  },
  "psyche-questionnaire-run": {
    surfaceId: "psyche-questionnaire-run",
    title: "Take questionnaire",
    description:
      "Answer a questionnaire one prompt at a time and save the completed run.",
    tone: "psyche",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "psyche-questionnaire-run-detail": {
    surfaceId: "psyche-questionnaire-run-detail",
    title: "Questionnaire run detail",
    description:
      "Review a completed questionnaire run with raw answers, computed scores, and context.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-self-observation": {
    surfaceId: "psyche-self-observation",
    title: "Self observation",
    description:
      "Log dated observations about emotions, thoughts, triggers, body state, and context.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-screen-time": {
    surfaceId: "psyche-screen-time",
    title: "Screen Time",
    description:
      "Inspect device-use patterns and connect screen time to mood, attention, and routines.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-behaviors": {
    surfaceId: "psyche-behaviors",
    title: "Behaviors",
    description:
      "Describe concrete behaviors, urges, replacement moves, and the evidence linked to them.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-reports": {
    surfaceId: "psyche-reports",
    title: "Reports",
    description:
      "Review trigger reports and reflective chains across emotions, thoughts, behaviors, and modes.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-report-detail": {
    surfaceId: "psyche-report-detail",
    title: "Report detail",
    description:
      "Inspect one report’s event chain, emotions, thoughts, behaviors, modes, and linked records.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-goal-map": {
    surfaceId: "psyche-goal-map",
    title: "Goal map",
    description:
      "See how goals, values, behaviors, and Psyche records pull on each other.",
    tone: "psyche",
    skeleton: { blocks: 4, columns: 2, sideRail: true }
  },
  "psyche-schemas-beliefs": {
    surfaceId: "psyche-schemas-beliefs",
    title: "Schemas and beliefs",
    description:
      "Organize recurring schemas and the belief scripts that shape reactions under pressure.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-modes": {
    surfaceId: "psyche-modes",
    title: "Modes",
    description:
      "Manage mode profiles, their needs, risks, cues, and preferred responses.",
    tone: "psyche",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "psyche-mode-guide": {
    surfaceId: "psyche-mode-guide",
    title: "Mode guide",
    description:
      "Run a guided mode session to name the active part and choose the next response.",
    tone: "psyche",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "kanban-index": {
    surfaceId: "kanban-index",
    title: "Kanban",
    description:
      "Move projects, issues, tasks, and subtasks through execution lanes without losing hierarchy.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 3, sideRail: false }
  },
  "notes-index": {
    surfaceId: "notes-index",
    title: "Notes",
    description:
      "Create and search Markdown notes linked to Forge entities, dates, tags, and evidence.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "wiki-index": {
    surfaceId: "wiki-index",
    title: "KarpaWiki",
    description:
      "Search KarpaWiki pages, backlinks, entity links, and the SQLite-backed memory graph.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "wiki-ingest-history": {
    surfaceId: "wiki-ingest-history",
    title: "KarpaWiki ingest history",
    description:
      "Review KarpaWiki ingest jobs, source files, mapped entities, and processing outcomes.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "wiki-page-detail": {
    surfaceId: "wiki-page-detail",
    title: "KarpaWiki page",
    description:
      "Read one KarpaWiki page with backlinks, linked entities, citations, and related pages.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "wiki-new": {
    surfaceId: "wiki-new",
    title: "New KarpaWiki page",
    description:
      "Draft a new KarpaWiki page with Markdown, metadata, and entity links.",
    tone: "knowledge",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "wiki-edit": {
    surfaceId: "wiki-edit",
    title: "Edit KarpaWiki page",
    description:
      "Edit an existing KarpaWiki page while preserving links, metadata, and history.",
    tone: "knowledge",
    skeleton: { blocks: 4, columns: 1, sideRail: false }
  },
  "today-index": {
    surfaceId: "today-index",
    title: "Today",
    description:
      "Choose today’s next work, inspect time pressure, and keep active execution visible.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  workbench: {
    surfaceId: "workbench",
    title: "Workbench",
    description:
      "Search, organize, and launch graph-based Forge flows, AI tools, and published outputs.",
    tone: "knowledge",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "workbench-flow": {
    surfaceId: "workbench-flow",
    title: "Workbench flow",
    description:
      "Edit and run one Workbench flow with nodes, contracts, traces, and outputs.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: false }
  },
  "activity-index": {
    surfaceId: "activity-index",
    title: "Activity",
    description:
      "Review the audit trail of entity changes, sync events, task work, and system activity.",
    tone: "core",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "attention-index": {
    surfaceId: "attention-index",
    title: "Attention",
    description:
      "Review decisions, blocked work, unresolved syncs, and runtime problems in one bounded queue.",
    tone: "core",
    skeleton: { blocks: 5, columns: 1, sideRail: false }
  },
  "insights-index": {
    surfaceId: "insights-index",
    title: "Insights",
    description:
      "Store analyses, coaching notes, recommendations, and decisions that should remain visible.",
    tone: "knowledge",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "weekly-review": {
    surfaceId: "weekly-review",
    title: "Weekly review",
    description:
      "Close out the week, review evidence, and decide the next execution push.",
    tone: "execution",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-index": {
    surfaceId: "settings-index",
    title: "Settings",
    description:
      "Manage Forge runtime preferences, users, integrations, data, models, and companion setup.",
    tone: "settings",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "settings-data": {
    surfaceId: "settings-data",
    title: "Settings data",
    description:
      "Inspect the active data root, create backups, export data, and recover storage state.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-users": {
    surfaceId: "settings-users",
    title: "Settings users",
    description:
      "Manage human and bot users, ownership, relationships, and visibility rights.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-calendar": {
    surfaceId: "settings-calendar",
    title: "Settings calendar",
    description:
      "Connect calendar providers, choose writable calendars, and configure scheduling rules.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-mobile": {
    surfaceId: "settings-mobile",
    title: "Settings mobile",
    description:
      "Pair iPhone and watch companions, inspect mobile sync state, and manage device access.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-mobile-lab": {
    surfaceId: "settings-mobile-lab",
    title: "Companion sync lab",
    description:
      "Test mobile source states, movement gap fixtures, and companion sync edge cases.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-models": {
    surfaceId: "settings-models",
    title: "Settings models",
    description:
      "Configure local and remote model providers, defaults, reasoning settings, and availability.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-agents": {
    surfaceId: "settings-agents",
    title: "Settings agents",
    description:
      "Manage agent tokens, runtime identities, adapter access, and session visibility.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-rewards": {
    surfaceId: "settings-rewards",
    title: "Settings rewards",
    description:
      "Configure XP posture, reward assets, trophy rules, and progression display.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  rewards: {
    surfaceId: "rewards",
    title: "Trophy Hall",
    description:
      "Review earned trophies, locked achievements, streak pressure, mascot gear, and unlocks.",
    tone: "execution",
    skeleton: { blocks: 6, columns: 3, sideRail: true }
  },
  "settings-wiki": {
    surfaceId: "settings-wiki",
    title: "KarpaWiki settings",
    description:
      "Configure KarpaWiki ingest behavior, wiki profiles, memory settings, and source handling.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "settings-logs": {
    surfaceId: "settings-logs",
    title: "Settings logs",
    description:
      "Inspect diagnostic logs, runtime events, errors, and troubleshooting context.",
    tone: "settings",
    skeleton: { blocks: 6, columns: 2, sideRail: true }
  },
  "settings-bin": {
    surfaceId: "settings-bin",
    title: "Settings bin",
    description:
      "Review soft-deleted Forge records and restore useful data before permanent cleanup.",
    tone: "settings",
    skeleton: { blocks: 5, columns: 2, sideRail: true }
  },
  "task-detail": {
    surfaceId: "task-detail",
    title: "Task detail",
    description:
      "Work one task with timer state, instructions, linked context, notes, and closeout.",
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
  { viewId: "course-learn", match: matches(/^\/courses\/[^/]+\/learn$/) },
  { viewId: "course-detail", match: matches(/^\/courses\/[^/]+$/) },
  { viewId: "courses-index", match: exactly("/courses") },
  { viewId: "concept-detail", match: matches(/^\/concepts\/[^/]+$/) },
  { viewId: "concepts-index", match: exactly("/concepts") },
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
  { viewId: "people-index", match: startsWithSegment("/people") },
  { viewId: "calendar-index", match: exactly("/calendar") },
  { viewId: "life-events-index", match: startsWithSegment("/life-events") },
  { viewId: "knowledge-graph-index", match: exactly("/knowledge-graph") },
  { viewId: "artifacts-index", match: startsWithSegment("/artifacts") },
  { viewId: "movement-index", match: exactly("/movement") },
  { viewId: "sleep-index", match: exactly("/sleep") },
  {
    viewId: "sports-workout-detail",
    match: matches(/^\/sports\/workouts\/[^/]+$/)
  },
  { viewId: "sports-index", match: exactly("/sports") },
  { viewId: "training-load-index", match: exactly("/training-load") },
  { viewId: "vitals-index", match: exactly("/vitals") },
  { viewId: "weight-loss-index", match: exactly("/weight-loss") },
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
  { viewId: "attention-index", match: exactly("/attention") },
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
