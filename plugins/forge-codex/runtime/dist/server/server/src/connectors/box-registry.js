import { getDatabase } from "../db.js";
import { getFitnessViewData, getSleepViewData } from "../health.js";
import { listMovementPlaces } from "../movement.js";
import { getInsightsPayload } from "../services/insights.js";
import { getWeeklyReviewPayload } from "../services/reviews.js";
import { createNote, listNotes } from "../repositories/notes.js";
import { updateTask } from "../repositories/tasks.js";
import { getOverviewContext } from "../services/context.js";
import { searchEntities } from "../services/entity-crud.js";
import { getWikiHealth, listWikiPages } from "../repositories/wiki-memory.js";
import { executeCommonWorkbenchTool, mapWorkbenchTools } from "../../../src/lib/workbench/runtime.js";
import { getWorkbenchNodeCatalog, getWorkbenchNodeDefinition } from "../../../src/lib/workbench/registry.js";
import { normalizeWorkbenchPortDefinition } from "../../../src/lib/workbench/nodes.js";
function createSnapshotForConnectorOutput(boxId) {
    const outputId = boxId.replace(/^connector-output:/, "");
    const rows = getDatabase()
        .prepare(`SELECT id, title, published_outputs_json, last_run_json FROM ai_connectors ORDER BY updated_at DESC`)
        .all();
    for (const row of rows) {
        const outputs = JSON.parse(row.published_outputs_json || "[]");
        const output = outputs.find((entry) => entry.id === outputId);
        if (!output) {
            continue;
        }
        const lastRun = row.last_run_json
            ? JSON.parse(row.last_run_json)
            : null;
        const published = lastRun?.result?.outputs?.[outputId] ?? null;
        return {
            boxId,
            label: output.label,
            capturedAt: new Date().toISOString(),
            contentText: published?.text ?? `${row.title}\nNo published output has been generated yet.`,
            contentJson: published?.json ?? null,
            tools: []
        };
    }
    return null;
}
function createRuntimeContext(input) {
    const services = {
        entities: {
            search: searchEntities
        },
        notes: {
            create: ((input) => createNote(input, {
                source: "agent",
                actor: "Workbench"
            })),
            list: listNotes
        },
        movement: {
            listPlaces: listMovementPlaces
        },
        health: {
            getSleepViewData: getSleepViewData,
            getFitnessViewData: getFitnessViewData
        },
        overview: {
            getContext: (() => getOverviewContext()),
            getWeeklyReview: (() => getWeeklyReviewPayload()),
            getInsights: (() => getInsightsPayload())
        },
        wiki: {
            listPages: ((input) => listWikiPages({
                spaceId: typeof input?.spaceId === "string" ? input.spaceId : undefined,
                kind: typeof input?.kind === "string" ? input.kind : undefined,
                limit: typeof input?.limit === "number" ? input.limit : undefined
            })),
            getHealth: (() => getWikiHealth())
        },
        tasks: {
            update: ((taskId, patch) => updateTask(taskId, patch, { source: "agent", actor: "Workbench" }))
        }
    };
    return {
        actor: input?.actor ?? { userIds: null, source: "api" },
        services,
        routeParams: input?.routeParams,
        filters: input?.filters,
        now: new Date().toISOString()
    };
}
function toCatalogEntry(definition) {
    if (!definition) {
        return null;
    }
    const toPortDefinition = (port) => normalizeWorkbenchPortDefinition({
        key: port.key,
        label: port.label,
        kind: port.kind,
        description: "description" in port ? port.description : undefined,
        required: port.required ?? false,
        expandableKeys: "expandableKeys" in port ? (port.expandableKeys ?? []) : [],
        modelName: "modelName" in port ? port.modelName : undefined,
        itemKind: "itemKind" in port ? port.itemKind : undefined,
        shape: "shape" in port
            ? (port.shape ?? []).map((field) => ({
                ...field,
                required: field.required ?? false
            }))
            : [],
        exampleValue: "exampleValue" in port ? port.exampleValue : undefined
    });
    return {
        id: definition.id,
        boxId: definition.id,
        surfaceId: definition.surfaceId,
        routePath: definition.routePath,
        title: definition.title,
        label: definition.title,
        icon: definition.icon ?? null,
        description: definition.description,
        category: definition.category,
        tags: definition.tags,
        capabilityModes: [
            "content",
            ...(definition.tools.length > 0 ? ["tool"] : [])
        ],
        inputs: definition.inputs.map(toPortDefinition),
        params: definition.params.map(toPortDefinition),
        output: definition.output.map(toPortDefinition),
        tools: definition.tools,
        outputs: definition.output.map(toPortDefinition),
        toolAdapters: definition.tools,
        snapshotResolverKey: undefined
    };
}
export function listForgeBoxCatalog() {
    return getWorkbenchNodeCatalog();
}
export function getForgeBoxCatalogEntry(boxId) {
    return toCatalogEntry(getWorkbenchNodeDefinition(boxId));
}
export function buildConnectorOutputCatalogEntry(input) {
    return {
        id: `connector-output:${input.outputId}`,
        boxId: `connector-output:${input.outputId}`,
        surfaceId: null,
        routePath: `/workbench/${input.connectorId}`,
        title: `${input.title} output`,
        label: `${input.title} output`,
        icon: null,
        description: "Published Workbench output.",
        category: "Workbench outputs",
        tags: ["workbench", "output"],
        capabilityModes: ["content"],
        inputs: [],
        params: [],
        output: [
            {
                key: input.outputId,
                label: "Published output",
                kind: "record",
                description: "Published output record exposed by this Workbench flow.",
                required: false,
                expandableKeys: [],
                shape: [],
                modelName: "WorkbenchPublishedOutput"
            }
        ],
        tools: [],
        outputs: [
            {
                key: input.outputId,
                label: "Published output",
                kind: "record",
                description: "Published output record exposed by this Workbench flow.",
                required: false,
                expandableKeys: [],
                shape: [],
                modelName: "WorkbenchPublishedOutput"
            }
        ],
        toolAdapters: []
    };
}
export function resolveForgeBoxSnapshot(boxId, contextInput, executionInput) {
    if (boxId.startsWith("connector-output:")) {
        return (createSnapshotForConnectorOutput(boxId) ?? {
            boxId,
            label: boxId,
            capturedAt: new Date().toISOString(),
            contentText: "This connector output has not been generated yet.",
            contentJson: null,
            tools: []
        });
    }
    const definition = getWorkbenchNodeDefinition(boxId);
    if (!definition) {
        return {
            boxId,
            label: boxId,
            capturedAt: new Date().toISOString(),
            contentText: "This Workbench node is not registered.",
            contentJson: null,
            tools: []
        };
    }
    const execution = definition.execute({
        nodeId: boxId,
        definition,
        inputs: executionInput?.inputs ?? {},
        params: executionInput?.params ?? {},
        context: createRuntimeContext(contextInput)
    });
    if (execution instanceof Promise) {
        throw new Error("Workbench box execution must be synchronous for snapshot resolution.");
    }
    return {
        boxId: definition.id,
        label: definition.title,
        capturedAt: new Date().toISOString(),
        contentText: execution.primaryText,
        contentJson: execution.payload,
        tools: mapWorkbenchTools(definition.tools)
    };
}
export function executeForgeBoxTool(boxId, toolKey, args, contextInput) {
    const definition = getWorkbenchNodeDefinition(boxId);
    if (!definition) {
        throw new Error(`Unknown Forge box: ${boxId}`);
    }
    return executeCommonWorkbenchTool(createRuntimeContext(contextInput), definition, toolKey, args);
}
