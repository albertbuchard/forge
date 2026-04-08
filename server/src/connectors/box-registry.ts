import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase } from "../db.js";
import { getFitnessViewData, getSleepViewData } from "../health.js";
import { listMovementPlaces } from "../movement.js";
import { createNote } from "../repositories/notes.js";
import { listNotes } from "../repositories/notes.js";
import { updateTask } from "../repositories/tasks.js";
import { searchEntities } from "../services/entity-crud.js";
import type {
  CrudEntityType,
  ForgeBoxCatalogEntry,
  ForgeBoxSnapshot,
  ForgeBoxToolAdapter
} from "../types.js";
import { forgeBoxCatalogEntrySchema } from "../types.js";

const definitionFilePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lib/workbench/box-definitions.json"
);

const BOX_DEFINITIONS = JSON.parse(
  readFileSync(definitionFilePath, "utf8")
) as unknown[];
const SHARED_BOXES: ForgeBoxCatalogEntry[] = BOX_DEFINITIONS.map((entry) =>
  forgeBoxCatalogEntrySchema.parse(entry)
);

const LEGACY_COMPAT_BOXES: ForgeBoxCatalogEntry[] = [
  {
    boxId: "kanban:board",
    surfaceId: "kanban-index",
    routePath: "/kanban",
    label: "Kanban board",
    description: "Task board with task search context and task status actions.",
    category: "Execution",
    tags: ["legacy", "kanban", "tasks"],
    capabilityModes: ["content", "tool"],
    inputs: [],
    outputs: [
      {
        key: "primary",
        label: "Kanban board",
        kind: "content",
        required: false,
        expandableKeys: []
      }
    ],
    toolAdapters: SHARED_BOXES.find((entry) => entry.boxId === "surface:kanban-index:main")
      ?.toolAdapters ?? [],
    snapshotResolverKey: "kanban-board"
  },
  {
    boxId: "projects:list",
    surfaceId: "projects",
    routePath: "/projects",
    label: "Projects list",
    description: "Project browser, filters, and search context.",
    category: "Execution",
    tags: ["legacy", "projects", "search"],
    capabilityModes: ["content", "tool"],
    inputs: [],
    outputs: [
      {
        key: "primary",
        label: "Projects list",
        kind: "content",
        required: false,
        expandableKeys: []
      }
    ],
    toolAdapters: SHARED_BOXES.find((entry) => entry.boxId === "surface:projects:search-results")
      ?.toolAdapters ?? [],
    snapshotResolverKey: "projects-list"
  },
  {
    boxId: "today:focus",
    surfaceId: "today",
    routePath: "/today",
    label: "Today focus",
    description: "Today priorities and daily focus context.",
    category: "Execution",
    tags: ["legacy", "today", "focus"],
    capabilityModes: ["content", "tool"],
    inputs: [],
    outputs: [
      {
        key: "primary",
        label: "Today focus",
        kind: "content",
        required: false,
        expandableKeys: []
      }
    ],
    toolAdapters: SHARED_BOXES.find((entry) => entry.boxId === "surface:today:focus")
      ?.toolAdapters ?? [],
    snapshotResolverKey: "today-focus"
  },
  {
    boxId: "overview:priorities",
    surfaceId: "overview",
    routePath: "/overview",
    label: "Overview priorities",
    description: "Priority summary, momentum, and active work context.",
    category: "Views",
    tags: ["legacy", "overview", "priorities"],
    capabilityModes: ["content"],
    inputs: [],
    outputs: [
      {
        key: "primary",
        label: "Overview priorities",
        kind: "content",
        required: false,
        expandableKeys: []
      }
    ],
    toolAdapters: [],
    snapshotResolverKey: "overview-priorities"
  },
  {
    boxId: "notes:quick-capture",
    surfaceId: "notes-index",
    routePath: "/notes",
    label: "Quick capture",
    description: "Simple note capture and evidence drafting surface.",
    category: "Capture",
    tags: ["legacy", "capture", "notes"],
    capabilityModes: ["content", "tool"],
    inputs: [],
    outputs: [
      {
        key: "primary",
        label: "Capture content",
        kind: "content",
        required: false,
        expandableKeys: []
      }
    ],
    toolAdapters: SHARED_BOXES.find((entry) => entry.boxId === "surface:overview:quick-capture")
      ?.toolAdapters ?? [],
    snapshotResolverKey: "quick-capture"
  }
];

