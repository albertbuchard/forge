import { createNote } from "../repositories/notes.js";
import { updateTask } from "../repositories/tasks.js";
import { searchEntities } from "../services/entity-crud.js";
const SEARCH_TOOL = {
    key: "forge.search_entities",
    label: "Search Forge entities",
    description: "Search Forge entities by query and entity types. Args: { query, entityTypes?, limit? }",
    accessMode: "read"
};
const MOVE_TASK_TOOL = {
    key: "forge.update_task_status",
    label: "Move task",
    description: "Update a task status. Args: { taskId, status } where status is backlog, focus, in_progress, blocked, or done.",
    accessMode: "write"
};
const CREATE_NOTE_TOOL = {
    key: "forge.create_note",
    label: "Create note",
    description: "Create an evidence note. Args: { title, markdown, summary? }.",
    accessMode: "write"
};
const GENERIC_SURFACE_BOXES = [
    ["overview", "/overview", "Overview", "Strategic overview and priorities."],
    ["goals-index", "/goals", "Goals", "Goals workspace and long-range direction."],
    ["habits-index", "/habits", "Habits", "Recurring commitments and check-ins."],
    ["project-detail", "/projects/:projectId", "Project detail", "Project execution surface."],
    ["projects", "/projects", "Projects", "Projects browser and search."],
    ["strategies-index", "/strategies", "Strategies", "Strategy graphs and sequencing."],
    ["strategy-detail", "/strategies/:strategyId", "Strategy detail", "Single strategy execution plan."],
    ["preferences-index", "/preferences", "Preferences", "Preference model and comparisons."],
    ["calendar", "/calendar", "Calendar", "Calendar planning and timeboxes."],
    ["movement", "/movement", "Movement", "Movement stays, trips, and mobility context."],
    ["sleep", "/sleep", "Sleep", "Sleep session review and recovery context."],
    ["sports", "/sports", "Sports", "Workout history and sport reflection."],
    ["kanban", "/kanban", "Kanban", "Task execution board."],
    ["today", "/today", "Today", "Daily execution and focus."],
    ["notes", "/notes", "Notes", "Notes browser and evidence surface."],
    ["wiki", "/wiki", "Wiki", "Wiki knowledge workspace."],
    ["psyche", "/psyche", "Psyche", "Psychological reflection and maps."],
    ["activity", "/activity", "Activity", "Activity timeline and audit trail."],
    ["insights", "/insights", "Insights", "Synthesized system recommendations."],
    ["review-weekly", "/review/weekly", "Weekly review", "Weekly reflection report."],
    ["settings", "/settings", "Settings", "Forge settings and operator controls."],
    ["workbench", "/workbench", "Workbench", "Custom utility surface."]
].map(([surfaceId, routePath, label, description]) => ({
    boxId: `surface:${surfaceId}:main`,
    surfaceId,
    routePath,
    label,
    description,
    category: "Views",
    capabilityModes: ["content"],
    toolAdapters: []
}));
const FEATURE_BOXES = [
    {
        boxId: "kanban:board",
        surfaceId: "kanban",
        routePath: "/kanban",
        label: "Kanban board",
        description: "Task board with task search context and task status actions.",
        category: "Execution",
        capabilityModes: ["content", "tool"],
        toolAdapters: [SEARCH_TOOL, MOVE_TASK_TOOL]
    },
    {
        boxId: "projects:list",
        surfaceId: "projects",
        routePath: "/projects",
        label: "Projects list",
        description: "Project browser, filters, and search context.",
        category: "Execution",
        capabilityModes: ["content", "tool"],
        toolAdapters: [SEARCH_TOOL]
    },
    {
        boxId: "today:focus",
        surfaceId: "today",
        routePath: "/today",
        label: "Today focus",
        description: "Today priorities and daily focus context.",
        category: "Execution",
        capabilityModes: ["content", "tool"],
        toolAdapters: [SEARCH_TOOL]
    },
    {
        boxId: "overview:priorities",
        surfaceId: "overview",
        routePath: "/overview",
        label: "Overview priorities",
        description: "Priority summary, momentum, and active work context.",
        category: "Views",
        capabilityModes: ["content"],
        toolAdapters: []
    },
    {
        boxId: "notes:quick-capture",
        surfaceId: "notes",
        routePath: "/notes",
        label: "Quick capture",
        description: "Simple note capture and evidence drafting surface.",
        category: "Capture",
        capabilityModes: ["content", "tool"],
        toolAdapters: [CREATE_NOTE_TOOL]
    }
];
function summarizeSearchMatches(boxId, query, entityTypes, limit) {
    const result = searchEntities({
        searches: [
            {
                query,
                entityTypes,
                includeDeleted: false,
                limit
            }
        ]
    }).results[0];
    const matches = result?.ok ? result.matches ?? [] : [];
    const lines = matches.slice(0, limit).map((match) => {
        const title = typeof match.title === "string"
            ? match.title
            : typeof match.name === "string"
                ? match.name
                : typeof match.id === "string"
                    ? match.id
                    : "Untitled";
        const entityType = typeof match.entityType === "string" ? match.entityType : "entity";
        return `${entityType}: ${title}`;
    });
    return {
        boxId,
        label: getForgeBoxCatalogEntry(boxId)?.label ?? boxId,
        capturedAt: new Date().toISOString(),
        contentText: lines.length > 0
            ? lines.join("\n")
            : "No matching Forge entities were found for this box snapshot.",
        contentJson: {
            matches
        },
        tools: getForgeBoxCatalogEntry(boxId)?.toolAdapters ?? []
    };
}
export function listForgeBoxCatalog() {
    return [...GENERIC_SURFACE_BOXES, ...FEATURE_BOXES];
}
export function getForgeBoxCatalogEntry(boxId) {
    return listForgeBoxCatalog().find((entry) => entry.boxId === boxId) ?? null;
}
export function buildConnectorOutputCatalogEntry(input) {
    return {
        boxId: `connector-output:${input.outputId}`,
        surfaceId: null,
        routePath: `/connectors/${input.connectorId}`,
        label: `${input.title} output`,
        description: "Published AI connector output.",
        category: "Connector outputs",
        capabilityModes: ["content"],
        toolAdapters: []
    };
}
export function resolveForgeBoxSnapshot(boxId) {
    if (boxId === "kanban:board") {
        return summarizeSearchMatches(boxId, "", ["task"], 24);
    }
    if (boxId === "projects:list") {
        return summarizeSearchMatches(boxId, "", ["project"], 20);
    }
    if (boxId === "today:focus") {
        return summarizeSearchMatches(boxId, "", ["task", "habit"], 16);
    }
    if (boxId === "overview:priorities") {
        return summarizeSearchMatches(boxId, "", ["goal", "project", "task"], 18);
    }
    const entry = getForgeBoxCatalogEntry(boxId);
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
    };
}
export function executeForgeBoxTool(boxId, toolKey, args) {
    if (toolKey === "forge.search_entities") {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const entityTypes = Array.isArray(args.entityTypes)
            ? args.entityTypes.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            : [];
        const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
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
            throw new Error("forge.update_task_status requires { taskId, status } with a valid task status.");
        }
        const task = updateTask(taskId, { status: status }, { source: "agent", actor: "AI Connector" });
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
        const markdown = typeof args.markdown === "string" ? args.markdown.trim() : "";
        const summary = typeof args.summary === "string" ? args.summary.trim() : markdown.slice(0, 160);
        if (!title || !markdown) {
            throw new Error("forge.create_note requires { title, markdown }.");
        }
        const note = createNote({
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
        }, { source: "agent", actor: "AI Connector" });
        return {
            ok: true,
            note
        };
    }
    throw new Error(`Unsupported Forge box tool: ${toolKey}`);
}
