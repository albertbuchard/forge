import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  type TextPromptRunner,
  type WikiLlmProfileLike
} from "../managers/platform/llm-manager.js";
import {
  createAiConnectorSchema,
  aiConnectorOutputSchema,
  aiConnectorConversationSchema,
  aiConnectorRunResultSchema,
  aiConnectorRunSchema,
  aiConnectorSchema,
  restoreAiConnectorVersionSchema,
  runAiConnectorSchema,
  updateAiConnectorSchema,
  type AiConnector,
  type AiConnectorConversation,
  type AiConnectorEdge,
  type AiConnectorNode,
  type AiConnectorPublicInput,
  type AiConnectorRun,
  type AiConnectorRunResult,
  type CreateAiConnectorInput,
  type ForgeBoxPortDefinition,
  type RunAiConnectorInput,
  type UpdateAiConnectorInput
} from "../types.js";
import {
  FORGE_DEFAULT_AGENT_ID,
  getAiModelConnectionById,
  listAiModelConnections,
  readModelConnectionCredential
} from "./model-settings.js";
import {
  getAiProcessorById,
  listAiProcessorLinks,
  listAiProcessors
} from "./ai-processors.js";
import {
  buildConnectorOutputCatalogEntry,
  executeForgeBoxTool,
  resolveForgeBoxSnapshot
} from "../connectors/box-registry.js";
import {
  MAX_WORKBENCH_GRAPH_EDGES,
  MAX_WORKBENCH_GRAPH_NODES,
  normalizeWorkbenchPortDefinition
} from "@/lib/workbench/nodes.js";
import {
  buildWorkbenchNodeDetail,
  buildWorkbenchNodeSummary,
  buildWorkbenchOutputDetail,
  buildBoundedWorkbenchValue,
  buildWorkbenchRunDetail,
  buildWorkbenchRunSummary
} from "../services/workbench-read-model.js";
import type { MachineCapabilitySession } from "../security/capability-executor.js";
import { requireEnabledTool } from "../security/machine-tool-policy.js";

const MAX_TOOL_STEPS = 6;
const MAX_MODEL_PROMPT_CHARACTERS = 64_000;
const MAX_CONVERSATION_HISTORY_CHARACTERS = 20_000;
const MAX_LINKED_INPUT_CHARACTERS = 12_000;
const MAX_TOOL_TRANSCRIPT_CHARACTERS = 4_000;
export const MAX_AI_CONNECTOR_GRAPH_NODES = MAX_WORKBENCH_GRAPH_NODES;
export const MAX_AI_CONNECTOR_GRAPH_EDGES = MAX_WORKBENCH_GRAPH_EDGES;
export const DEFAULT_AI_CONNECTOR_RUN_HISTORY_LIMIT = 20;
export const MAX_AI_CONNECTOR_RUN_HISTORY_LIMIT = 100;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

type AiConnectorRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: "functor" | "chat";
  home_surface_id: string | null;
  endpoint_enabled: number;
  graph_json: string;
  public_inputs_json: string;
  published_outputs_json: string;
  last_run_json: string | null;
  legacy_processor_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

type AiConnectorVersionRow = {
  connector_id: string;
  revision: number;
  title: string;
  kind: "functor" | "chat";
  node_count: number;
  edge_count: number;
  public_input_count: number;
  published_output_count: number;
  snapshot_json: string;
  change_kind: "baseline" | "created" | "updated" | "restored";
  restored_from_revision: number | null;
  created_at: string;
};

type AiConnectorSnapshot = Pick<
  AiConnector,
  | "title"
  | "description"
  | "kind"
  | "homeSurfaceId"
  | "endpointEnabled"
  | "graph"
  | "publicInputs"
  | "publishedOutputs"
>;

export const DEFAULT_AI_CONNECTOR_VERSION_LIMIT = 20;
export const MAX_AI_CONNECTOR_VERSION_LIMIT = 50;
const MAX_RETAINED_AI_CONNECTOR_VERSIONS = 50;

type AiConnectorExecutionServices = {
  llm: TextPromptRunner;
  secrets: SecretsManager;
  machineCapabilities?: MachineCapabilitySession;
};

type AiConnectorRunRow = {
  id: string;
  connector_id: string;
  mode: "run" | "chat";
  status: "running" | "completed" | "failed";
  user_input: string;
  inputs_json: string;
  context_json: string;
  conversation_id: string | null;
  retry_of_run_id: string | null;
  flow_snapshot_json: string | null;
  flow_updated_at: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

type AiConnectorRunSummaryRow = Omit<
  AiConnectorRunRow,
  | "user_input"
  | "inputs_json"
  | "context_json"
  | "flow_snapshot_json"
  | "result_json"
> & {
  output_preview: string | null;
  has_result: number;
};

type AiConnectorNodeResultRow = {
  run_id: string;
  connector_id: string;
  node_id: string;
  node_type: string;
  label: string;
  result_json: string;
  created_at: string;
};

type AiConnectorConversationRow = {
  id: string;
  connector_id: string;
  provider: string | null;
  external_conversation_id: string | null;
  transcript_json: string;
  created_at: string;
  updated_at: string;
};

type ConnectorExecutionResult = {
  connector: AiConnector;
  run: AiConnectorRun;
  conversation: AiConnectorConversation | null;
};

type ConnectorNodeValue = {
  text: string;
  json: Record<string, unknown> | null;
  tools: Array<{
    boxId: string;
    key: string;
    label: string;
    description: string;
    argsSchema?: Record<string, unknown>;
  }>;
  conversationId: string | null;
  outputMap: Record<
    string,
    {
      text: string;
      json: Record<string, unknown> | null;
    }
  >;
  logs: string[];
};

type ConnectorDebugNode = {
  nodeId: string;
  nodeType: AiConnectorNode["type"];
  label: string;
  input: Array<{
    sourceNodeId: string;
    sourceHandle: string | null;
    targetHandle: string | null;
    text: string;
    json: Record<string, unknown> | null;
  }>;
  output: {
    text: string;
    json: Record<string, unknown> | null;
  };
  tools: string[];
  logs: string[];
  error: string | null;
};

type ConnectorResolvedInput = {
  sourceNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  text: string;
  json: Record<string, unknown> | null;
};

type ConnectorPublicBindingValue = {
  sourceNodeId: string;
  sourceHandle: string | null;
  targetHandle: string;
  text: string;
  json: Record<string, unknown> | null;
};

function parseJson<T>(value: string | null, fallback: T) {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function slugifySegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "connector";
}

function buildConnectorSlug(title: string, id: string) {
  return `${slugifySegment(title)}-${id.slice(-6)}`;
}

function normalizeBaseUrl(profile: WikiLlmProfileLike) {
  const trimmed = profile.baseUrl.trim();
  return trimmed.length > 0
    ? trimmed.replace(/\/$/, "")
    : DEFAULT_OPENAI_BASE_URL;
}

function isOpenAiFamily(profile: WikiLlmProfileLike) {
  return (
    profile.provider === "openai-api" ||
    profile.provider === "openai-compatible" ||
    profile.provider === "openai-codex"
  );
}

function isCodexProfile(profile: WikiLlmProfileLike) {
  return profile.provider === "openai-codex";
}

function extractCodexAccountId(accessToken: string) {
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Failed to extract accountId from OpenAI Codex token.");
  }
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8")
  ) as Record<string, unknown>;
  const auth = payload["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object") {
    throw new Error("Failed to extract accountId from OpenAI Codex token.");
  }
  const accountId = (auth as { chatgpt_account_id?: unknown })
    .chatgpt_account_id;
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    throw new Error("Failed to extract accountId from OpenAI Codex token.");
  }
  return accountId;
}

function buildRequestHeaders(profile: WikiLlmProfileLike, apiKey: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  };
  if (!isCodexProfile(profile)) {
    return headers;
  }
  headers["OpenAI-Beta"] = "responses=experimental";
  headers.originator = "pi";
  headers["chatgpt-account-id"] = extractCodexAccountId(apiKey);
  return headers;
}

