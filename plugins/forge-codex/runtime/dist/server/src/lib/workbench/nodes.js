export const WORKBENCH_PORT_KINDS = [
    "text",
    "number",
    "boolean",
    "object",
    "array",
    "json",
    "tool",
    "summary",
    "entity",
    "entity_list",
    "context",
    "metrics",
    "filters",
    "markdown",
    "timeline",
    "selection",
    "record",
    "record_list"
];
export const LEGACY_WORKBENCH_PORT_KINDS = ["content"];
const ENTITY_PORT_SHAPES = {
    goal: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "status", label: "Status", kind: "text" },
        { key: "horizon", label: "Horizon", kind: "text" }
    ],
    project: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "status", label: "Status", kind: "text" },
        { key: "goalId", label: "Goal id", kind: "text" }
    ],
    task: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "status", label: "Status", kind: "text" },
        { key: "priority", label: "Priority", kind: "text" },
        { key: "projectId", label: "Project id", kind: "text" }
    ],
    strategy: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "status", label: "Status", kind: "text" },
        { key: "overview", label: "Overview", kind: "markdown" }
    ],
    habit: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "status", label: "Status", kind: "text" },
        { key: "frequency", label: "Frequency", kind: "text" },
        { key: "polarity", label: "Polarity", kind: "text" }
    ],
    note: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "summary", label: "Summary", kind: "markdown" },
        { key: "kind", label: "Kind", kind: "text" },
        { key: "updatedAt", label: "Updated at", kind: "text" }
    ],
    insight: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "summary", label: "Summary", kind: "markdown" },
        { key: "status", label: "Status", kind: "text" }
    ],
    calendar_event: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "startsAt", label: "Starts at", kind: "text" },
        { key: "endsAt", label: "Ends at", kind: "text" },
        { key: "origin", label: "Origin", kind: "text" }
    ],
    wiki_page: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "title", label: "Title", kind: "text", required: true },
        { key: "slug", label: "Slug", kind: "text" },
        { key: "summary", label: "Summary", kind: "markdown" }
    ],
    sleep_session: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "startAt", label: "Start", kind: "text" },
        { key: "endAt", label: "End", kind: "text" },
        { key: "totalSleepMinutes", label: "Total sleep minutes", kind: "number" }
    ],
    workout_session: [
        { key: "id", label: "Id", kind: "text", required: true },
        { key: "type", label: "Type", kind: "text" },
        { key: "startedAt", label: "Started at", kind: "text" },
        { key: "durationMinutes", label: "Duration minutes", kind: "number" }
    ]
};
const MODEL_PORT_SHAPES = {
    WorkbenchUserMessage: [{ key: "message", label: "Message", kind: "text", required: true }],
    WorkbenchUserContext: [{ key: "context", label: "Context", kind: "record" }],
    WorkbenchMergedContext: [{ key: "merged", label: "Merged", kind: "record", required: true }],
    WorkbenchTemplateOutput: [{ key: "rendered", label: "Rendered", kind: "markdown", required: true }],
    WorkbenchSelectedValue: [{ key: "selected", label: "Selected", kind: "record", required: true }],
    WorkbenchPublishedOutput: [{ key: "published", label: "Published", kind: "record", required: true }],
    WeeklyReviewPayload: [
        { key: "wins", label: "Wins", kind: "record_list" },
        { key: "trends", label: "Trends", kind: "record_list" }
    ],
    InsightsPayload: [
        { key: "insights", label: "Insights", kind: "record_list" },
        { key: "heatmap", label: "Heatmap", kind: "record_list" }
    ],
    OperatorOverviewPayload: [
        { key: "summary", label: "Summary", kind: "markdown" },
        { key: "currentWork", label: "Current work", kind: "record_list" }
    ],
    OperatorContextPayload: [
        { key: "tasks", label: "Tasks", kind: "record_list" },
        { key: "focus", label: "Focus", kind: "record_list" }
    ],
    SleepViewData: [
        { key: "sessions", label: "Sessions", kind: "record_list" },
        { key: "metrics", label: "Metrics", kind: "metrics" }
    ]
};
export function inferWorkbenchPortKind(input) {
    const rawKind = input.kind?.trim().toLowerCase();
    if (rawKind && WORKBENCH_PORT_KINDS.includes(rawKind)) {
        return rawKind;
    }
    const key = input.key?.trim().toLowerCase() ?? "";
    const modelName = input.modelName?.trim().toLowerCase() ?? "";
    if (rawKind === "content") {
        if (key === "summary" || modelName.includes("summary")) {
            return "summary";
        }
        if (key === "answer" ||
            key === "rendered" ||
            modelName.includes("answer") ||
            modelName.includes("markdown") ||
            modelName.includes("template")) {
            return "markdown";
        }
        if (key === "message" ||
            key === "query" ||
            key === "title" ||
            modelName.includes("message")) {
            return "text";
        }
        if (input.itemKind) {
            return "entity_list";
        }
        return "record";
    }
    if (key.endsWith("count") || key === "limit") {
        return "number";
    }
    if (key === "summary") {
        return "summary";
    }
    if (key === "answer" || key === "rendered") {
        return "markdown";
    }
    if (key === "message" || key === "query") {
        return "text";
    }
    if (input.itemKind) {
        return "entity_list";
    }
    return "record";
}
export function normalizeWorkbenchPortKind(input) {
    return inferWorkbenchPortKind(input);
}
export function getWorkbenchEntityPortShape(itemKind) {
    if (!itemKind) {
        return [];
    }
    return ENTITY_PORT_SHAPES[itemKind] ?? [];
}
export function getWorkbenchModelPortShape(modelName) {
    if (!modelName) {
        return [];
    }
    return MODEL_PORT_SHAPES[modelName] ?? [];
}
export function normalizeWorkbenchPortDefinition(port) {
    const kind = inferWorkbenchPortKind(port);
    const entityShape = getWorkbenchEntityPortShape(port.itemKind);
    const modelShape = getWorkbenchModelPortShape(port.modelName);
    const inferredShape = port.shape && port.shape.length > 0
        ? port.shape
        : entityShape.length > 0
            ? entityShape
            : modelShape;
    return {
        ...port,
        kind,
        shape: inferredShape.length > 0 ? inferredShape : []
    };
}
export function normalizeWorkbenchPortDefinitions(ports) {
    return ports.map((port) => normalizeWorkbenchPortDefinition(port));
}
export function defineWorkbenchComponent(component, workbench) {
    return Object.assign(component, {
        workbench: {
            ...workbench,
            WebView: component
        }
    });
}
export function isWorkbenchRegisteredComponent(value) {
    const candidate = value;
    return Boolean(candidate &&
        typeof value === "function" &&
        candidate.workbench &&
        typeof candidate.workbench.id === "string");
}
