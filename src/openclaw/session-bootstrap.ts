import path from "node:path";
import { isAgentBootstrapEvent } from "openclaw/plugin-sdk/hook-runtime";
import type { InternalHookEvent } from "openclaw/plugin-sdk/hook-runtime";
import {
  callConfiguredForgeApi,
  expectForgeSuccess,
  type ForgePluginConfig
} from "./api-client.js";
import type { ForgePluginRegistrationApi } from "./plugin-sdk-types.js";

const FORGE_SESSION_BOOTSTRAP_PATH = ".forge/generated/FORGE_SESSION_BOOTSTRAP.md";
const FORGE_SESSION_BOOTSTRAP_NAME = "forge-session-bootstrap";

type ForgeGoalRecord = {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  horizon?: string | null;
};

type ForgeProjectRecord = {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  goalId?: string | null;
  goalTitle?: string | null;
};

type ForgeTaskRecord = {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  projectId?: string | null;
  projectTitle?: string | null;
  goalId?: string | null;
  goalTitle?: string | null;
};

type ForgeHabitRecord = {
  id: string;
  title: string;
  description?: string | null;
  polarity?: string;
  frequency?: string | null;
};

type ForgeStrategyRecord = {
  id: string;
  title: string;
  overview?: string | null;
  status?: string | null;
  isLocked?: boolean;
};

type ForgeWikiPageRecord = {
  id: string;
  slug: string;
  title: string;
  kind?: string;
  parentSlug?: string | null;
  summary?: string | null;
  contentPlain?: string | null;
};

type ForgeOperatorContext = {
  generatedAt?: string;
  activeProjects?: ForgeProjectRecord[];
  focusTasks?: ForgeTaskRecord[];
  dueHabits?: ForgeHabitRecord[];
  recommendedNextTask?: ForgeTaskRecord | null;
};

type ForgeOperatorOverview = {
  generatedAt?: string;
  warnings?: string[];
  operator?: ForgeOperatorContext | null;
};