function buildResponsesUrl(profile: WikiLlmProfileLike) {
  const baseUrl = normalizeBaseUrl(profile);
  if (isCodexProfile(profile)) {
    if (baseUrl.endsWith("/codex/responses")) {
      return baseUrl;
    }
    if (baseUrl.endsWith("/codex")) {
      return `${baseUrl}/responses`;
    }
    return `${baseUrl}/codex/responses`;
  }
  return baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`;
}

function buildConversationsUrl(profile: WikiLlmProfileLike) {
  const baseUrl = normalizeBaseUrl(profile);
  if (isCodexProfile(profile)) {
    if (baseUrl.endsWith("/codex")) {
      return `${baseUrl}/conversations`;
    }
    if (baseUrl.endsWith("/codex/responses")) {
      return baseUrl.replace(/\/responses$/, "/conversations");
    }
    return `${baseUrl}/codex/conversations`;
  }
  return baseUrl.endsWith("/v1")
    ? `${baseUrl}/conversations`
    : `${baseUrl}/conversations`;
}

function parseOutputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content?: unknown }).content as Array<unknown>)
      : [];
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function buildDefaultGraph(kind: "functor" | "chat", title: string) {
  const modelNodeId = "node_model";
  const outputNodeId = "node_output";
  return {
    nodes: [
      {
        id: "node_input",
        type: "user_input",
        position: { x: 60, y: 160 },
        data: {
          label: "User input",
          description: "Manual runtime input.",
          enabledToolKeys: []
        }
      },
      {
        id: modelNodeId,
        type: kind === "chat" ? "chat" : "functor",
        position: { x: 340, y: 150 },
        data: {
          label: title,
          description:
            kind === "chat" ? "Chat connector node." : "Functor node.",
          prompt:
            kind === "chat"
              ? "Respond helpfully using the linked inputs and available tools."
              : "Transform the linked inputs and return the best final answer.",
          systemPrompt: "",
          enabledToolKeys: [],
          modelConfig: {
            connectionId: null,
            provider: null,
            baseUrl: null,
            model: "",
            thinking: null,
            verbosity: null
          }
        }
      },
      {
        id: outputNodeId,
        type: "output",
        position: { x: 660, y: 150 },
        data: {
          label: "Output",
          description: "Published connector output.",
          outputKey: "answer",
          enabledToolKeys: []
        }
      }
    ],
    edges: [
      {
        id: "edge_input_model",
        source: "node_input",
        target: modelNodeId
      },
      {
        id: "edge_model_output",
        source: modelNodeId,
        target: outputNodeId
      }
    ]
  } satisfies AiConnector["graph"];
}

function ensurePublishedOutputs(
  connectorId: string,
  graph: AiConnector["graph"]
) {
  const outputNodes = graph.nodes.filter((node) => node.type === "output");
  if (outputNodes.length === 0) {
    return [
      buildConnectorOutputCatalogEntry({
        connectorId,
        title: "Connector",
        outputId: "answer"
      })
    ].map((entry) => ({
      id: entry.id.replace(/^connector-output:/, ""),
      nodeId: "node_output",
      label: entry.title,
      apiPath: `/api/v1/workbench/flows/${connectorId}/output`
    }));
  }
  return outputNodes.map((node, index) => ({
    id: `${connectorId}_out_${index + 1}`,
    nodeId: node.id,
    label: node.data.label || `Output ${index + 1}`,
    apiPath: `/api/v1/workbench/flows/${connectorId}/output`
  }));
}

function mapRun(row: AiConnectorRunRow): AiConnectorRun {
  return aiConnectorRunSchema.parse({
    id: row.id,
    connectorId: row.connector_id,
    mode: row.mode,
    status: row.status,
    userInput: row.user_input,
    inputs: parseJson(row.inputs_json, {}),
    context: parseJson(row.context_json, {}),
    conversationId: row.conversation_id,
    retryOfRunId: row.retry_of_run_id,
    flowSnapshot: parseJson(row.flow_snapshot_json, null),
    result: parseJson(row.result_json, null),
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at
  });
}

function buildWorkbenchRunSummaryFromRun(run: AiConnectorRun) {
  return buildWorkbenchRunSummary({
    id: run.id,
    connectorId: run.connectorId,
    mode: run.mode,
    status: run.status,
    conversationId: run.conversationId,
    retryOfRunId: run.retryOfRunId,
    outputPreview: run.result?.primaryText ?? null,
    hasResult: run.result !== null,
    error: run.error,
    flowUpdatedAt: run.flowSnapshot?.updatedAt ?? null,
    createdAt: run.createdAt,
    completedAt: run.completedAt
  });
}

function buildWorkbenchRunSummaryFromRow(row: AiConnectorRunRow) {
  return buildWorkbenchRunSummaryFromRun(mapRun(row));
}

function mapConversation(
  row: AiConnectorConversationRow
): AiConnectorConversation {
  return aiConnectorConversationSchema.parse({
    id: row.id,
    connectorId: row.connector_id,
    provider: row.provider,
    externalConversationId: row.external_conversation_id,
    transcript: parseJson(row.transcript_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapConnector(row: AiConnectorRow): AiConnector {
  const rawGraph = parseJson(row.graph_json, { nodes: [], edges: [] });
  const normalizedGraph = normalizeConnectorGraph(rawGraph);
  return aiConnectorSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    kind: row.kind,
    homeSurfaceId: row.home_surface_id,
    endpointEnabled: row.endpoint_enabled === 1,
    graph: normalizedGraph,
    publicInputs: parseJson(row.public_inputs_json, []),
    publishedOutputs: parseJson(row.published_outputs_json, []),
    lastRun: buildConnectorLastRunSummary(parseJson(row.last_run_json, null)),
    legacyProcessorId: row.legacy_processor_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function connectorSnapshot(connector: AiConnector): AiConnectorSnapshot {
  return {
    title: connector.title,
    description: connector.description,
    kind: connector.kind,
    homeSurfaceId: connector.homeSurfaceId,
    endpointEnabled: connector.endpointEnabled,
    graph: connector.graph,
    publicInputs: connector.publicInputs,
    publishedOutputs: connector.publishedOutputs
  };
}

function parseConnectorSnapshot(value: string): AiConnectorSnapshot {
  const parsed = JSON.parse(value) as AiConnectorSnapshot;
  const currentShape = createAiConnectorSchema.parse(parsed);
  return {
    title: currentShape.title,
    description: currentShape.description,
    kind: currentShape.kind,
    homeSurfaceId: currentShape.homeSurfaceId,
    endpointEnabled: currentShape.endpointEnabled,
    graph: normalizeConnectorGraph(currentShape.graph),
    publicInputs: currentShape.publicInputs,
    publishedOutputs: aiConnectorOutputSchema
      .array()
      .parse(parsed.publishedOutputs)
  };
}

function insertConnectorVersion(
  connector: AiConnector,
  changeKind: AiConnectorVersionRow["change_kind"],
  restoredFromRevision: number | null = null
) {
  getDatabase()
    .prepare(
      `INSERT INTO ai_connector_versions (
         connector_id, revision, title, kind, node_count, edge_count,
         public_input_count, published_output_count, snapshot_json,
         change_kind, restored_from_revision, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      connector.id,
      connector.revision,
      connector.title,
      connector.kind,
      connector.graph.nodes.length,
      connector.graph.edges.length,
      connector.publicInputs.length,
      connector.publishedOutputs.length,
      JSON.stringify(connectorSnapshot(connector)),
      changeKind,
      restoredFromRevision,
      connector.updatedAt
    );
  getDatabase()
    .prepare(
      `DELETE FROM ai_connector_versions
       WHERE connector_id = ?
         AND revision NOT IN (
           SELECT revision
           FROM ai_connector_versions
           WHERE connector_id = ?
           ORDER BY revision DESC
           LIMIT ?
         )`
    )
    .run(connector.id, connector.id, MAX_RETAINED_AI_CONNECTOR_VERSIONS);
}

function connectorVersionSummary(row: AiConnectorVersionRow) {
  return {
    connectorId: row.connector_id,
    revision: row.revision,
    changeKind: row.change_kind,
    restoredFromRevision: row.restored_from_revision,
    title: row.title,
    kind: row.kind,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    publicInputCount: row.public_input_count,
    publishedOutputCount: row.published_output_count,
    createdAt: row.created_at
  };
}

function buildConnectorLastRunSummary(run: AiConnectorRun | null) {
  if (!run) {
    return null;
  }
  const outputPreview = buildBoundedWorkbenchValue(
    run.result?.primaryText ?? "",
    {
      maxArrayItems: 1,
      maxDepth: 1,
      maxObjectKeys: 1,
      maxStringLength: 320
    }
  ).value;
  return aiConnectorRunSchema.parse({
    ...run,
    userInput: "",
    inputs: {},
    context: {},
    flowSnapshot: null,
    result: run.result
      ? {
          primaryText: outputPreview,
          outputs: {},
          nodeResults: []
        }
      : null,
    error: run.error
      ? buildBoundedWorkbenchValue(run.error, {
          maxArrayItems: 1,
          maxDepth: 1,
          maxObjectKeys: 1,
          maxStringLength: 500
        }).value
      : null
  });
}

export function listAiConnectorRunsPage(
  connectorId: string,
  input: { limit?: number; offset?: number } = {}
) {
  const limit = Math.min(
    MAX_AI_CONNECTOR_RUN_HISTORY_LIMIT,
    Math.max(
      1,
      Math.trunc(input.limit ?? DEFAULT_AI_CONNECTOR_RUN_HISTORY_LIMIT)
    )
  );
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const total = (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ai_connector_runs
         WHERE connector_id = ?`
      )
      .get(connectorId) as { count: number }
  ).count;
  const rows = getDatabase()
    .prepare(
      `SELECT id, connector_id, mode, status, conversation_id,
              retry_of_run_id, flow_updated_at, error, created_at, completed_at,
              CASE WHEN result_json IS NULL THEN 0 ELSE 1 END AS has_result,
              substr(json_extract(result_json, '$.primaryText'), 1, 321) AS output_preview
       FROM ai_connector_runs
       WHERE connector_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(connectorId, limit, offset) as AiConnectorRunSummaryRow[];
  const runs = rows.map((row) =>
    buildWorkbenchRunSummary({
      id: row.id,
      connectorId: row.connector_id,
      mode: row.mode,
      status: row.status,
      conversationId: row.conversation_id,
      retryOfRunId: row.retry_of_run_id,
      outputPreview: row.output_preview,
      hasResult: row.has_result === 1,
      error: row.error,
      flowUpdatedAt: row.flow_updated_at,
      createdAt: row.created_at,
      completedAt: row.completed_at
    })
  );
  return {
    runs,
    total,
    limit,
    offset,
    hasMore: offset + runs.length < total
  };
}

export function listAiConnectorRuns(
  connectorId: string,
  input: { limit?: number; offset?: number } = {}
) {
  return listAiConnectorRunsPage(connectorId, input).runs;
}

export function getAiConnectorRunById(connectorId: string, runId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM ai_connector_runs WHERE connector_id = ? AND id = ?`
    )
    .get(connectorId, runId) as AiConnectorRunRow | undefined;
  return row ? mapRun(row) : null;
}

export function getAiConnectorRunDetail(connectorId: string, runId: string) {
  const run = getAiConnectorRunById(connectorId, runId);
  return run ? buildWorkbenchRunDetail(run) : null;
}

export function getAiConnectorRunNodeResults(
  connectorId: string,
  runId: string
) {
  const run = getAiConnectorRunById(connectorId, runId);
  if (!run) {
    return null;
  }
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM ai_connector_node_results
       WHERE connector_id = ? AND run_id = ?
       ORDER BY rowid ASC`
    )
    .all(connectorId, runId) as AiConnectorNodeResultRow[];
  const nodeResults =
    rows.length > 0
      ? rows.map((row) => parseJson(row.result_json, null)).filter(Boolean)
      : (run.result?.nodeResults ?? []);
  return nodeResults.map((nodeResult) =>
    buildWorkbenchNodeSummary(
      nodeResult as AiConnectorRunResult["nodeResults"][number]
    )
  );
}

export function getAiConnectorRunNodeResult(
  connectorId: string,
  runId: string,
  nodeId: string
) {
  const run = getAiConnectorRunById(connectorId, runId);
  if (!run) {
    return null;
  }
  const row = getDatabase()
    .prepare(
      `SELECT * FROM ai_connector_node_results
       WHERE connector_id = ? AND run_id = ? AND node_id = ?`
    )
    .get(connectorId, runId, nodeId) as AiConnectorNodeResultRow | undefined;
  const nodeResult = row
    ? parseJson(row.result_json, null)
    : (run.result?.nodeResults.find((entry) => entry.nodeId === nodeId) ??
      null);
  return nodeResult
    ? buildWorkbenchNodeDetail(
        nodeResult as AiConnectorRunResult["nodeResults"][number]
      )
    : null;
}

