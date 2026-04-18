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
import type {
  ForgeBoxCatalogEntry,
  ForgeBoxSnapshot
} from "../types.js";
import {
  executeCommonWorkbenchTool,
  mapWorkbenchTools
} from "../../../src/lib/workbench/runtime.js";
import {
  getWorkbenchNodeCatalog,
  getWorkbenchNodeDefinition
} from "../../../src/lib/workbench/registry.js";
import type {
  WorkbenchInputDefinition,
  WorkbenchOutputDefinition,
  WorkbenchParamDefinition,
  WorkbenchRuntimeContext,
  WorkbenchRuntimeServices
} from "../../../src/lib/workbench/nodes.js";
import { normalizeWorkbenchPortDefinition } from "../../../src/lib/workbench/nodes.js";

function createSnapshotForConnectorOutput(boxId: string) {
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
      ? (JSON.parse(row.last_run_json) as {
          result?: {
            outputs?: Record<
              string,
              {
                text: string;
                json: Record<string, unknown> | null;
              }
            >;
          };
        })
      : null;
    const published = lastRun?.result?.outputs?.[outputId] ?? null;
    return {
      boxId,
      label: output.label,
      capturedAt: new Date().toISOString(),
      contentText:
        published?.text ?? `${row.title}\nNo published output has been generated yet.`,
      contentJson: published?.json ?? null,
      tools: []
    } satisfies ForgeBoxSnapshot;
  }
  return null;
}

export type ForgeWorkbenchRuntimeServices = WorkbenchRuntimeServices;
export type ForgeWorkbenchRuntimeContext = WorkbenchRuntimeContext;

function createRuntimeContext(input?: {
  actor?: ForgeWorkbenchRuntimeContext["actor"];
  routeParams?: Record<string, string>;
  filters?: Record<string, unknown>;
}): ForgeWorkbenchRuntimeContext {
  const services: ForgeWorkbenchRuntimeServices = {
    entities: {
      search: searchEntities as WorkbenchRuntimeServices["entities"]["search"]
    },
    notes: {
      create: ((input) =>
        createNote(input as Parameters<typeof createNote>[0], {
          source: "agent",
          actor: "Workbench"
        })) as WorkbenchRuntimeServices["notes"]["create"],
      list: listNotes as WorkbenchRuntimeServices["notes"]["list"]
    },
    movement: {
      listPlaces: listMovementPlaces as WorkbenchRuntimeServices["movement"]["listPlaces"]
    },
    health: {
      getSleepViewData: getSleepViewData as WorkbenchRuntimeServices["health"]["getSleepViewData"],
      getFitnessViewData: getFitnessViewData as WorkbenchRuntimeServices["health"]["getFitnessViewData"]
    },
    overview: {
      getContext: (() => getOverviewContext()) as WorkbenchRuntimeServices["overview"]["getContext"],
      getWeeklyReview:
        (() => getWeeklyReviewPayload()) as WorkbenchRuntimeServices["overview"]["getWeeklyReview"],
      getInsights:
        (() => getInsightsPayload()) as WorkbenchRuntimeServices["overview"]["getInsights"]
    },
    wiki: {
      listPages: ((input) =>
        listWikiPages({
          spaceId: typeof input?.spaceId === "string" ? input.spaceId : undefined,
          kind: typeof input?.kind === "string" ? (input.kind as any) : undefined,
          limit: typeof input?.limit === "number" ? input.limit : undefined
        })) as WorkbenchRuntimeServices["wiki"]["listPages"],
      getHealth: (() => getWikiHealth()) as WorkbenchRuntimeServices["wiki"]["getHealth"]
    },
    tasks: {
      update: ((taskId, patch) =>
        updateTask(
          taskId,
          patch as {
            status?: "backlog" | "focus" | "in_progress" | "blocked" | "done";
          },
          { source: "agent", actor: "Workbench" }
        )) as WorkbenchRuntimeServices["tasks"]["update"]
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

function toCatalogEntry(definition: ReturnType<typeof getWorkbenchNodeDefinition>) {
  if (!definition) {
    return null;
  }
  const toPortDefinition = (
    port: WorkbenchInputDefinition | WorkbenchParamDefinition | WorkbenchOutputDefinition
  ) =>
    normalizeWorkbenchPortDefinition({
      key: port.key,
      label: port.label,
      kind: port.kind,
      description: "description" in port ? port.description : undefined,
      required: port.required ?? false,
      expandableKeys: "expandableKeys" in port ? (port.expandableKeys ?? []) : [],
      modelName: "modelName" in port ? port.modelName : undefined,
      itemKind: "itemKind" in port ? port.itemKind : undefined,
      shape:
        "shape" in port
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
      ...(definition.tools.length > 0 ? ["tool" as const] : [])
    ],
    inputs: definition.inputs.map(toPortDefinition),
    params: definition.params.map(toPortDefinition),
    output: definition.output.map(toPortDefinition),
    tools: definition.tools,
    outputs: definition.output.map(toPortDefinition),
    toolAdapters: definition.tools,
    snapshotResolverKey: undefined
  } satisfies ForgeBoxCatalogEntry;
}

export function listForgeBoxCatalog() {
  return getWorkbenchNodeCatalog() as ForgeBoxCatalogEntry[];
}

export function getForgeBoxCatalogEntry(boxId: string) {
  return toCatalogEntry(getWorkbenchNodeDefinition(boxId));
}

export function buildConnectorOutputCatalogEntry(input: {
  connectorId: string;
  title: string;
  outputId: string;
}) {
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
  } satisfies ForgeBoxCatalogEntry;
}

export function resolveForgeBoxSnapshot(
  boxId: string,
  contextInput?: {
    actor?: ForgeWorkbenchRuntimeContext["actor"];
    routeParams?: Record<string, string>;
    filters?: Record<string, unknown>;
  },
  executionInput?: {
    inputs?: Record<string, unknown>;
    params?: Record<string, unknown>;
  }
) {
  if (boxId.startsWith("connector-output:")) {
    return (
      createSnapshotForConnectorOutput(boxId) ?? {
        boxId,
        label: boxId,
        capturedAt: new Date().toISOString(),
        contentText: "This connector output has not been generated yet.",
        contentJson: null,
        tools: []
      }
    );
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
    } satisfies ForgeBoxSnapshot;
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
    } satisfies ForgeBoxSnapshot;
}

export function executeForgeBoxTool(
  boxId: string,
  toolKey: string,
  args: Record<string, unknown>,
  contextInput?: {
    actor?: ForgeWorkbenchRuntimeContext["actor"];
    routeParams?: Record<string, string>;
    filters?: Record<string, unknown>;
  }
) {
  const definition = getWorkbenchNodeDefinition(boxId);
  if (!definition) {
    throw new Error(`Unknown Forge box: ${boxId}`);
  }
  return executeCommonWorkbenchTool(
    createRuntimeContext(contextInput),
    definition,
    toolKey,
    args
  );
}