function summarizeSearchMatches(
  boxId: string,
  query: string,
  entityTypes: CrudEntityType[],
  limit: number
) {
  const result = searchEntities({
    searches: [
      {
        query,
        entityTypes,
        includeDeleted: false,
        limit
      }
    ]
  }).results[0] as
    | {
        ok?: boolean;
        matches?: Array<Record<string, unknown>>;
      }
    | undefined;

  const matches = result?.ok ? result.matches ?? [] : [];
  const lines = matches.slice(0, limit).map((match) => {
    const title =
      typeof match.title === "string"
        ? match.title
        : typeof match.name === "string"
          ? match.name
          : typeof match.id === "string"
            ? match.id
            : "Untitled";
    const entityType =
      typeof match.entityType === "string" ? match.entityType : "entity";
    return `${entityType}: ${title}`;
  });

  return {
    boxId,
    label: getForgeBoxCatalogEntry(boxId)?.label ?? boxId,
    capturedAt: new Date().toISOString(),
    contentText:
      lines.length > 0
        ? lines.join("\n")
        : "No matching Forge entities were found for this box snapshot.",
    contentJson: {
      matches
    },
    tools: getForgeBoxCatalogEntry(boxId)?.toolAdapters ?? []
  } satisfies ForgeBoxSnapshot;
}

export function listForgeBoxCatalog(options?: { includeLegacyAliases?: boolean }) {
  return options?.includeLegacyAliases
    ? [...SHARED_BOXES, ...LEGACY_COMPAT_BOXES]
    : [...SHARED_BOXES];
}

export function getForgeBoxCatalogEntry(boxId: string) {
  return (
    listForgeBoxCatalog({ includeLegacyAliases: true }).find(
      (entry) => entry.boxId === boxId
    ) ?? null
  );
}

export function buildConnectorOutputCatalogEntry(input: {
  connectorId: string;
  title: string;
  outputId: string;
}) {
  return {
    boxId: `connector-output:${input.outputId}`,
    surfaceId: null,
    routePath: `/workbench/${input.connectorId}`,
    label: `${input.title} output`,
    description: "Published AI connector output.",
    category: "Connector outputs",
    tags: ["workbench", "output"],
    capabilityModes: ["content"],
    inputs: [],
    outputs: [
      {
        key: "primary",
        label: "Published output",
        kind: "content",
        required: false,
        expandableKeys: []
      }
    ],
    toolAdapters: [],
    snapshotResolverKey: "generic"
  } satisfies ForgeBoxCatalogEntry;
}

export function resolveForgeBoxSnapshot(boxId: string) {
  if (boxId.startsWith("connector-output:")) {
    const outputId = boxId.replace(/^connector-output:/, "");
    const rows = getDatabase()
      .prepare(
        `SELECT id, title, published_outputs_json, last_run_json FROM ai_connectors ORDER BY updated_at DESC`
      )
      .all() as Array<{
      id: string;
      title: string;
      published_outputs_json: string;
      last_run_json: string | null;
    }>;
    for (const row of rows) {
      const outputs = JSON.parse(row.published_outputs_json || "[]") as Array<{
        id: string;
        label: string;
      }>;
      const output = outputs.find((entry) => entry.id === outputId);
      if (!output) {
        continue;
      }
      const lastRun = row.last_run_json
        ? (JSON.parse(row.last_run_json) as { result?: { outputs?: Record<string, { text: string; json: Record<string, unknown> | null }> } })
        : null;
      const published = lastRun?.result?.outputs?.[outputId] ?? null;
      return {
        boxId,
        label: output.label,
        capturedAt: new Date().toISOString(),
        contentText: published?.text ?? `${row.title}\nNo published output has been generated yet.`,
        contentJson: published?.json ?? null,
        tools: []
      } satisfies ForgeBoxSnapshot;
    }
  }
  const entry = getForgeBoxCatalogEntry(boxId);
  if (entry?.snapshotResolverKey === "kanban-board") {
    return summarizeSearchMatches(boxId, "", ["task"], 24);
  }
  if (entry?.snapshotResolverKey === "projects-list") {
    return summarizeSearchMatches(boxId, "", ["project"], 20);
  }
  if (entry?.snapshotResolverKey === "today-focus") {
    return summarizeSearchMatches(boxId, "", ["task", "habit"], 16);
  }
  if (entry?.snapshotResolverKey === "overview-priorities") {
    return summarizeSearchMatches(boxId, "", ["goal", "project", "task"], 18);
  }
  if (entry?.snapshotResolverKey === "quick-capture") {
    return {
      boxId,
      label: entry.label,
      capturedAt: new Date().toISOString(),
      contentText: `${entry.label}\n${entry.description}\nThis surface can draft notes and wiki pages.`,
      contentJson: {
        routePath: entry.routePath,
        category: entry.category,
        tags: entry.tags
      },
      tools: entry.toolAdapters
    } satisfies ForgeBoxSnapshot;
  }
  if (entry?.snapshotResolverKey === "notes-library") {
    const notes = listNotes({ limit: 12 });
    return {
      boxId,
      label: entry.label,
      capturedAt: new Date().toISOString(),
      contentText:
        notes.length > 0
          ? notes
              .map((note) => {
                const firstLine = note.contentPlain.trim().split(/\n+/)[0] ?? "Untitled note";
                return `${note.author || "Unknown"}: ${firstLine.slice(0, 140)}`;
              })
              .join("\n")
          : "No notes are available yet.",
      contentJson: {
        noteCount: notes.length,
        noteIds: notes.map((note) => note.id)
      },
      tools: entry.toolAdapters
    } satisfies ForgeBoxSnapshot;
  }
  if (entry?.snapshotResolverKey === "sleep-history") {
    const sleep = getSleepViewData();
    return {
      boxId,
      label: entry.label,
      capturedAt: new Date().toISOString(),
      contentText:
        sleep.sessions.length > 0
          ? sleep.sessions
              .slice(0, 10)
              .map(
                (session) =>
                  `${session.startedAt} -> ${session.endedAt} · score ${session.sleepScore ?? "n/a"} · asleep ${Math.round(session.asleepSeconds / 3600 * 10) / 10}h`
              )
              .join("\n")
          : "No sleep sessions are available yet.",
      contentJson: {
        sessionCount: sleep.sessions.length,
        summary: sleep.summary
      },
      tools: entry.toolAdapters
    } satisfies ForgeBoxSnapshot;
  }
  if (entry?.snapshotResolverKey === "sports-history") {
    const fitness = getFitnessViewData();
    return {
      boxId,
      label: entry.label,
      capturedAt: new Date().toISOString(),
      contentText:
        fitness.sessions.length > 0
          ? fitness.sessions
              .slice(0, 10)
              .map(
                (session) =>
                  `${session.workoutType} · ${session.startedAt} · ${Math.round(session.durationSeconds / 60)}m`
              )
              .join("\n")
          : "No workout sessions are available yet.",
      contentJson: {
        sessionCount: fitness.sessions.length,
        summary: fitness.summary
      },
      tools: entry.toolAdapters
    } satisfies ForgeBoxSnapshot;
  }
  if (entry?.snapshotResolverKey === "movement-places") {
    const places = listMovementPlaces();
    return {
      boxId,
      label: entry.label,
      capturedAt: new Date().toISOString(),
      contentText:
        places.length > 0
          ? places
              .slice(0, 16)
              .map((place) => `${place.label} · ${place.categoryTags.join(", ") || "untagged"} · radius ${Math.round(place.radiusMeters)}m`)
              .join("\n")
          : "No known places are registered yet.",
      contentJson: {
        placeCount: places.length,
        placeIds: places.map((place) => place.id)
      },
      tools: entry.toolAdapters
    } satisfies ForgeBoxSnapshot;
  }
  return {
    boxId,
    label: entry?.label ?? boxId,
    capturedAt: new Date().toISOString(),
    contentText: entry
      ? `${entry.label}\n${entry.description}\nRoute: ${entry.routePath ?? "n/a"}`
      : "This box is registered but no live snapshot resolver is available yet.",
    contentJson: entry
      ? {
          surfaceId: entry.surfaceId,
          routePath: entry.routePath,
          category: entry.category
        }
      : null,
    tools: entry?.toolAdapters ?? []
  } satisfies ForgeBoxSnapshot;
}