export function getLatestAiConnectorNodeOutput(
  connectorId: string,
  nodeId: string
) {
  const connector = getAiConnectorById(connectorId);
  if (!connector) {
    return null;
  }
  const latestRunRow = getDatabase()
    .prepare(
      `SELECT * FROM ai_connector_runs
       WHERE connector_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(connectorId) as AiConnectorRunRow | undefined;
  const nodeRow = getDatabase()
    .prepare(
      `SELECT * FROM ai_connector_node_results
       WHERE connector_id = ? AND node_id = ?
       ORDER BY created_at DESC, run_id DESC
       LIMIT 1`
    )
    .get(connectorId, nodeId) as AiConnectorNodeResultRow | undefined;
  let sourceRun = nodeRow
    ? getAiConnectorRunById(connectorId, nodeRow.run_id)
    : null;
  let rawNodeResult: AiConnectorRunResult["nodeResults"][number] | null =
    nodeRow
      ? parseJson<AiConnectorRunResult["nodeResults"][number] | null>(
          nodeRow.result_json,
          null
        )
      : null;
  if (!sourceRun || !rawNodeResult) {
    const legacyRows = getDatabase()
      .prepare(
        `SELECT * FROM ai_connector_runs
         WHERE connector_id = ? AND status = 'completed' AND result_json IS NOT NULL
         ORDER BY created_at DESC, id DESC`
      )
      .all(connectorId) as AiConnectorRunRow[];
    for (const row of legacyRows) {
      const candidate = mapRun(row);
      const candidateResult = candidate.result?.nodeResults.find(
        (entry) => entry.nodeId === nodeId
      );
      if (candidateResult) {
        sourceRun = candidate;
        rawNodeResult = candidateResult;
        break;
      }
    }
  }
  const nodeExistsInCurrentFlow = connector.graph.nodes.some(
    (node) => node.id === nodeId
  );
  if (!sourceRun || !rawNodeResult) {
    return {
      state: "no_output" as const,
      stale: false,
      nodeExistsInCurrentFlow,
      latestRun: latestRunRow
        ? buildWorkbenchRunSummaryFromRow(latestRunRow)
        : null,
      run: null,
      nodeResult: null,
      readMetadata: null
    };
  }
  const detail = buildWorkbenchNodeDetail(
    rawNodeResult as AiConnectorRunResult["nodeResults"][number]
  );
  const stale =
    !nodeExistsInCurrentFlow ||
    sourceRun.flowSnapshot?.updatedAt !== connector.updatedAt;
  return {
    state: stale ? ("stale" as const) : ("available" as const),
    stale,
    nodeExistsInCurrentFlow,
    latestRun: latestRunRow
      ? buildWorkbenchRunSummaryFromRow(latestRunRow)
      : null,
    run: buildWorkbenchRunSummaryFromRun(sourceRun),
    nodeResult: detail.nodeResult,
    readMetadata: detail.readMetadata
  };
}

export function getPublishedAiConnectorOutput(connectorId: string) {
  const connector = getAiConnectorById(connectorId);
  if (!connector) {
    return null;
  }
  const latestRunRow = getDatabase()
    .prepare(
      `SELECT * FROM ai_connector_runs
       WHERE connector_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(connectorId) as AiConnectorRunRow | undefined;
  const publishedRow = getDatabase()
    .prepare(
      `SELECT * FROM ai_connector_runs
       WHERE connector_id = ? AND status = 'completed' AND result_json IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(connectorId) as AiConnectorRunRow | undefined;
  if (!publishedRow) {
    return {
      state: "no_output" as const,
      stale: false,
      latestRun: latestRunRow
        ? buildWorkbenchRunSummaryFromRow(latestRunRow)
        : null,
      sourceRun: null,
      output: null,
      readMetadata: null
    };
  }
  const sourceRun = mapRun(publishedRow);
  if (!sourceRun.result) {
    throw new Error(`Workbench run ${sourceRun.id} has no persisted result.`);
  }
  const detail = buildWorkbenchOutputDetail(sourceRun.result);
  const stale = sourceRun.flowSnapshot?.updatedAt !== connector.updatedAt;
  return {
    state: stale ? ("stale" as const) : ("current" as const),
    stale,
    latestRun: latestRunRow
      ? buildWorkbenchRunSummaryFromRow(latestRunRow)
      : null,
    sourceRun: buildWorkbenchRunSummaryFromRun(sourceRun),
    output: detail.output,
    readMetadata: detail.readMetadata
  };
}

export function getAiConnectorConversationById(conversationId: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM ai_connector_conversations WHERE id = ?`)
    .get(conversationId) as AiConnectorConversationRow | undefined;
  return row ? mapConversation(row) : null;
}

export function getAiConnectorConversationForConnector(connectorId: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM ai_connector_conversations WHERE connector_id = ?`)
    .get(connectorId) as AiConnectorConversationRow | undefined;
  return row ? mapConversation(row) : null;
}

export function getAiConnectorConversationReadModel(connectorId: string) {
  const conversation = getAiConnectorConversationForConnector(connectorId);
  if (!conversation) {
    return null;
  }
  const retainedTranscript = conversation.transcript.slice(-20);
  const bounded = buildBoundedWorkbenchValue(retainedTranscript, {
    maxArrayItems: 20,
    maxDepth: 4,
    maxObjectKeys: 10,
    maxStringLength: 8_000
  });
  return {
    ...conversation,
    transcript: bounded.value,
    transcriptTotal: conversation.transcript.length,
    transcriptHasMore:
      conversation.transcript.length > retainedTranscript.length,
    readMetadata: bounded.metadata
  };
}

function saveAiConnectorConversation(input: AiConnectorConversation) {
  getDatabase()
    .prepare(
      `INSERT INTO ai_connector_conversations (
        id, connector_id, provider, external_conversation_id, transcript_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id) DO UPDATE SET
        provider = excluded.provider,
        external_conversation_id = excluded.external_conversation_id,
        transcript_json = excluded.transcript_json,
        updated_at = excluded.updated_at`
    )
    .run(
      input.id,
      input.connectorId,
      input.provider,
      input.externalConversationId,
      JSON.stringify(input.transcript),
      input.createdAt,
      input.updatedAt
    );
  return getAiConnectorConversationById(input.id)!;
}

function updateConnectorLastRun(connectorId: string, run: AiConnectorRun) {
  getDatabase()
    .prepare(`UPDATE ai_connectors SET last_run_json = ? WHERE id = ?`)
    .run(JSON.stringify(buildConnectorLastRunSummary(run)), connectorId);
}

function insertRun(input: AiConnectorRun) {
  const database = getDatabase();
  runInTransaction(() => {
    database
      .prepare(
        `INSERT INTO ai_connector_runs (
        id, connector_id, mode, status, user_input, inputs_json, context_json,
        conversation_id, retry_of_run_id, flow_snapshot_json, flow_updated_at,
        result_json, error, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        connector_id = excluded.connector_id,
        mode = excluded.mode,
        status = excluded.status,
        user_input = excluded.user_input,
        inputs_json = excluded.inputs_json,
        context_json = excluded.context_json,
        conversation_id = excluded.conversation_id,
        retry_of_run_id = excluded.retry_of_run_id,
        flow_snapshot_json = excluded.flow_snapshot_json,
        flow_updated_at = excluded.flow_updated_at,
        result_json = excluded.result_json,
        error = excluded.error,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at`
      )
      .run(
        input.id,
        input.connectorId,
        input.mode,
        input.status,
        input.userInput,
        JSON.stringify(input.inputs),
        JSON.stringify(input.context),
        input.conversationId,
        input.retryOfRunId,
        input.flowSnapshot ? JSON.stringify(input.flowSnapshot) : null,
        input.flowSnapshot?.updatedAt ?? null,
        input.result ? JSON.stringify(input.result) : null,
        input.error,
        input.createdAt,
        input.completedAt
      );
    if (input.result) {
      const insertNodeResult = database.prepare(
        `INSERT INTO ai_connector_node_results (
          run_id, connector_id, node_id, node_type, label, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, node_id) DO UPDATE SET
          connector_id = excluded.connector_id,
          node_type = excluded.node_type,
          label = excluded.label,
          result_json = excluded.result_json,
          created_at = excluded.created_at`
      );
      for (const nodeResult of input.result.nodeResults) {
        insertNodeResult.run(
          input.id,
          input.connectorId,
          nodeResult.nodeId,
          nodeResult.nodeType,
          nodeResult.label,
          JSON.stringify(nodeResult),
          input.completedAt ?? input.createdAt
        );
      }
    }
    updateConnectorLastRun(input.connectorId, input);
  });
  return input;
}

function tryParseStructuredAgentResponse(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const action = (parsed as { action?: unknown }).action;
    if (action === "final") {
      const text = (parsed as { text?: unknown }).text;
      return {
        action,
        text: typeof text === "string" ? text : value
      } as const;
    }
    if (action === "tool") {
      const tool = (parsed as { tool?: unknown }).tool;
      const args = (parsed as { args?: unknown }).args;
      if (typeof tool !== "string" || tool.trim().length === 0) {
        return null;
      }
      return {
        action,
        tool,
        args:
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {}
      } as const;
    }
    return null;
  } catch {
    return null;
  }
}

function tryParseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function coerceText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function coerceJsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validatePortValueType(
  port: Pick<ForgeBoxPortDefinition, "kind" | "label" | "key">,
  value: unknown
) {
  switch (port.kind) {
    case "text":
    case "markdown":
    case "summary":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
    case "entity_list":
    case "record_list":
      return Array.isArray(value);
    case "object":
    case "json":
    case "record":
    case "context":
    case "filters":
    case "metrics":
    case "timeline":
    case "selection":
    case "entity":
      return Boolean(value) && typeof value === "object";
    default:
      return true;
  }
}

function normalizePublicInputBindings(
  connector: AiConnector,
  publicInput: AiConnectorPublicInput
) {
  if (publicInput.bindings.length > 0) {
    return publicInput.bindings;
  }
  return connector.graph.nodes.flatMap((node) => {
    const inputs = defaultInputsForNode(node);
    const params = node.data.params ?? [];
    const matches: AiConnectorPublicInput["bindings"] = [];
    if (inputs.some((entry) => entry.key === publicInput.key)) {
      matches.push({
        nodeId: node.id,
        targetKey: publicInput.key,
        targetKind: "input"
      });
    }
    if (params.some((entry) => entry.key === publicInput.key)) {
      matches.push({
        nodeId: node.id,
        targetKey: publicInput.key,
        targetKind: "param"
      });
    }
    return matches;
  });
}

function buildPublicInputValue(
  publicInput: AiConnectorPublicInput,
  value: unknown
): ConnectorPublicBindingValue {
  return {
    sourceNodeId: `flow_input:${publicInput.key}`,
    sourceHandle: publicInput.key,
    targetHandle: publicInput.key,
    text: coerceText(value),
    json: coerceJsonObject(value)
  };
}

function buildOutputMap(
  primaryText: string,
  primaryJson: Record<string, unknown> | null,
  outputs: Array<Pick<ForgeBoxPortDefinition, "key">> = []
) {
  const outputMap: ConnectorNodeValue["outputMap"] = {};
  const declaredOutputs = outputs.length > 0 ? outputs : [{ key: "summary" }];
  declaredOutputs.forEach((output, index) => {
    const value =
      primaryJson && output.key in primaryJson
        ? primaryJson[output.key]
        : index === 0 || output.key === "summary"
          ? primaryText
          : null;
    outputMap[output.key] = {
      text: coerceText(value),
      json:
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null
    };
  });
  return outputMap;
}

function readOutputSelection(
  value: ConnectorNodeValue,
  handle: string | null | undefined
) {
  if (!handle) {
    const lead = Object.values(value.outputMap)[0];
    return lead ?? { text: value.text, json: value.json };
  }
  const selected = value.outputMap[handle];
  if (selected) {
    return selected;
  }
  if (value.json && handle in value.json) {
    const raw = value.json[handle];
    return {
      text: coerceText(raw),
      json:
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null
    };
  }
  return { text: value.text, json: value.json };
}

function defaultOutputsForNode(
  node: AiConnectorNode
): ForgeBoxPortDefinition[] {
  if (node.data.outputs?.length) {
    return node.data.outputs.map((port) =>
      normalizeWorkbenchPortDefinition(port)
    );
  }
  const port = (definition: {
    key: string;
    label: string;
    kind: ForgeBoxPortDefinition["kind"];
  }) =>
    normalizeWorkbenchPortDefinition({
      ...definition,
      required: false,
      expandableKeys: [],
      shape: []
    });
  switch (node.type) {
    case "user_input":
      return [port({ key: "message", label: "Message", kind: "text" })];
    case "value":
      return [port({ key: "value", label: "Value", kind: "record" })];
    case "merge":
      return [
        port({ key: "merged", label: "Merged context", kind: "context" })
      ];
    case "template":
      return [
        port({ key: "rendered", label: "Rendered output", kind: "markdown" })
      ];
    case "pick_key":
      return [
        port({ key: "selected", label: "Selected value", kind: "record" })
      ];
    case "functor":
    case "chat":
      return [port({ key: "answer", label: "Answer", kind: "markdown" })];
    case "output":
      return [
        port({
          key: node.data.outputKey?.trim() || "result",
          label: "Published result",
          kind: "record"
        })
      ];
    case "box":
    case "box_input":
      return [port({ key: "summary", label: "Summary", kind: "summary" })];
  }
}

function defaultInputsForNode(node: AiConnectorNode): ForgeBoxPortDefinition[] {
  if (node.data.inputs?.length) {
    return node.data.inputs.map((port) =>
      normalizeWorkbenchPortDefinition(port)
    );
  }
  const port = (definition: {
    key: string;
    label: string;
    kind: ForgeBoxPortDefinition["kind"];
  }) =>
    normalizeWorkbenchPortDefinition({
      ...definition,
      required: false,
      expandableKeys: [],
      shape: []
    });
  switch (node.type) {
    case "functor":
    case "chat":
      return [port({ key: "input", label: "Flow input", kind: "context" })];
    case "merge":
      return [
        port({ key: "left", label: "Left input", kind: "context" }),
        port({ key: "right", label: "Right input", kind: "context" })
      ];
    case "template":
      return [port({ key: "input", label: "Template input", kind: "context" })];
    case "pick_key":
      return [port({ key: "object", label: "Source object", kind: "object" })];
    case "output":
      return [
        port({ key: "result", label: "Published result", kind: "record" })
      ];
    default:
      return [];
  }
}

function normalizeConnectorNodeContracts(node: AiConnectorNode) {
  const normalizePorts = (
    ports: ForgeBoxPortDefinition[],
    direction: "input" | "output"
  ) =>
    ports.map((port) => {
      const normalized = normalizeWorkbenchPortDefinition(port);
      if (normalized.key !== "primary") {
        return normalized;
      }
      const nextKey =
        direction === "output"
          ? node.type === "functor" || node.type === "chat"
            ? "answer"
            : node.type === "box" || node.type === "box_input"
              ? "summary"
              : node.type === "value"
                ? "value"
                : node.type === "merge"
                  ? "merged"
                  : node.type === "template"
                    ? "rendered"
                    : node.type === "pick_key"
                      ? "selected"
                      : "result"
          : node.type === "functor" || node.type === "chat"
            ? "input"
            : node.type === "output"
              ? "result"
              : normalized.key;
      return normalizeWorkbenchPortDefinition({
        ...normalized,
        key: nextKey,
        kind: nextKey === normalized.key ? normalized.kind : undefined
      });
    });
  const normalizedInputs = normalizePorts(
    defaultInputsForNode(node).length > 0
      ? defaultInputsForNode(node)
      : (node.data.inputs ?? []),
    "input"
  );
  const normalizedOutputs = defaultOutputsForNode({
    ...node,
    data: {
      ...node.data,
      outputs: normalizePorts(node.data.outputs ?? [], "output")
    }
  });
  const normalizedOutputKey = (() => {
    const current = node.data.outputKey?.trim();
    if (!current || current === "primary") {
      return normalizedOutputs[0]?.key ?? "";
    }
    if (normalizedOutputs.some((output) => output.key === current)) {
      return current;
    }
    return normalizedOutputs[0]?.key ?? current;
  })();
  return {
    ...node,
    data: {
      ...node.data,
      inputs: normalizedInputs,
      outputs: normalizedOutputs,
      outputKey: normalizedOutputKey
    }
  } satisfies AiConnectorNode;
}

function canonicalEdgeHandle(
  handle: string | null | undefined,
  ports: ForgeBoxPortDefinition[],
  preferred?: string
) {
  if (ports.length === 0) {
    return handle && handle !== "primary" ? handle : null;
  }
  if (!handle) {
    return ports.length === 1 ? (ports[0]?.key ?? null) : null;
  }
  if (handle === "primary") {
    if (preferred && ports.some((port) => port.key === preferred)) {
      return preferred;
    }
    return ports[0]?.key ?? null;
  }
  // Preserve explicit handles even when the current contract does not expose
  // them. Validation must reject stale or invented handles rather than
  // silently rerouting an edge to the first available port.
  return handle;
}

function normalizeConnectorGraph(graph: AiConnector["graph"]) {
  const normalizedNodes = graph.nodes.map((node) =>
    normalizeConnectorNodeContracts(node)
  );
  const nodeMap = new Map(normalizedNodes.map((node) => [node.id, node]));
  const normalizedEdges = graph.edges.map((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    return {
      ...edge,
      sourceHandle: canonicalEdgeHandle(
        edge.sourceHandle,
        sourceNode?.data.outputs ?? [],
        sourceNode?.data.outputs?.[0]?.key
      ),
      targetHandle: canonicalEdgeHandle(
        edge.targetHandle,
        targetNode?.data.inputs ?? [],
        targetNode?.data.inputs?.[0]?.key
      )
    } satisfies AiConnectorEdge;
  });
  return {
    nodes: normalizedNodes,
    edges: normalizedEdges
  };
}

async function executeMachineTool(
  tool: "machine_read_file" | "machine_write_file" | "machine_exec",
  args: Record<string, unknown>,
  capabilities: MachineCapabilitySession | undefined
) {
  if (!capabilities) {
    throw new Error(
      "Machine capabilities require a verified Forge capability session."
    );
  }
  if (tool === "machine_read_file") {
    const targetPath = typeof args.path === "string" ? args.path : null;
    if (!targetPath) {
      throw new Error("machine_read_file requires a string path.");
    }
    const content = await capabilities.readTextFile(targetPath);
    return { path: targetPath, content };
  }
  if (tool === "machine_write_file") {
    const targetPath = typeof args.path === "string" ? args.path : null;
    if (!targetPath || typeof args.content !== "string") {
      throw new Error("machine_write_file requires { path, content }.");
    }
    return capabilities.writeTextFile(targetPath, args.content);
  }
  if (typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new Error("machine_exec requires a command string.");
  }
  const cwd =
    typeof args.cwd === "string" && args.cwd.trim().length > 0 ? args.cwd : ".";
  const result = await capabilities.executeCommand({
    command: args.command,
    cwd,
    maximumRuntimeMilliseconds: 15_000,
    maximumOutputBytes: 256_000
  });
  return {
    cwd,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    exitCode: result.exitCode,
    truncated: result.truncated
  };
}

function getConversationBasePrompt(input: {
  connector: AiConnector;
  node: AiConnectorNode;
  userInput: string;
  upstream: Array<ConnectorNodeValue & { targetHandle?: string | null }>;
  transcript: string[];
  conversation: AiConnectorConversation | null;
}) {
  const truncate = (value: string, maxCharacters: number, keepTail = false) => {
    if (value.length <= maxCharacters) {
      return value;
    }
    return keepTail
      ? `[earlier content omitted]\n${value.slice(-maxCharacters)}`
      : `${value.slice(0, maxCharacters)}\n[later content omitted]`;
  };
  const conversationHistory =
    input.conversation &&
    input.node.type === "chat" &&
    input.conversation.transcript.length > 0
      ? truncate(
          input.conversation.transcript
            .map((entry) => `${entry.role}: ${entry.text}`)
            .join("\n"),
          MAX_CONVERSATION_HISTORY_CHARACTERS,
          true
        )
      : "";
  const linkedInputs = truncate(
    input.upstream
      .map((entry, index) => {
        const boundedJson = entry.json
          ? buildBoundedWorkbenchValue(entry.json, {
              maxArrayItems: 100,
              maxDepth: 6,
              maxObjectKeys: 100,
              maxStringLength: 8_000
            }).value
          : null;
        return `Input ${entry.targetHandle || index + 1}:\n${entry.text}${
          boundedJson ? `\nJSON: ${JSON.stringify(boundedJson)}` : ""
        }`;
      })
      .join("\n\n"),
    MAX_LINKED_INPUT_CHARACTERS
  );
  const sections = [
    truncate(input.node.data.prompt?.trim() || "", 10_000),
    input.userInput
      ? `User input:\n${truncate(input.userInput, 12_000, true)}`
      : "",
    conversationHistory
      ? `Conversation history:\n[most recent context retained]\n${conversationHistory}`
      : "",
    linkedInputs ? `Linked inputs:\n${linkedInputs}` : "",
    input.transcript.length > 0
      ? `Tool transcript:\n${truncate(
          input.transcript.join("\n\n"),
          MAX_TOOL_TRANSCRIPT_CHARACTERS,
          true
        )}`
      : ""
  ].filter(Boolean);
  return truncate(sections.join("\n\n"), MAX_MODEL_PROMPT_CHARACTERS, true);
}

async function createOpenAiConversation(
  profile: WikiLlmProfileLike,
  apiKey: string
) {
  const response = await fetch(buildConversationsUrl(profile), {
    method: "POST",
    headers: buildRequestHeaders(profile, apiKey),
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `OpenAI conversation creation failed (${response.status})${
        message ? `: ${message}` : ""
      }`
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const conversationId = typeof payload.id === "string" ? payload.id : null;
  if (!conversationId) {
    throw new Error("OpenAI conversation creation did not return an id.");
  }
  return conversationId;
}

async function runOpenAiConversationPrompt(input: {
  profile: WikiLlmProfileLike;
  apiKey: string;
  systemPrompt?: string;
  prompt: string;
  conversationId: string | null;
}) {
  const conversationId =
    input.conversationId ??
    (await createOpenAiConversation(input.profile, input.apiKey));
  const response = await fetch(buildResponsesUrl(input.profile), {
    method: "POST",
    headers: buildRequestHeaders(input.profile, input.apiKey),
    body: JSON.stringify({
      model: input.profile.model,
      conversation: { id: conversationId },
      input: [
        ...(input.systemPrompt?.trim()
          ? [
              {
                role: "system",
                content: [
                  { type: "input_text", text: input.systemPrompt.trim() }
                ]
              }
            ]
          : []),
        {
          role: "user",
          content: [{ type: "input_text", text: input.prompt }]
        }
      ],
      reasoning:
        typeof input.profile.metadata.reasoningEffort === "string"
          ? { effort: input.profile.metadata.reasoningEffort }
          : undefined,
      text:
        typeof input.profile.metadata.verbosity === "string"
          ? { verbosity: input.profile.metadata.verbosity }
          : undefined,
      ...(isCodexProfile(input.profile) ? {} : { max_output_tokens: 1200 })
    })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `OpenAI connector prompt failed (${response.status})${
        message ? `: ${message}` : ""
      }`
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    text: parseOutputText(payload)?.trim() || "",
    conversationId
  };
}

function resolveConnectorModelProfile(
  node: AiConnectorNode,
  secrets: SecretsManager
) {
  const requestedConnectionId = node.data.modelConfig?.connectionId;
  const fallbackConnection =
    (requestedConnectionId
      ? getAiModelConnectionById(requestedConnectionId)
      : null) ??
    getAiModelConnectionById(FORGE_DEFAULT_AGENT_ID) ??
    listAiModelConnections()[0] ??
    null;

  if (!fallbackConnection) {
    throw new Error(
      "No model connection is configured for this connector node."
    );
  }

  const credential = readModelConnectionCredential(
    fallbackConnection.id,
    secrets
  );
  const explicitApiKey =
    credential?.kind === "api_key"
      ? credential.apiKey
      : credential?.kind === "oauth"
        ? credential.access
        : null;
  if (!explicitApiKey && fallbackConnection.provider !== "mock") {
    throw new Error(
      "The selected connector model connection is missing a credential."
    );
  }

  const profile: WikiLlmProfileLike = {
    provider: fallbackConnection.provider,
    baseUrl:
      node.data.modelConfig?.baseUrl?.trim() ||
      fallbackConnection.baseUrl ||
      DEFAULT_OPENAI_BASE_URL,
    model:
      node.data.modelConfig?.model?.trim() || fallbackConnection.model || "",
    systemPrompt: "",
    secretId: null,
    metadata: {
      reasoningEffort: node.data.modelConfig?.thinking ?? null,
      verbosity: node.data.modelConfig?.verbosity ?? null
    }
  };

  return {
    profile,
    apiKey: explicitApiKey ?? "mock"
  };
}

async function runModelNode(input: {
  connector: AiConnector;
  node: AiConnectorNode;
  userInput: string;
  upstream: Array<ConnectorNodeValue & { targetHandle?: string | null }>;
  services: AiConnectorExecutionServices;
  conversation: AiConnectorConversation | null;
}) {
  const { profile, apiKey } = resolveConnectorModelProfile(
    input.node,
    input.services.secrets
  );
  const availableTools = input.upstream.flatMap((entry) => entry.tools);
  const enabledKeys = new Set(input.node.data.enabledToolKeys ?? []);
  const activeTools =
    enabledKeys.size > 0
      ? availableTools.filter((tool) => enabledKeys.has(tool.key))
      : availableTools;
  const transcript: string[] = [];
  const conversationAware = input.node.type === "chat";
  let conversationId = input.conversation?.externalConversationId ?? null;

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const systemPrompt = [
      input.node.data.systemPrompt?.trim() || "",
      activeTools.length > 0
        ? [
            "You may call available tools when needed.",
            "Return strict JSON only.",
            'For a final answer return {"action":"final","text":"..."}',
            'For a tool call return {"action":"tool","tool":"tool_key","args":{...}}',
            `Available tools: ${activeTools
              .map(
                (tool) =>
                  `${tool.key} (${tool.description})${
                    tool.argsSchema
                      ? ` args=${JSON.stringify(tool.argsSchema)}`
                      : ""
                  }`
              )
              .join("; ")}.`
          ].join(" ")
        : "Return only the final answer text."
    ]
      .filter(Boolean)
      .join("\n\n");

    const prompt = getConversationBasePrompt({
      connector: input.connector,
      node: input.node,
      userInput: input.userInput,
      upstream: input.upstream,
      transcript,
      conversation: input.conversation
    });

    let rawText = "";
    if (conversationAware && isOpenAiFamily(profile)) {
      const result = await runOpenAiConversationPrompt({
        profile,
        apiKey,
        systemPrompt,
        prompt,
        conversationId
      });
      rawText = result.text;
      conversationId = result.conversationId;
    } else {
      rawText = (
        await input.services.llm.runTextPrompt(profile, {
          explicitApiKey: apiKey,
          systemPrompt,
          prompt
        })
      ).outputText.trim();
    }

    if (activeTools.length === 0) {
      return {
        text: rawText.trim(),
        json: tryParseJsonObject(rawText.trim()),
        conversationId,
        logs: transcript,
        availableTools: []
      };
    }

    const structured = tryParseStructuredAgentResponse(rawText.trim());
    if (!structured || structured.action === "final") {
      return {
        text: structured?.text?.trim() || rawText.trim(),
        json: tryParseJsonObject(structured?.text?.trim() || rawText.trim()),
        conversationId,
        logs: transcript,
        availableTools: activeTools.map((tool) => tool.key)
      };
    }

    const selectedTool = requireEnabledTool(activeTools, structured.tool);
    const toolResult = structured.tool.startsWith("machine_")
      ? await executeMachineTool(
          structured.tool as
            | "machine_read_file"
            | "machine_write_file"
            | "machine_exec",
          structured.args,
          input.services.machineCapabilities
        )
      : await executeForgeBoxTool(
          selectedTool.boxId,
          structured.tool,
          structured.args,
          {
            actor: {
              userIds: null,
              source: "agent"
            }
          }
        );

    transcript.push(
      `Tool call ${structured.tool}: ${JSON.stringify(structured.args)}`,
      `Tool result: ${JSON.stringify(toolResult)}`
    );
  }

  return {
    text: "Connector stopped after reaching the maximum tool step count.",
    json: null,
    conversationId,
    logs: transcript,
    availableTools: activeTools.map((tool) => tool.key)
  };
}

function validateConnectorGraph(graph: AiConnector["graph"]) {
  const invalidGraph = (message: string): never => {
    throw new HttpError(400, "workbench_graph_invalid", message);
  };
  if (graph.nodes.length === 0) {
    invalidGraph("Connector graph has no nodes yet.");
  }
  if (graph.nodes.length > MAX_AI_CONNECTOR_GRAPH_NODES) {
    invalidGraph(
      `Connector graphs support at most ${MAX_AI_CONNECTOR_GRAPH_NODES} nodes.`
    );
  }
  if (graph.edges.length > MAX_AI_CONNECTOR_GRAPH_EDGES) {
    invalidGraph(
      `Connector graphs support at most ${MAX_AI_CONNECTOR_GRAPH_EDGES} edges.`
    );
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (nodeIds.size !== graph.nodes.length) {
    invalidGraph("Connector graph node ids must be unique.");
  }
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  if (edgeIds.size !== graph.edges.length) {
    invalidGraph("Connector graph edge ids must be unique.");
  }
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    const inputKeys = (node.data.inputs ?? []).map((input) => input.key);
    const outputKeys = (node.data.outputs ?? []).map((output) => output.key);
    if (new Set(inputKeys).size !== inputKeys.length) {
      invalidGraph(
        `Node "${node.data.label || node.id}" input keys must be unique.`
      );
    }
    if (new Set(outputKeys).size !== outputKeys.length) {
      invalidGraph(
        `Node "${node.data.label || node.id}" output keys must be unique.`
      );
    }
  }
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const indegrees = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      invalidGraph("Connector graph edge references a missing node.");
    }
    const sourceNode = nodeMap.get(edge.source)!;
    const targetNode = nodeMap.get(edge.target)!;
    const sourceOutputs = sourceNode.data.outputs ?? [];
    const targetInputs = targetNode.data.inputs ?? [];
    if (
      edge.sourceHandle &&
      !sourceOutputs.some((output) => output.key === edge.sourceHandle)
    ) {
      invalidGraph(
        `Edge "${edge.id}" references missing output "${edge.sourceHandle}" on node "${sourceNode.data.label || sourceNode.id}".`
      );
    }
    if (!edge.sourceHandle && sourceOutputs.length > 1) {
      invalidGraph(
        `Edge "${edge.id}" must name one output on node "${sourceNode.data.label || sourceNode.id}".`
      );
    }
    if (
      edge.targetHandle &&
      !targetInputs.some((input) => input.key === edge.targetHandle)
    ) {
      invalidGraph(
        `Edge "${edge.id}" references missing input "${edge.targetHandle}" on node "${targetNode.data.label || targetNode.id}".`
      );
    }
    if (!edge.targetHandle && targetInputs.length > 1) {
      invalidGraph(
        `Edge "${edge.id}" must name one input on node "${targetNode.data.label || targetNode.id}".`
      );
    }
    const current = adjacency.get(edge.source) ?? [];
    current.push(edge.target);
    adjacency.set(edge.source, current);
    indegrees.set(edge.target, (indegrees.get(edge.target) ?? 0) + 1);
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
  }

  const ready = graph.nodes
    .filter((node) => (indegrees.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  let visitedCount = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const nodeId = ready[cursor]!;
    visitedCount += 1;
    for (const target of adjacency.get(nodeId) ?? []) {
      const nextIndegree = (indegrees.get(target) ?? 0) - 1;
      indegrees.set(target, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(target);
      }
    }
  }
  if (visitedCount !== graph.nodes.length) {
    invalidGraph("Connector graphs cannot contain cycles.");
  }

  const outputNodes = graph.nodes.filter((node) => node.type === "output");
  if (outputNodes.length === 0) {
    invalidGraph("Connector graph is missing an output node.");
  }

  const disconnectedOutput = outputNodes.find(
    (node) => (incomingCounts.get(node.id) ?? 0) === 0
  );
  if (disconnectedOutput) {
    invalidGraph(
      `Output node "${disconnectedOutput.data.label || disconnectedOutput.id}" has no incoming connection.`
    );
  }

  const aiNodeMissingPrompt = graph.nodes.find(
    (node) =>
      (node.type === "functor" || node.type === "chat") &&
      !(node.data.promptTemplate?.trim() || node.data.prompt?.trim())
  );
  if (aiNodeMissingPrompt) {
    invalidGraph(
      `AI node "${aiNodeMissingPrompt.data.label || aiNodeMissingPrompt.id}" is missing a prompt.`
    );
  }

  const mergeNodeMissingInputs = graph.nodes.find(
    (node) => node.type === "merge" && (incomingCounts.get(node.id) ?? 0) < 2
  );
  if (mergeNodeMissingInputs) {
    invalidGraph(
      `Merge node "${mergeNodeMissingInputs.data.label || mergeNodeMissingInputs.id}" must receive both left and right inputs.`
    );
  }

  const templateNodeMissingTemplate = graph.nodes.find(
    (node) => node.type === "template" && !(node.data.template ?? "").trim()
  );
  if (templateNodeMissingTemplate) {
    invalidGraph(
      `Template node "${templateNodeMissingTemplate.data.label || templateNodeMissingTemplate.id}" is missing its template string.`
    );
  }

  const pickKeyNodeMissingSelection = graph.nodes.find(
    (node) => node.type === "pick_key" && !(node.data.selectedKey ?? "").trim()
  );
  if (pickKeyNodeMissingSelection) {
    invalidGraph(
      `Pick-key node "${pickKeyNodeMissingSelection.data.label || pickKeyNodeMissingSelection.id}" is missing the key it should select.`
    );
  }

  const isolatedNode = graph.nodes.find(
    (node) => node.type !== "output" && (outgoingCounts.get(node.id) ?? 0) === 0
  );
  if (isolatedNode) {
    invalidGraph(
      `Node "${isolatedNode.data.label || isolatedNode.id}" is not connected to anything downstream.`
    );
  }
}

function buildOutputResult(
  connector: AiConnector,
  resolvedNodeValues: Map<string, ConnectorNodeValue>,
  nodeResults: Array<{
    nodeId: string;
    nodeType: AiConnectorNode["type"];
    label: string;
    input: ConnectorResolvedInput[];
    primaryText: string;
    payload: Record<string, unknown> | null;
    outputMap: ConnectorNodeValue["outputMap"];
    tools: string[];
    logs: string[];
    error: string | null;
    timingMs?: number | null;
  }>
) {
  const outputs = Object.fromEntries(
    connector.publishedOutputs.map((output) => {
      const nodeValue = resolvedNodeValues.get(output.nodeId);
      return [
        output.id,
        {
          label: output.label,
          text: nodeValue?.text ?? "",
          json: nodeValue?.json ?? null
        }
      ];
    })
  );
  const first = connector.publishedOutputs[0];
  return aiConnectorRunResultSchema.parse({
    primaryText: first ? (outputs[first.id]?.text ?? "") : "",
    outputs,
    nodeResults
  });
}

function parseValueLiteral(
  valueType: AiConnectorNode["data"]["valueType"],
  valueLiteral: string
) {
  if (valueType === "null") {
    return null;
  }
  if (valueType === "boolean") {
    return valueLiteral.trim().toLowerCase() === "true";
  }
  if (valueType === "number") {
    const parsed = Number(valueLiteral);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (valueType === "array" || valueType === "object") {
    try {
      return JSON.parse(valueLiteral || (valueType === "array" ? "[]" : "{}"));
    } catch {
      return valueType === "array" ? [] : {};
    }
  }
  return valueLiteral;
}

function createConversationRecord(input: {
  connectorId: string;
  provider: string | null;
  externalConversationId: string | null;
  transcript: AiConnectorConversation["transcript"];
  existing?: AiConnectorConversation | null;
}) {
  const now = new Date().toISOString();
  return saveAiConnectorConversation(
    aiConnectorConversationSchema.parse({
      id:
        input.existing?.id ??
        `aicv_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      connectorId: input.connectorId,
      provider: input.provider,
      externalConversationId: input.externalConversationId,
      transcript: input.transcript,
      createdAt: input.existing?.createdAt ?? now,
      updatedAt: now
    })
  );
}

