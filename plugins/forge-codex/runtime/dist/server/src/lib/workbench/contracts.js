import { getWorkbenchEntityPortShape, getWorkbenchModelPortShape, normalizeWorkbenchPortDefinition } from "./nodes.js";
function toPascalCase(value) {
    return value
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}
export function createOutputDefinition(input) {
    const inferredEntityShape = input.itemKind
        ? getWorkbenchEntityPortShape(input.itemKind)
        : [];
    const inferredModelShape = input.modelName
        ? getWorkbenchModelPortShape(input.modelName)
        : [];
    return normalizeWorkbenchPortDefinition({
        key: input.key,
        label: input.label,
        kind: input.kind,
        description: input.description,
        required: input.required ?? false,
        modelName: input.modelName,
        itemKind: input.itemKind,
        shape: input.shape ??
            (inferredEntityShape.length > 0 ? inferredEntityShape : inferredModelShape),
        exampleValue: input.exampleValue
    });
}
export function createInputDefinition(input) {
    const inferredEntityShape = input.itemKind
        ? getWorkbenchEntityPortShape(input.itemKind)
        : [];
    const inferredModelShape = input.modelName
        ? getWorkbenchModelPortShape(input.modelName)
        : [];
    return normalizeWorkbenchPortDefinition({
        key: input.key,
        label: input.label,
        kind: input.kind,
        description: input.description,
        required: input.required ?? false,
        modelName: input.modelName,
        itemKind: input.itemKind,
        shape: input.shape ??
            (inferredEntityShape.length > 0 ? inferredEntityShape : inferredModelShape),
        exampleValue: input.exampleValue
    });
}
export function createParamDefinition(input) {
    return {
        key: input.key,
        label: input.label,
        kind: input.kind,
        description: input.description,
        required: input.required ?? false,
        options: input.options
    };
}
export function createSummaryOutput(input) {
    return createOutputDefinition({
        key: "summary",
        label: input?.label ?? "Summary",
        kind: "summary",
        description: input?.description ??
            "Human-readable summary of what this node currently knows or produced.",
        modelName: "WorkbenchSummary",
        exampleValue: input?.exampleValue
    });
}
export function createSearchOutputs(input) {
    const modelStem = toPascalCase(input.itemKind);
    return [
        createSummaryOutput({
            label: input.summaryLabel ?? "Search summary",
            description: `Compact summary of the current ${input.itemLabel.toLowerCase()} search results.`
        }),
        createOutputDefinition({
            key: input.collectionKey ?? "matches",
            label: input.collectionLabel ?? `${input.itemLabel} matches`,
            kind: "entity_list",
            description: `Structured ${input.itemLabel.toLowerCase()} records returned by Forge search.`,
            modelName: `${modelStem}SearchResults`,
            itemKind: input.itemKind,
            exampleValue: `[{"id":"...","title":"Example ${input.itemLabel}"}]`
        }),
        createOutputDefinition({
            key: "matchCount",
            label: "Match count",
            kind: "number",
            description: "Number of records returned by the search.",
            modelName: `${modelStem}SearchCount`,
            exampleValue: "12"
        })
    ];
}
export function createSearchInputs(input) {
    const modelStem = toPascalCase(input.itemKind);
    return [
        createInputDefinition({
            key: "query",
            label: "Query",
            kind: "text",
            description: `Search text for narrowing ${input.itemLabel.toLowerCase()} results.`,
            modelName: `${modelStem}SearchQuery`,
            exampleValue: "backlog"
        }),
        createInputDefinition({
            key: "entityTypes",
            label: "Entity types",
            kind: "array",
            description: "Entity types to include in the Forge search.",
            modelName: `${modelStem}SearchEntityTypes`,
            exampleValue: JSON.stringify(input.defaultEntityTypes ?? [input.itemKind])
        }),
        createInputDefinition({
            key: "limit",
            label: "Limit",
            kind: "number",
            description: "Maximum number of results to request.",
            modelName: `${modelStem}SearchLimit`,
            exampleValue: String(input.defaultLimit ?? 20)
        })
    ];
}
export function createSearchParams(input) {
    return [
        createParamDefinition({
            key: "query",
            label: "Default query",
            kind: "text",
            description: "Used when no query input edge is connected."
        }),
        createParamDefinition({
            key: "entityTypes",
            label: "Default entity types",
            kind: "array",
            description: "Used when no entity types input edge is connected. Enter a JSON array or comma-separated values."
        }),
        createParamDefinition({
            key: "limit",
            label: "Default limit",
            kind: "number",
            description: "Used when no limit input edge is connected."
        })
    ];
}
export function createContextOutput(input) {
    return createOutputDefinition({
        key: input.key,
        label: input.label,
        kind: "context",
        description: input.description,
        modelName: input.modelName,
        shape: input.shape,
        exampleValue: input.exampleValue
    });
}
export function createRecordListOutput(input) {
    return createOutputDefinition({
        key: input.key,
        label: input.label,
        kind: "record_list",
        description: input.description,
        modelName: input.modelName,
        itemKind: input.itemKind,
        exampleValue: input.exampleValue
    });
}
export function createSearchEntitiesTool(description) {
    return {
        key: "forge.search_entities",
        label: "Search Forge entities",
        description,
        accessMode: "read",
        argsSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search text to match against Forge entities." },
                entityTypes: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional entity types to narrow the search."
                },
                limit: {
                    type: "number",
                    description: "Maximum number of results to return."
                }
            }
        }
    };
}
export function createNoteTool(description) {
    return {
        key: "forge.create_note",
        label: "Create note",
        description,
        accessMode: "write",
        argsSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Title of the note to create." },
                summary: { type: "string", description: "Optional short summary for the note." },
                markdown: {
                    type: "string",
                    description: "Markdown content that should become the note body."
                }
            }
        }
    };
}
export function createTaskStatusTool(description) {
    return {
        key: "forge.update_task_status",
        label: "Move task",
        description,
        accessMode: "write",
        argsSchema: {
            type: "object",
            properties: {
                taskId: { type: "string", description: "Task id to update." },
                status: {
                    type: "string",
                    description: "New Forge task status.",
                    enum: ["backlog", "focus", "in_progress", "blocked", "done"]
                }
            }
        }
    };
}