export function executeForgeBoxTool(
  boxId: string,
  toolKey: string,
  args: Record<string, unknown>
) {
  if (toolKey === "forge.search_entities") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const entityTypes = Array.isArray(args.entityTypes)
      ? args.entityTypes.filter(
          (entry): entry is CrudEntityType =>
            typeof entry === "string" && entry.trim().length > 0
        )
      : [];
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(50, Math.round(args.limit)))
        : 12;
    return summarizeSearchMatches(boxId, query, entityTypes, limit);
  }

  if (toolKey === "forge.update_task_status") {
    const taskId = typeof args.taskId === "string" ? args.taskId : "";
    const status = typeof args.status === "string" ? args.status : "";
    const allowed = new Set([
      "backlog",
      "focus",
      "in_progress",
      "blocked",
      "done"
    ]);
    if (!taskId || !allowed.has(status)) {
      throw new Error(
        "forge.update_task_status requires { taskId, status } with a valid task status."
      );
    }
    const task = updateTask(
      taskId,
      { status: status as "backlog" | "focus" | "in_progress" | "blocked" | "done" },
      { source: "agent", actor: "AI Connector" }
    );
    if (!task) {
      throw new Error(`Task ${taskId} was not found.`);
    }
    return {
      ok: true,
      task
    };
  }

  if (toolKey === "forge.create_note") {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const markdown =
      typeof args.markdown === "string" ? args.markdown.trim() : "";
    const summary =
      typeof args.summary === "string" ? args.summary.trim() : markdown.slice(0, 160);
    if (!title || !markdown) {
      throw new Error("forge.create_note requires { title, markdown }.");
    }
    const note = createNote(
      {
        kind: "evidence",
        title,
        slug: "",
        spaceId: "",
        parentSlug: null,
        indexOrder: 0,
        showInIndex: false,
        aliases: [],
        summary,
        contentMarkdown: markdown,
        author: "AI Connector",
        destroyAt: null,
        sourcePath: "ai-connector",
        frontmatter: {},
        revisionHash: "",
        links: [],
        tags: []
      },
      { source: "agent", actor: "AI Connector" }
    );
    return {
      ok: true,
      note
    };
  }

  throw new Error(`Unsupported Forge box tool: ${toolKey}`);
}