async function executeConnector(
  connector: AiConnector,
  rawInput: RunAiConnectorInput,
  services: AiConnectorExecutionServices
) {
  validateConnectorGraph(connector.graph);
  const parsedInput = runAiConnectorSchema.parse(rawInput);
  const incoming = new Map<string, AiConnectorEdge[]>();
  for (const edge of connector.graph.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }
  const values = new Map<string, ConnectorNodeValue>();
  const debugNodes: ConnectorDebugNode[] = [];
  const nodeResults: Array<{
    nodeId: string;
    nodeType: AiConnectorNode["type"];
    label: string;
    input: ConnectorResolvedInput[];
    primaryText: string;
    payload: Record<string, unknown> | null;
    outputMap: ConnectorNodeValue["outputMap"];
    tools: string[];
    logs: string[];
    error: string | null;
    timingMs?: number | null;
  }> = [];
  const debugErrors: string[] = [];
  const outputNodes = connector.graph.nodes.filter(
    (node) => node.type === "output"
  );
  const activeConversation = parsedInput.conversationId
    ? getAiConnectorConversationById(parsedInput.conversationId)
    : getAiConnectorConversationForConnector(connector.id);
  const publicInputValues = new Map<string, unknown>();
  const nodePublicInputs = new Map<string, ConnectorPublicBindingValue[]>();
  const nodePublicParams = new Map<string, Record<string, unknown>>();

  for (const publicInput of connector.publicInputs) {
    const hasProvided = Object.prototype.hasOwnProperty.call(
      parsedInput.inputs,
      publicInput.key
    );
    const resolvedValue = hasProvided
      ? parsedInput.inputs[publicInput.key]
      : publicInput.defaultValue;
    if (resolvedValue === undefined) {
      if (publicInput.required) {
        throw new Error(`Flow input "${publicInput.label}" is required.`);
      }
      continue;
    }
    if (!validatePortValueType(publicInput, resolvedValue)) {
      throw new Error(
        `Flow input "${publicInput.label}" must match the ${publicInput.kind} type.`
      );
    }
    const bindings = normalizePublicInputBindings(connector, publicInput);
    if (bindings.length === 0) {
      throw new Error(
        `Flow input "${publicInput.label}" is not bound to any node input or parameter yet.`
      );
    }
    publicInputValues.set(publicInput.key, resolvedValue);
    for (const binding of bindings) {
      if (binding.targetKind === "param") {
        const current = nodePublicParams.get(binding.nodeId) ?? {};
        current[binding.targetKey] = resolvedValue;
        nodePublicParams.set(binding.nodeId, current);
        continue;
      }
      const current = nodePublicInputs.get(binding.nodeId) ?? [];
      const publicBindingValue = buildPublicInputValue(
        publicInput,
        resolvedValue
      );
      current.push({
        ...publicBindingValue,
        targetHandle: binding.targetKey
      });
      nodePublicInputs.set(binding.nodeId, current);
    }
  }

  const evaluateNode = async (nodeId: string): Promise<ConnectorNodeValue> => {
    const existing = values.get(nodeId);
    if (existing) {
      return existing;
    }
    const node = connector.graph.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      throw new Error(`Missing connector node ${nodeId}.`);
    }
    const startedAt = Date.now();
    const upstreamEdges = incoming.get(nodeId) ?? [];
    const graphUpstream = await Promise.all(
      upstreamEdges.map(async (edge) => {
        const upstreamValue = await evaluateNode(edge.source);
        const selected = readOutputSelection(upstreamValue, edge.sourceHandle);
        return {
          edge,
          sourceValue: upstreamValue,
          selected
        };
      })
    );
    const publicInputs = (nodePublicInputs.get(nodeId) ?? []).map((entry) => ({
      edge: {
        id: `${nodeId}_${entry.targetHandle}`,
        source: entry.sourceNodeId,
        target: nodeId,
        sourceHandle: entry.sourceHandle,
        targetHandle: entry.targetHandle,
        label: null
      } satisfies AiConnectorEdge,
      sourceValue: {
        text: entry.text,
        json: entry.json,
        tools: [],
        conversationId: null,
        outputMap: {
          [entry.sourceHandle ?? entry.targetHandle]: {
            text: entry.text,
            json: entry.json
          }
        },
        logs: []
      } satisfies ConnectorNodeValue,
      selected: {
        text: entry.text,
        json: entry.json
      }
    }));
    const upstream = [...graphUpstream, ...publicInputs];
    const resolvedInputsForDebug: ConnectorResolvedInput[] = upstream.map(
      (entry) => ({
        sourceNodeId: entry.edge.source,
        sourceHandle: entry.edge.sourceHandle ?? null,
        targetHandle: entry.edge.targetHandle ?? null,
        text: entry.selected.text,
        json: entry.selected.json
      })
    );
    let resolved: ConnectorNodeValue;
    let nodeToolKeys: string[] = [];

    if (node.type === "box" || node.type === "box_input") {
      const boxId = node.data.boxId?.trim() || "";
      const resolvedInputs = Object.fromEntries(
        upstream.map(({ edge, selected }, index) => [
          edge.targetHandle ?? edge.sourceHandle ?? `input_${index + 1}`,
          selected.json ?? selected.text
        ])
      );
      const resolvedParams = {
        ...((node.data.paramValues && typeof node.data.paramValues === "object"
          ? node.data.paramValues
          : {}) as Record<string, unknown>),
        ...(nodePublicParams.get(nodeId) ?? {})
      };
      const providedSnapshot = boxId ? parsedInput.boxSnapshots[boxId] : null;
      const snapshot =
        providedSnapshot && typeof providedSnapshot === "object"
          ? {
              ...resolveForgeBoxSnapshot(
                boxId,
                {
                  actor: {
                    userIds: null,
                    source: "agent"
                  }
                },
                {
                  inputs: resolvedInputs,
                  params: resolvedParams
                }
              ),
              contentJson: providedSnapshot as Record<string, unknown>
            }
          : boxId
            ? resolveForgeBoxSnapshot(
                boxId,
                {
                  actor: {
                    userIds: null,
                    source: "agent"
                  }
                },
                {
                  inputs: resolvedInputs,
                  params: resolvedParams
                }
              )
            : {
                boxId: "",
                label: node.data.label,
                capturedAt: new Date().toISOString(),
                contentText: "No box is configured for this node yet.",
                contentJson: null,
                tools: []
              };
      const outputDefs = defaultOutputsForNode(node);
      resolved = {
        text: snapshot.contentText,
        json: snapshot.contentJson,
        tools: snapshot.tools.map((tool) => ({
          boxId: snapshot.boxId,
          key: tool.key,
          label: tool.label,
          description: tool.description,
          argsSchema: tool.argsSchema
        })),
        conversationId: null,
        outputMap: buildOutputMap(
          snapshot.contentText,
          snapshot.contentJson,
          outputDefs
        ),
        logs: []
      };
      nodeToolKeys = resolved.tools.map((tool) => tool.key);
    } else if (node.type === "value") {
      const parsedValue = parseValueLiteral(
        node.data.valueType ?? "string",
        node.data.valueLiteral ?? ""
      );
      const jsonValue =
        parsedValue &&
        typeof parsedValue === "object" &&
        !Array.isArray(parsedValue)
          ? (parsedValue as Record<string, unknown>)
          : null;
      const textValue =
        parsedValue === null
          ? "null"
          : typeof parsedValue === "string"
            ? parsedValue
            : JSON.stringify(parsedValue, null, 2);
      resolved = {
        text: textValue,
        json: jsonValue,
        tools: [],
        conversationId: null,
        outputMap: buildOutputMap(
          textValue,
          jsonValue,
          defaultOutputsForNode(node)
        ),
        logs: []
      };
    } else if (node.type === "user_input") {
      const inputJson =
        Object.keys(parsedInput.context).length > 0
          ? {
              message: parsedInput.userInput || "",
              inputs: Object.fromEntries(publicInputValues),
              context: parsedInput.context
            }
          : {
              message: parsedInput.userInput || "",
              inputs: Object.fromEntries(publicInputValues)
            };
      resolved = {
        text: parsedInput.userInput || "",
        json: inputJson,
        tools: [],
        conversationId: activeConversation?.id ?? null,
        outputMap: buildOutputMap(
          parsedInput.userInput || "",
          inputJson,
          defaultOutputsForNode(node)
        ),
        logs: []
      };
    } else if (node.type === "merge") {
      const mergedText = upstream
        .map((entry) => entry.selected.text)
        .filter(Boolean)
        .join("\n\n");
      const mergedJson = Object.assign(
        {},
        ...upstream
          .map((entry) => entry.selected.json)
          .filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object"
          )
      );
      resolved = {
        text: mergedText,
        json:
          Object.keys(mergedJson).length > 0
            ? {
                merged: mergedJson
              }
            : {
                merged: mergedText
              },
        tools: upstream.flatMap((entry) => entry.sourceValue.tools),
        conversationId:
          upstream.find((entry) => entry.sourceValue.conversationId)
            ?.sourceValue.conversationId ?? null,
        outputMap: buildOutputMap(
          mergedText,
          Object.keys(mergedJson).length > 0
            ? {
                merged: mergedJson
              }
            : {
                merged: mergedText
              },
          defaultOutputsForNode(node)
        ),
        logs: []
      };
    } else if (node.type === "template") {
      const primary = upstream[0]?.selected ?? { text: "", json: null };
      const rendered = (node.data.template ?? node.data.promptTemplate ?? "")
        .replaceAll("{{input}}", primary.text)
        .replaceAll(
          "{{json}}",
          primary.json ? JSON.stringify(primary.json) : ""
        );
      resolved = {
        text: rendered,
        json: {
          rendered,
          ...(tryParseJsonObject(rendered) ?? {})
        },
        tools: [],
        conversationId:
          upstream.find((entry) => entry.sourceValue.conversationId)
            ?.sourceValue.conversationId ?? null,
        outputMap: buildOutputMap(
          rendered,
          {
            rendered,
            ...(tryParseJsonObject(rendered) ?? {})
          },
          defaultOutputsForNode(node)
        ),
        logs: []
      };
    } else if (node.type === "pick_key") {
      const primary = upstream[0]?.selected ?? { text: "", json: null };
      const selectedKey = node.data.selectedKey?.trim() || "";
      const selectedValue =
        primary.json && selectedKey in primary.json
          ? primary.json[selectedKey]
          : null;
      const selectedJson =
        selectedValue &&
        typeof selectedValue === "object" &&
        !Array.isArray(selectedValue)
          ? (selectedValue as Record<string, unknown>)
          : null;
      resolved = {
        text: coerceText(selectedValue),
        json: selectedJson ?? {
          selected: selectedValue
        },
        tools: [],
        conversationId:
          upstream.find((entry) => entry.sourceValue.conversationId)
            ?.sourceValue.conversationId ?? null,
        outputMap: buildOutputMap(
          coerceText(selectedValue),
          selectedJson ?? {
            selected: selectedValue
          },
          defaultOutputsForNode(node)
        ),
        logs: []
      };
    } else if (node.type === "output") {
      const outputHandle = node.data.outputKey?.trim() || null;
      const publishedSelections = upstream.map((entry) =>
        readOutputSelection(
          entry.sourceValue,
          outputHandle ?? entry.edge.sourceHandle
        )
      );
      const mergedText = publishedSelections
        .map((entry) => entry.text)
        .filter(Boolean)
        .join("\n\n");
      const leadSelection = publishedSelections[0] ?? {
        text: mergedText,
        json: null
      };
      const publishedKey = outputHandle || "result";
      const publishedJson = leadSelection.json ?? {
        [publishedKey]: leadSelection.text
      };
      resolved = {
        text: mergedText,
        json: publishedJson,
        tools: [],
        conversationId:
          upstream.find((entry) => entry.sourceValue.conversationId)
            ?.sourceValue.conversationId ?? null,
        outputMap: buildOutputMap(
          mergedText,
          publishedJson,
          defaultOutputsForNode(node)
        ),
        logs: []
      };
    } else {
      const modelResult = await runModelNode({
        connector,
        node,
        userInput: parsedInput.userInput,
        upstream: upstream.map((entry) => ({
          text: entry.selected.text,
          json: entry.selected.json,
          tools: entry.sourceValue.tools,
          conversationId: entry.sourceValue.conversationId,
          outputMap: entry.sourceValue.outputMap,
          logs: entry.sourceValue.logs,
          targetHandle: entry.edge.targetHandle ?? null
        })),
        services,
        conversation: activeConversation
      });
      const outputDefs = defaultOutputsForNode(node);
      resolved = {
        text: modelResult.text,
        json: modelResult.json,
        tools: [],
        conversationId: modelResult.conversationId,
        outputMap: buildOutputMap(
          modelResult.text,
          modelResult.json,
          outputDefs
        ),
        logs: modelResult.logs
      };
      nodeToolKeys = modelResult.availableTools;
    }

    values.set(nodeId, resolved);
    debugNodes.push({
      nodeId: node.id,
      nodeType: node.type,
      label: node.data.label,
      input: resolvedInputsForDebug,
      output: {
        text: resolved.text,
        json: resolved.json
      },
      tools: nodeToolKeys,
      logs: resolved.logs,
      error: null
    });
    nodeResults.push({
      nodeId: node.id,
      nodeType: node.type,
      label: node.data.label,
      input: resolvedInputsForDebug,
      primaryText: resolved.text,
      payload: resolved.json,
      outputMap: resolved.outputMap,
      tools: nodeToolKeys,
      logs: resolved.logs,
      error: null,
      timingMs: Date.now() - startedAt
    });
    return resolved;
  };

  try {
    for (const outputNode of outputNodes) {
      await evaluateNode(outputNode.id);
    }
  } catch (error) {
    debugErrors.push(
      error instanceof Error ? error.message : "Flow execution failed"
    );
    throw error;
  }
  const result = aiConnectorRunResultSchema.parse({
    ...buildOutputResult(connector, values, nodeResults),
    debugTrace: parsedInput.debug
      ? {
          nodes: debugNodes,
          errors: debugErrors
        }
      : undefined
  });
  const conversationProviderNode = connector.graph.nodes.find(
    (node) => node.type === "chat"
  );
  const resolvedConversationId =
    [...values.values()].find((entry) => entry.conversationId)
      ?.conversationId ?? null;
  const nextConversation = conversationProviderNode
    ? createConversationRecord({
        connectorId: connector.id,
        provider: conversationProviderNode.data.modelConfig?.provider ?? null,
        externalConversationId:
          conversationProviderNode.data.modelConfig?.provider &&
          isOpenAiFamily({
            provider: conversationProviderNode.data.modelConfig.provider,
            baseUrl:
              conversationProviderNode.data.modelConfig.baseUrl ??
              DEFAULT_OPENAI_BASE_URL,
            model: conversationProviderNode.data.modelConfig.model,
            systemPrompt: "",
            secretId: null,
            metadata: {}
          })
            ? resolvedConversationId
            : null,
        transcript: [
          ...(activeConversation?.transcript ?? []),
          ...(parsedInput.userInput
            ? [
                {
                  role: "user" as const,
                  text: parsedInput.userInput,
                  createdAt: new Date().toISOString()
                }
              ]
            : []),
          {
            role: "assistant" as const,
            text: result.primaryText,
            createdAt: new Date().toISOString()
          }
        ],
        existing: activeConversation
      })
    : null;

  return {
    result,
    conversation: nextConversation
  };
}