type ForgeSessionBootstrapPayload = {
  overview: ForgeOperatorOverview | null;
  goals: ForgeGoalRecord[];
  projects: ForgeProjectRecord[];
  tasks: ForgeTaskRecord[];
  habits: ForgeHabitRecord[];
  strategies: ForgeStrategyRecord[];
  peoplePages: ForgeWikiPageRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function cleanInline(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function excerpt(value: string | null | undefined, maxLength: number) {
  const normalized = cleanInline(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatMeta(parts: Array<string | null | undefined>) {
  return parts
    .map((value) => cleanInline(value))
    .filter(Boolean)
    .join(" | ");
}

function buildGoalIndex(goals: ForgeGoalRecord[]) {
  return new Map(goals.map((goal) => [goal.id, goal.title]));
}

function buildProjectIndex(projects: ForgeProjectRecord[]) {
  return new Map(projects.map((project) => [project.id, project.title]));
}

function formatGoal(goal: ForgeGoalRecord) {
  const meta = formatMeta([goal.status, goal.horizon]);
  const summary = excerpt(goal.description, 140);
  return `- ${goal.title}${meta ? ` [${meta}]` : ""}${summary ? ` — ${summary}` : ""}`;
}

function formatProject(
  project: ForgeProjectRecord,
  goalTitles: Map<string, string>
) {
  const linkedGoal =
    cleanInline(project.goalTitle) ||
    (project.goalId ? goalTitles.get(project.goalId) ?? project.goalId : "");
  const meta = formatMeta([project.status, linkedGoal ? `goal: ${linkedGoal}` : ""]);
  const summary = excerpt(project.description, 140);
  return `- ${project.title}${meta ? ` [${meta}]` : ""}${summary ? ` — ${summary}` : ""}`;
}

function formatTask(
  task: ForgeTaskRecord,
  projectTitles: Map<string, string>,
  goalTitles: Map<string, string>
) {
  const linkedProject =
    cleanInline(task.projectTitle) ||
    (task.projectId ? projectTitles.get(task.projectId) ?? task.projectId : "");
  const linkedGoal =
    cleanInline(task.goalTitle) ||
    (task.goalId ? goalTitles.get(task.goalId) ?? task.goalId : "");
  const meta = formatMeta([
    task.status,
    task.priority,
    task.dueDate ? `due ${task.dueDate}` : "",
    linkedProject ? `project: ${linkedProject}` : "",
    !linkedProject && linkedGoal ? `goal: ${linkedGoal}` : ""
  ]);
  const summary = excerpt(task.description, 140);
  return `- ${task.title}${meta ? ` [${meta}]` : ""}${summary ? ` — ${summary}` : ""}`;
}

function formatHabit(habit: ForgeHabitRecord) {
  const meta = formatMeta([habit.polarity, habit.frequency]);
  const summary = excerpt(habit.description, 140);
  return `- ${habit.title}${meta ? ` [${meta}]` : ""}${summary ? ` — ${summary}` : ""}`;
}

function formatStrategy(strategy: ForgeStrategyRecord) {
  const meta = formatMeta([
    strategy.status,
    strategy.isLocked ? "locked" : "editable"
  ]);
  const summary = excerpt(strategy.overview, 140);
  return `- ${strategy.title}${meta ? ` [${meta}]` : ""}${summary ? ` — ${summary}` : ""}`;
}

function hasPeopleAncestor(
  page: ForgeWikiPageRecord,
  pagesBySlug: Map<string, ForgeWikiPageRecord>
) {
  let parentSlug = page.parentSlug ?? null;
  while (parentSlug) {
    if (parentSlug === "people") {
      return true;
    }
    parentSlug = pagesBySlug.get(parentSlug)?.parentSlug ?? null;
  }
  return false;
}

export function listPeopleBranchPages(pages: ForgeWikiPageRecord[]) {
  const pagesBySlug = new Map(pages.map((page) => [page.slug, page]));
  return pages
    .filter((page) => page.kind === "wiki")
    .filter((page) => page.slug !== "people")
    .filter((page) => hasPeopleAncestor(page, pagesBySlug))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function buildForgeSessionBootstrapContext(
  payload: ForgeSessionBootstrapPayload
) {
  const goalTitles = buildGoalIndex(payload.goals);
  const projectTitles = buildProjectIndex(payload.projects);
  const overview = payload.overview?.operator ?? null;
  const lines = [
    "# Forge Session Bootstrap",
    "",
    "This block is generated from the live Forge runtime at session creation time. Treat it as a compact starting snapshot, not as the full source of truth.",
    ""
  ];

  if (payload.overview?.generatedAt) {
    lines.push(`Generated at: ${payload.overview.generatedAt}`, "");
  }

  if (overview) {
    lines.push("## Current Forge Snapshot", "");
    lines.push(`- Active projects in operator view: ${overview.activeProjects?.length ?? 0}`);
    lines.push(`- Focus tasks in operator view: ${overview.focusTasks?.length ?? 0}`);
    lines.push(`- Due habits in operator view: ${overview.dueHabits?.length ?? 0}`);
    if (overview.recommendedNextTask) {
      lines.push(`- Recommended next task: ${overview.recommendedNextTask.title}`);
    }
    if ((payload.overview?.warnings ?? []).length > 0) {
      lines.push(
        `- Warnings: ${(payload.overview?.warnings ?? []).join(" | ")}`
      );
    }
    lines.push("");
  }

  lines.push(`## Goals (${payload.goals.length})`, "");
  if (payload.goals.length === 0) {
    lines.push("- None.", "");
  } else {
    lines.push(...payload.goals.map((goal) => formatGoal(goal)), "");
  }

  lines.push(`## Projects (${payload.projects.length})`, "");
  if (payload.projects.length === 0) {
    lines.push("- None.", "");
  } else {
    lines.push(
      ...payload.projects.map((project) => formatProject(project, goalTitles)),
      ""
    );
  }

  lines.push(`## Strategies (${payload.strategies.length})`, "");
  if (payload.strategies.length === 0) {
    lines.push("- None.", "");
  } else {
    lines.push(...payload.strategies.map((strategy) => formatStrategy(strategy)), "");
  }

  lines.push(`## Tasks (${payload.tasks.length})`, "");
  if (payload.tasks.length === 0) {
    lines.push("- None.", "");
  } else {
    lines.push(
      ...payload.tasks.map((task) =>
        formatTask(task, projectTitles, goalTitles)
      ),
      ""
    );
  }

  lines.push(`## Habits (${payload.habits.length})`, "");
  if (payload.habits.length === 0) {
    lines.push("- None.", "");
  } else {
    lines.push(...payload.habits.map((habit) => formatHabit(habit)), "");
  }

  lines.push(`## Wiki People Pages (${payload.peoplePages.length})`, "");
  if (payload.peoplePages.length === 0) {
    lines.push("- None.", "");
  } else {
    lines.push(
      ...payload.peoplePages.map((page) => {
        const preview = excerpt(page.contentPlain ?? page.summary, 100);
        return `- ${page.title}${preview ? ` — ${preview}` : ""}`;
      }),
      ""
    );
  }

  lines.push("## Use The Forge Skill", "");
  lines.push(
    "If you need more detail about any Forge entity, use the Forge skill/tools instead of guessing."
  );
  lines.push(
    "Relevant Forge entities include goals, projects, tasks, habits, strategies, notes, wiki pages, sleep sessions, workout sessions, psyche records, questionnaire records, preferences records, calendar events, work blocks, task timeboxes, and user ownership context."
  );
  lines.push(
    "If you need more detail about any listed person or relationship page, use the Forge skill to search the wiki and open the live page."
  );
  lines.push("");

  return lines.join("\n").trim();
}

async function readForgePayload<T>(
  config: ForgePluginConfig,
  pathName: string
): Promise<T> {
  const result = await callConfiguredForgeApi(config, {
    method: "GET",
    path: pathName
  });
  return expectForgeSuccess(result) as T;
}

async function loadForgeSessionBootstrapPayload(
  config: ForgePluginConfig
): Promise<ForgeSessionBootstrapPayload> {
  const [
    overviewResponse,
    goalsResponse,
    projectsResponse,
    tasksResponse,
    habitsResponse,
    strategiesResponse,
    wikiPagesResponse
  ] = await Promise.all([
    readForgePayload<{ overview?: ForgeOperatorOverview | null }>(
      config,
      "/api/v1/operator/overview"
    ),
    readForgePayload<{ goals?: ForgeGoalRecord[] }>(config, "/api/v1/goals"),
    readForgePayload<{ projects?: ForgeProjectRecord[] }>(
      config,
      "/api/v1/projects"
    ),
    readForgePayload<{ tasks?: ForgeTaskRecord[] }>(config, "/api/v1/tasks"),
    readForgePayload<{ habits?: ForgeHabitRecord[] }>(config, "/api/v1/habits"),
    readForgePayload<{ strategies?: ForgeStrategyRecord[] }>(
      config,
      "/api/v1/strategies"
    ),
    readForgePayload<{ pages?: ForgeWikiPageRecord[] }>(
      config,
      "/api/v1/wiki/pages"
    )
  ]);

  const wikiPages = asArray<ForgeWikiPageRecord>(wikiPagesResponse.pages).filter(
    (page) =>
      isRecord(page) &&
      typeof page.slug === "string" &&
      typeof page.title === "string"
  );

  return {
    overview:
      overviewResponse && isRecord(overviewResponse) && "overview" in overviewResponse
        ? ((overviewResponse.overview as ForgeOperatorOverview | null) ?? null)
        : null,
    goals: asArray<ForgeGoalRecord>(goalsResponse.goals),
    projects: asArray<ForgeProjectRecord>(projectsResponse.projects),
    tasks: asArray<ForgeTaskRecord>(tasksResponse.tasks),
    habits: asArray<ForgeHabitRecord>(habitsResponse.habits),
    strategies: asArray<ForgeStrategyRecord>(strategiesResponse.strategies),
    peoplePages: listPeopleBranchPages(wikiPages)
  };
}

export async function buildLiveForgeSessionBootstrapContext(
  config: ForgePluginConfig
) {
  return buildForgeSessionBootstrapContext(
    await loadForgeSessionBootstrapPayload(config)
  );
}

export function registerForgeSessionBootstrapHook(
  api: ForgePluginRegistrationApi,
  config: ForgePluginConfig
) {
  if (!api.registerHook) {
    return;
  }

  api.registerHook(
    "agent:bootstrap",
    async (event: InternalHookEvent) => {
      if (!isAgentBootstrapEvent(event)) {
        return;
      }

      try {
        const content = await buildLiveForgeSessionBootstrapContext(config);
        if (!content.trim()) {
          return;
        }

        const generatedPath = path.join(
          event.context.workspaceDir,
          FORGE_SESSION_BOOTSTRAP_PATH
        );
        const existingFiles = event.context.bootstrapFiles.filter(
          (file) => file.path !== generatedPath
        );
        event.context.bootstrapFiles = [
          ...existingFiles,
          {
            name: "BOOTSTRAP.md",
            path: generatedPath,
            content,
            missing: false
          }
        ];
      } catch (error) {
        api.logger?.warn?.(
          `Forge session bootstrap hook could not load live Forge context: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    {
      name: FORGE_SESSION_BOOTSTRAP_NAME,
      description:
        "Inject a live Forge workspace summary and People wiki snapshots into agent bootstrap context."
    }
  );
}