function migrateLegacyProcessor(processorId: string) {
  const processor = getAiProcessorById(processorId);
  if (!processor) {
    return null;
  }
  const existing = getDatabase()
    .prepare(`SELECT * FROM ai_connectors WHERE legacy_processor_id = ?`)
    .get(processorId) as AiConnectorRow | undefined;
  if (existing) {
    return mapConnector(existing);
  }

  const sourceLinks = listAiProcessorLinks(processor.surfaceId).filter(
    (link) => link.targetProcessorId === processor.id
  );
  const inputNodes: AiConnectorNode[] = sourceLinks.map((link, index) => ({
    id: `legacy_input_${index + 1}`,
    type: "box_input",
    position: { x: 60, y: 80 + index * 120 },
    data: {
      label: `Legacy input ${index + 1}`,
      description: `Imported from ${link.sourceWidgetId}`,
      boxId: `legacy:${link.sourceWidgetId}`,
      enabledToolKeys: []
    }
  }));
  const modelNode: AiConnectorNode = {
    id: "legacy_functor",
    type: "functor",
    position: { x: 360, y: 160 },
    data: {
      label: processor.title,
      description: "Imported from a legacy AI processor.",
      prompt: processor.promptFlow,
      systemPrompt: processor.contextInput,
      enabledToolKeys: processor.toolConfig.map((tool) => tool.key),
      modelConfig: {
        connectionId: processor.agentConfigs[0]?.connectionId ?? null,
        provider: null,
        baseUrl: null,
        model: processor.agentConfigs[0]?.model ?? "",
        thinking: null,
        verbosity: null
      }
    }
  };
  const outputNode: AiConnectorNode = {
    id: "legacy_output",
    type: "output",
    position: { x: 700, y: 160 },
    data: {
      label: "Output",
      description: "Imported legacy output.",
      outputKey: "answer",
      enabledToolKeys: []
    }
  };
  const graph = {
    nodes: [...inputNodes, modelNode, outputNode],
    edges: [
      ...inputNodes.map((node, index) => ({
        id: `legacy_edge_input_${index + 1}`,
        source: node.id,
        target: modelNode.id
      })),
      {
        id: "legacy_edge_output",
        source: modelNode.id,
        target: outputNode.id
      }
    ]
  };
  return createAiConnector({
    title: processor.title,
    description: "Migrated from a legacy AI processor.",
    kind: "functor",
    homeSurfaceId: processor.surfaceId,
    endpointEnabled: processor.endpointEnabled,
    graph,
    publicInputs: [],
    legacyProcessorId: processor.id
  });
}

export function ensureLegacyProcessorsMigrated() {
  for (const processor of listAiProcessors()) {
    migrateLegacyProcessor(processor.id);
  }
}

export function listAiConnectors() {
  const rows = getDatabase()
    .prepare(`SELECT * FROM ai_connectors ORDER BY created_at ASC`)
    .all() as AiConnectorRow[];
  return rows.map(mapConnector);
}

export function getAiConnectorById(connectorId: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM ai_connectors WHERE id = ?`)
    .get(connectorId) as AiConnectorRow | undefined;
  return row ? mapConnector(row) : null;
}

export function getAiConnectorBySlug(slug: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM ai_connectors WHERE slug = ?`)
    .get(slug) as AiConnectorRow | undefined;
  return row ? mapConnector(row) : null;
}

export function createAiConnector(
  input: CreateAiConnectorInput & { legacyProcessorId?: string | null }
) {
  const parsed = createAiConnectorSchema.parse(input);
  const now = new Date().toISOString();
  const id = `aic_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const slug = buildConnectorSlug(parsed.title, id);
  const graph = normalizeConnectorGraph(
    parsed.graph.nodes.length > 0
      ? parsed.graph
      : buildDefaultGraph(parsed.kind, parsed.title)
  );
  validateConnectorGraph(graph);
  const publishedOutputs = ensurePublishedOutputs(id, graph);
  return runInTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO ai_connectors (
          id, slug, title, description, kind, home_surface_id, endpoint_enabled, graph_json, public_inputs_json, published_outputs_json, last_run_json, legacy_processor_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        slug,
        parsed.title,
        parsed.description,
        parsed.kind,
        parsed.homeSurfaceId,
        parsed.endpointEnabled ? 1 : 0,
        JSON.stringify(graph),
        JSON.stringify(parsed.publicInputs),
        JSON.stringify(publishedOutputs),
        null,
        input.legacyProcessorId ?? null,
        now,
        now
      );
    const connector = getAiConnectorById(id)!;
    insertConnectorVersion(connector, "created");
    return connector;
  });
}

export function updateAiConnector(
  connectorId: string,
  patch: UpdateAiConnectorInput
) {
  const parsed = updateAiConnectorSchema.parse(patch);
  return runInTransaction(() => {
    const current = getAiConnectorById(connectorId);
    if (!current) {
      return { status: "not_found" } as const;
    }
    if (current.revision !== parsed.expectedRevision) {
      return {
        status: "conflict",
        currentRevision: current.revision
      } as const;
    }
    const { expectedRevision: _expectedRevision, ...changes } = parsed;
    const nextGraph = normalizeConnectorGraph(changes.graph ?? current.graph);
    validateConnectorGraph(nextGraph);
    const nextTitle = changes.title ?? current.title;
    const next = {
      ...current,
      ...changes,
      title: nextTitle,
      slug:
        changes.title && changes.title !== current.title
          ? buildConnectorSlug(changes.title, current.id)
          : current.slug,
      graph: nextGraph,
      publicInputs: changes.publicInputs ?? current.publicInputs,
      publishedOutputs: ensurePublishedOutputs(current.id, nextGraph)
    };
    const now = new Date().toISOString();
    const update = getDatabase()
      .prepare(
        `UPDATE ai_connectors
         SET slug = ?, title = ?, description = ?, kind = ?, home_surface_id = ?, endpoint_enabled = ?, graph_json = ?, public_inputs_json = ?, published_outputs_json = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(
        next.slug,
        next.title,
        next.description,
        next.kind,
        next.homeSurfaceId,
        next.endpointEnabled ? 1 : 0,
        JSON.stringify(next.graph),
        JSON.stringify(next.publicInputs),
        JSON.stringify(next.publishedOutputs),
        now,
        connectorId,
        parsed.expectedRevision
      );
    if (update.changes !== 1) {
      return {
        status: "conflict",
        currentRevision: getAiConnectorById(connectorId)?.revision ?? null
      } as const;
    }
    const connector = getAiConnectorById(connectorId)!;
    insertConnectorVersion(connector, "updated");
    return { status: "updated", connector } as const;
  });
}

export function deleteAiConnector(
  connectorId: string,
  expectedRevision: number
) {
  return runInTransaction(() => {
    const current = getAiConnectorById(connectorId);
    if (!current) {
      return { status: "not_found" } as const;
    }
    if (current.revision !== expectedRevision) {
      return {
        status: "conflict",
        currentRevision: current.revision
      } as const;
    }
    const deleted = getDatabase()
      .prepare(`DELETE FROM ai_connectors WHERE id = ? AND revision = ?`)
      .run(connectorId, expectedRevision);
    if (deleted.changes !== 1) {
      return {
        status: "conflict",
        currentRevision: getAiConnectorById(connectorId)?.revision ?? null
      } as const;
    }
    return { status: "deleted", connector: current } as const;
  });
}

export function listAiConnectorVersionsPage(
  connectorId: string,
  input: { limit?: number; offset?: number } = {}
) {
  if (!getAiConnectorById(connectorId)) {
    return null;
  }
  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_AI_CONNECTOR_VERSION_LIMIT, 1),
    MAX_AI_CONNECTOR_VERSION_LIMIT
  );
  const offset = Math.max(input.offset ?? 0, 0);
  const total = (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ai_connector_versions
         WHERE connector_id = ?`
      )
      .get(connectorId) as { count: number }
  ).count;
  const rows = getDatabase()
    .prepare(
      `SELECT *
       FROM ai_connector_versions
       WHERE connector_id = ?
       ORDER BY revision DESC
       LIMIT ? OFFSET ?`
    )
    .all(connectorId, limit, offset) as AiConnectorVersionRow[];
  return {
    versions: rows.map(connectorVersionSummary),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total
  };
}

export function getAiConnectorVersion(connectorId: string, revision: number) {
  if (!getAiConnectorById(connectorId)) {
    return null;
  }
  const row = getDatabase()
    .prepare(
      `SELECT *
       FROM ai_connector_versions
       WHERE connector_id = ? AND revision = ?`
    )
    .get(connectorId, revision) as AiConnectorVersionRow | undefined;
  if (!row) {
    return undefined;
  }
  return {
    ...connectorVersionSummary(row),
    snapshot: parseConnectorSnapshot(row.snapshot_json)
  };
}

export function restoreAiConnectorVersion(
  connectorId: string,
  input: { revision: number; expectedRevision: number }
) {
  const parsed = restoreAiConnectorVersionSchema.parse(input);
  return runInTransaction(() => {
    const current = getAiConnectorById(connectorId);
    if (!current) {
      return { status: "not_found" } as const;
    }
    if (current.revision !== parsed.expectedRevision) {
      return {
        status: "conflict",
        currentRevision: current.revision
      } as const;
    }
    const version = getDatabase()
      .prepare(
        `SELECT *
         FROM ai_connector_versions
         WHERE connector_id = ? AND revision = ?`
      )
      .get(connectorId, parsed.revision) as AiConnectorVersionRow | undefined;
    if (!version) {
      return { status: "version_not_found" } as const;
    }
    const snapshot = parseConnectorSnapshot(version.snapshot_json);
    validateConnectorGraph(snapshot.graph);
    const nextRevision = current.revision + 1;
    const now = new Date().toISOString();
    const updated = getDatabase()
      .prepare(
        `UPDATE ai_connectors
         SET slug = ?, title = ?, description = ?, kind = ?, home_surface_id = ?, endpoint_enabled = ?, graph_json = ?, public_inputs_json = ?, published_outputs_json = ?, revision = ?, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(
        buildConnectorSlug(snapshot.title, current.id),
        snapshot.title,
        snapshot.description,
        snapshot.kind,
        snapshot.homeSurfaceId,
        snapshot.endpointEnabled ? 1 : 0,
        JSON.stringify(snapshot.graph),
        JSON.stringify(snapshot.publicInputs),
        JSON.stringify(snapshot.publishedOutputs),
        nextRevision,
        now,
        connectorId,
        parsed.expectedRevision
      );
    if (updated.changes !== 1) {
      return {
        status: "conflict",
        currentRevision: getAiConnectorById(connectorId)?.revision ?? null
      } as const;
    }
    const connector = getAiConnectorById(connectorId)!;
    insertConnectorVersion(connector, "restored", parsed.revision);
    return { status: "restored", connector } as const;
  });
}

export async function runAiConnector(
  connectorId: string,
  input: RunAiConnectorInput,
  services: AiConnectorExecutionServices,
  mode: "run" | "chat" = "run"
): Promise<ConnectorExecutionResult> {
  const connector = getAiConnectorById(connectorId);
  if (!connector) {
    throw new Error(`Connector ${connectorId} was not found.`);
  }

  const retryRun = input.retryOfRunId
    ? getAiConnectorRunById(connectorId, input.retryOfRunId)
    : null;
  if (input.retryOfRunId && !retryRun) {
    throw new Error(`Workbench retry run ${input.retryOfRunId} was not found.`);
  }
  if (retryRun && retryRun.status !== "failed") {
    throw new Error("Only a failed Workbench run can be retried.");
  }
  if (retryRun && retryRun.mode !== mode) {
    throw new Error("Workbench retry mode must match the failed run mode.");
  }
  const effectiveInput: RunAiConnectorInput = retryRun
    ? {
        ...input,
        userInput: input.userInput || retryRun.userInput,
        inputs:
          Object.keys(input.inputs).length > 0 ? input.inputs : retryRun.inputs,
        context:
          Object.keys(input.context).length > 0
            ? input.context
            : retryRun.context,
        conversationId: input.conversationId ?? retryRun.conversationId
      }
    : input;

  const pendingRun = aiConnectorRunSchema.parse({
    id: `aicr_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    connectorId,
    mode,
    status: "running",
    userInput: effectiveInput.userInput ?? "",
    inputs: effectiveInput.inputs ?? {},
    context: effectiveInput.context ?? {},
    conversationId: effectiveInput.conversationId ?? null,
    retryOfRunId: input.retryOfRunId ?? null,
    flowSnapshot: {
      title: connector.title,
      updatedAt: connector.updatedAt,
      graph: connector.graph,
      publicInputs: connector.publicInputs,
      publishedOutputs: connector.publishedOutputs
    },
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null
  });
  insertRun(pendingRun);

  try {
    const execution = await executeConnector(
      connector,
      effectiveInput,
      services
    );
    const completedRun = aiConnectorRunSchema.parse({
      ...pendingRun,
      status: "completed",
      result: execution.result,
      conversationId: execution.conversation?.id ?? pendingRun.conversationId,
      completedAt: new Date().toISOString()
    });
    insertRun(completedRun);
    return {
      connector: getAiConnectorById(connectorId)!,
      run: completedRun,
      conversation: execution.conversation
    };
  } catch (error) {
    const failedRun = aiConnectorRunSchema.parse({
      ...pendingRun,
      status: "failed",
      error: error instanceof Error ? error.message : "Connector run failed",
      completedAt: new Date().toISOString()
    });
    insertRun(failedRun);
    throw error;
  }
}
