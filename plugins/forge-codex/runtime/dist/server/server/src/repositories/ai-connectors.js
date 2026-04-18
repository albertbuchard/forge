import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getDatabase } from "../db.js";
import { createAiConnectorSchema, aiConnectorConversationSchema, aiConnectorRunResultSchema, aiConnectorRunSchema, aiConnectorSchema, runAiConnectorSchema, updateAiConnectorSchema } from "../types.js";
import { FORGE_DEFAULT_AGENT_ID, getAiModelConnectionById, listAiModelConnections, readModelConnectionCredential } from "./model-settings.js";
import { getAiProcessorById, listAiProcessorLinks, listAiProcessors } from "./ai-processors.js";
import { buildConnectorOutputCatalogEntry, executeForgeBoxTool, resolveForgeBoxSnapshot } from "../connectors/box-registry.js";
import { normalizeWorkbenchPortDefinition } from "../../../src/lib/workbench/nodes.js";
const execFile = promisify(execFileCallback);
const MAX_TOOL_STEPS = 6;
const MAX_RUN_HISTORY = 20;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
function parseJson(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    }
    catch {
        return fallback;
    }
}
function slugifySegment(value) {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || "connector";
}
function buildConnectorSlug(title, id) {
    return `${slugifySegment(title)}-${id.slice(-6)}`;
}
function normalizeBaseUrl(profile) {
    const trimmed = profile.baseUrl.trim();
    return trimmed.length > 0 ? trimmed.replace(/\/$/, "") : DEFAULT_OPENAI_BASE_URL;
}
function isOpenAiFamily(profile) {
    return (profile.provider === "openai-api" ||
        profile.provider === "openai-compatible" ||
        profile.provider === "openai-codex");
}
function isCodexProfile(profile) {
    return profile.provider === "openai-codex";
}
function extractCodexAccountId(accessToken) {
    const parts = accessToken.split(".");
    if (parts.length !== 3) {
        throw new Error("Failed to extract accountId from OpenAI Codex token.");
    }
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const auth = payload["https://api.openai.com/auth"];
    if (!auth || typeof auth !== "object") {
        throw new Error("Failed to extract accountId from OpenAI Codex token.");
    }
    const accountId = auth.chatgpt_account_id;
    if (typeof accountId !== "string" || accountId.trim().length === 0) {
        throw new Error("Failed to extract accountId from OpenAI Codex token.");
    }
    return accountId;
}
function buildRequestHeaders(profile, apiKey) {
    const headers = {
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
function buildResponsesUrl(profile) {
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
function buildConversationsUrl(profile) {
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
    return baseUrl.endsWith("/v1") ? `${baseUrl}/conversations` : `${baseUrl}/conversations`;
}
function parseOutputText(payload) {
    const output = Array.isArray(payload.output) ? payload.output : [];
    for (const item of output) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const content = Array.isArray(item.content)
            ? item.content
            : [];
        for (const part of content) {
            if (part &&
                typeof part === "object" &&
                part.type === "output_text" &&
                typeof part.text === "string") {
                return part.text;
            }
        }
    }
    return "";
}
function buildDefaultGraph(kind, title) {
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
                    description: kind === "chat"
                        ? "Chat connector node."
                        : "Functor node.",
                    prompt: kind === "chat"
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
    };
}
function ensurePublishedOutputs(connectorId, graph) {
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
function mapRun(row) {
    return aiConnectorRunSchema.parse({
        id: row.id,
        connectorId: row.connector_id,
        mode: row.mode,
        status: row.status,
        userInput: row.user_input,
        inputs: parseJson(row.inputs_json, {}),
        context: parseJson(row.context_json, {}),
        conversationId: row.conversation_id,
        result: parseJson(row.result_json, null),
        error: row.error,
        createdAt: row.created_at,
        completedAt: row.completed_at
    });
}
function mapConversation(row) {
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
function mapConnector(row) {
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
        lastRun: parseJson(row.last_run_json, null),
        legacyProcessorId: row.legacy_processor_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
export function listAiConnectorRuns(connectorId) {
    const rows = getDatabase()
        .prepare(`SELECT * FROM ai_connector_runs WHERE connector_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(connectorId, MAX_RUN_HISTORY);
    return rows.map(mapRun);
}
export function getAiConnectorRunById(connectorId, runId) {
    const row = getDatabase()
        .prepare(`SELECT * FROM ai_connector_runs WHERE connector_id = ? AND id = ?`)
        .get(connectorId, runId);
    return row ? mapRun(row) : null;
}
export function getAiConnectorRunNodeResults(connectorId, runId) {
    const run = getAiConnectorRunById(connectorId, runId);
    return run?.result?.nodeResults ?? null;
}
export function getAiConnectorRunNodeResult(connectorId, runId, nodeId) {
    const results = getAiConnectorRunNodeResults(connectorId, runId);
    if (!results) {
        return null;
    }
    return results.find((entry) => entry.nodeId === nodeId) ?? null;
}
export function getLatestAiConnectorNodeOutput(connectorId, nodeId) {
    const run = listAiConnectorRuns(connectorId).find((entry) => entry.status === "completed" && entry.result);
    if (!run?.result) {
        return null;
    }
    const nodeResult = run.result.nodeResults.find((entry) => entry.nodeId === nodeId) ?? null;
    if (!nodeResult) {
        return null;
    }
    return {
        run,
        nodeResult
    };
}
export function getAiConnectorConversationById(conversationId) {
    const row = getDatabase()
        .prepare(`SELECT * FROM ai_connector_conversations WHERE id = ?`)
        .get(conversationId);
    return row ? mapConversation(row) : null;
}
export function getAiConnectorConversationForConnector(connectorId) {
    const row = getDatabase()
        .prepare(`SELECT * FROM ai_connector_conversations WHERE connector_id = ?`)
        .get(connectorId);
    return row ? mapConversation(row) : null;
}
function saveAiConnectorConversation(input) {
    getDatabase()
        .prepare(`INSERT INTO ai_connector_conversations (
        id, connector_id, provider, external_conversation_id, transcript_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id) DO UPDATE SET
        provider = excluded.provider,
        external_conversation_id = excluded.external_conversation_id,
        transcript_json = excluded.transcript_json,
        updated_at = excluded.updated_at`)
        .run(input.id, input.connectorId, input.provider, input.externalConversationId, JSON.stringify(input.transcript), input.createdAt, input.updatedAt);
    return getAiConnectorConversationById(input.id);
}
function updateConnectorLastRun(connectorId, run) {
    getDatabase()
        .prepare(`UPDATE ai_connectors SET last_run_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(run), new Date().toISOString(), connectorId);
}
function insertRun(input) {
    getDatabase()
        .prepare(`INSERT INTO ai_connector_runs (
        id, connector_id, mode, status, user_input, inputs_json, context_json, conversation_id, result_json, error, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        connector_id = excluded.connector_id,
        mode = excluded.mode,
        status = excluded.status,
        user_input = excluded.user_input,
        inputs_json = excluded.inputs_json,
        context_json = excluded.context_json,
        conversation_id = excluded.conversation_id,
        result_json = excluded.result_json,
        error = excluded.error,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at`)
        .run(input.id, input.connectorId, input.mode, input.status, input.userInput, JSON.stringify(input.inputs), JSON.stringify(input.context), input.conversationId, input.result ? JSON.stringify(input.result) : null, input.error, input.createdAt, input.completedAt);
    updateConnectorLastRun(input.connectorId, input);
    return input;
}
function resolveAllowedPath(inputPath) {
    const candidate = path.resolve(process.cwd(), inputPath);
    const workspaceRoot = process.cwd();
    if (candidate !== workspaceRoot &&
        !candidate.startsWith(`${workspaceRoot}${path.sep}`)) {
        throw new Error("Machine access is restricted to the Forge workspace root.");
    }
    return candidate;
}
function tryParseStructuredAgentResponse(value) {
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        const action = parsed.action;
        if (action === "final") {
            const text = parsed.text;
            return {
                action,
                text: typeof text === "string" ? text : value
            };
        }
        if (action === "tool") {
            const tool = parsed.tool;
            const args = parsed.args;
            if (typeof tool !== "string" || tool.trim().length === 0) {
                return null;
            }
            return {
                action,
                tool,
                args: args && typeof args === "object" && !Array.isArray(args)
                    ? args
                    : {}
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
function tryParseJsonObject(value) {
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
function coerceText(value) {
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
    }
    catch {
        return "";
    }
}
function coerceJsonObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function validatePortValueType(port, value) {
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
function normalizePublicInputBindings(connector, publicInput) {
    if (publicInput.bindings.length > 0) {
        return publicInput.bindings;
    }
    return connector.graph.nodes.flatMap((node) => {
        const inputs = defaultInputsForNode(node);
        const params = node.data.params ?? [];
        const matches = [];
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
function buildPublicInputValue(publicInput, value) {
    return {
        sourceNodeId: `flow_input:${publicInput.key}`,
        sourceHandle: publicInput.key,
        targetHandle: publicInput.key,
        text: coerceText(value),
        json: coerceJsonObject(value)
    };
}
function buildOutputMap(primaryText, primaryJson, outputs = []) {
    const outputMap = {};
    const declaredOutputs = outputs.length > 0 ? outputs : [{ key: "summary" }];
    declaredOutputs.forEach((output, index) => {
        const value = primaryJson && output.key in primaryJson
            ? primaryJson[output.key]
            : index === 0 || output.key === "summary"
                ? primaryText
                : null;
        outputMap[output.key] = {
            text: coerceText(value),
            json: value && typeof value === "object" && !Array.isArray(value)
                ? value
                : null
        };
    });
    return outputMap;
}
function readOutputSelection(value, handle) {
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
            json: raw && typeof raw === "object" && !Array.isArray(raw)
                ? raw
                : null
        };
    }
    return { text: value.text, json: value.json };
}
function defaultOutputsForNode(node) {
    if (node.data.outputs?.length) {
        return node.data.outputs.map((port) => normalizeWorkbenchPortDefinition(port));
    }
    const port = (definition) => normalizeWorkbenchPortDefinition({
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
            return [port({ key: "merged", label: "Merged context", kind: "context" })];
        case "template":
            return [port({ key: "rendered", label: "Rendered output", kind: "markdown" })];
        case "pick_key":
            return [port({ key: "selected", label: "Selected value", kind: "record" })];
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
function defaultInputsForNode(node) {
    if (node.data.inputs?.length) {
        return node.data.inputs.map((port) => normalizeWorkbenchPortDefinition(port));
    }
    const port = (definition) => normalizeWorkbenchPortDefinition({
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
            return [port({ key: "result", label: "Published result", kind: "record" })];
        default:
            return [];
    }
}
function normalizeConnectorNodeContracts(node) {
    const normalizePorts = (ports, direction) => ports.map((port) => {
        const normalized = normalizeWorkbenchPortDefinition(port);
        if (normalized.key !== "primary") {
            return normalized;
        }
        const nextKey = direction === "output"
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
    const normalizedInputs = normalizePorts(defaultInputsForNode(node).length > 0 ? defaultInputsForNode(node) : node.data.inputs ?? [], "input");
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
    };
}
function canonicalEdgeHandle(handle, ports, preferred) {
    if (ports.length === 0) {
        return null;
    }
    if (!handle || handle === "primary") {
        if (preferred && ports.some((port) => port.key === preferred)) {
            return preferred;
        }
        return ports[0]?.key ?? null;
    }
    if (ports.some((port) => port.key === handle)) {
        return handle;
    }
    if (preferred && ports.some((port) => port.key === preferred)) {
        return preferred;
    }
    return ports[0]?.key ?? null;
}
function normalizeConnectorGraph(graph) {
    const normalizedNodes = graph.nodes.map((node) => normalizeConnectorNodeContracts(node));
    const nodeMap = new Map(normalizedNodes.map((node) => [node.id, node]));
    const normalizedEdges = graph.edges.map((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        return {
            ...edge,
            sourceHandle: canonicalEdgeHandle(edge.sourceHandle, sourceNode?.data.outputs ?? [], sourceNode?.data.outputs?.[0]?.key),
            targetHandle: canonicalEdgeHandle(edge.targetHandle, targetNode?.data.inputs ?? [], targetNode?.data.inputs?.[0]?.key)
        };
    });
    return {
        nodes: normalizedNodes,
        edges: normalizedEdges
    };
}
async function executeMachineTool(tool, args) {
    if (tool === "machine_read_file") {
        const targetPath = typeof args.path === "string" ? resolveAllowedPath(args.path) : null;
        if (!targetPath) {
            throw new Error("machine_read_file requires a string path.");
        }
        const content = await readFile(targetPath, "utf8");
        return { path: targetPath, content };
    }
    if (tool === "machine_write_file") {
        const targetPath = typeof args.path === "string" ? resolveAllowedPath(args.path) : null;
        if (!targetPath || typeof args.content !== "string") {
            throw new Error("machine_write_file requires { path, content }.");
        }
        await writeFile(targetPath, args.content, "utf8");
        return { path: targetPath, bytesWritten: Buffer.byteLength(args.content, "utf8") };
    }
    if (typeof args.command !== "string" || args.command.trim().length === 0) {
        throw new Error("machine_exec requires a command string.");
    }
    const cwd = typeof args.cwd === "string" && args.cwd.trim().length > 0
        ? resolveAllowedPath(args.cwd)
        : process.cwd();
    const result = await execFile("zsh", ["-lc", args.command], {
        cwd,
        timeout: 15_000,
        maxBuffer: 256_000
    });
    return {
        cwd,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
    };
}
function getConversationBasePrompt(input) {
    return [
        input.node.data.prompt?.trim() || "",
        input.userInput ? `User input:\n${input.userInput}` : "",
        input.conversation && input.node.type === "chat" && input.conversation.transcript.length > 0
            ? `Conversation history:\n${input.conversation.transcript
                .slice(-8)
                .map((entry) => `${entry.role}: ${entry.text}`)
                .join("\n")}`
            : "",
        input.upstream.length > 0
            ? `Linked inputs:\n${input.upstream
                .map((entry, index) => `Input ${entry.targetHandle || index + 1}:\n${entry.text}${entry.json ? `\nJSON: ${JSON.stringify(entry.json)}` : ""}`)
                .join("\n\n")}`
            : "",
        input.transcript.length > 0 ? `Tool transcript:\n${input.transcript.join("\n\n")}` : ""
    ]
        .filter(Boolean)
        .join("\n\n");
}
async function createOpenAiConversation(profile, apiKey) {
    const response = await fetch(buildConversationsUrl(profile), {
        method: "POST",
        headers: buildRequestHeaders(profile, apiKey),
        body: JSON.stringify({})
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(`OpenAI conversation creation failed (${response.status})${message ? `: ${message}` : ""}`);
    }
    const payload = (await response.json());
    const conversationId = typeof payload.id === "string" ? payload.id : null;
    if (!conversationId) {
        throw new Error("OpenAI conversation creation did not return an id.");
    }
    return conversationId;
}
async function runOpenAiConversationPrompt(input) {
    const conversationId = input.conversationId ?? (await createOpenAiConversation(input.profile, input.apiKey));
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
                            content: [{ type: "input_text", text: input.systemPrompt.trim() }]
                        }
                    ]
                    : []),
                {
                    role: "user",
                    content: [{ type: "input_text", text: input.prompt }]
                }
            ],
            reasoning: typeof input.profile.metadata.reasoningEffort === "string"
                ? { effort: input.profile.metadata.reasoningEffort }
                : undefined,
            text: typeof input.profile.metadata.verbosity === "string"
                ? { verbosity: input.profile.metadata.verbosity }
                : undefined,
            max_output_tokens: 1200
        })
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(`OpenAI connector prompt failed (${response.status})${message ? `: ${message}` : ""}`);
    }
    const payload = (await response.json());
    return {
        text: parseOutputText(payload)?.trim() || "",
        conversationId
    };
}
function resolveConnectorModelProfile(node, secrets) {
    const requestedConnectionId = node.data.modelConfig?.connectionId;
    const fallbackConnection = (requestedConnectionId
        ? getAiModelConnectionById(requestedConnectionId)
        : null) ??
        getAiModelConnectionById(FORGE_DEFAULT_AGENT_ID) ??
        listAiModelConnections()[0] ??
        null;
    if (!fallbackConnection) {
        throw new Error("No model connection is configured for this connector node.");
    }
    const credential = readModelConnectionCredential(fallbackConnection.id, secrets);
    const explicitApiKey = credential?.kind === "api_key"
        ? credential.apiKey
        : credential?.kind === "oauth"
            ? credential.access
            : null;
    if (!explicitApiKey && fallbackConnection.provider !== "mock") {
        throw new Error("The selected connector model connection is missing a credential.");
    }
    const profile = {
        provider: fallbackConnection.provider,
        baseUrl: node.data.modelConfig?.baseUrl?.trim() ||
            fallbackConnection.baseUrl ||
            DEFAULT_OPENAI_BASE_URL,
        model: node.data.modelConfig?.model?.trim() || fallbackConnection.model || "",
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
async function runModelNode(input) {
    const { profile, apiKey } = resolveConnectorModelProfile(input.node, input.services.secrets);
    const availableTools = input.upstream.flatMap((entry) => entry.tools);
    const enabledKeys = new Set(input.node.data.enabledToolKeys ?? []);
    const activeTools = enabledKeys.size > 0
        ? availableTools.filter((tool) => enabledKeys.has(tool.key))
        : availableTools;
    const transcript = [];
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
                        .map((tool) => `${tool.key} (${tool.description})${tool.argsSchema ? ` args=${JSON.stringify(tool.argsSchema)}` : ""}`)
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
        }
        else {
            rawText = (await input.services.llm.runTextPrompt(profile, {
                explicitApiKey: apiKey,
                systemPrompt,
                prompt
            })).outputText.trim();
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
        const toolResult = structured.tool.startsWith("machine_")
            ? await executeMachineTool(structured.tool, structured.args)
            : await executeForgeBoxTool(activeTools.find((tool) => tool.key === structured.tool)?.boxId ?? "", structured.tool, structured.args, {
                actor: {
                    userIds: null,
                    source: "agent"
                }
            });
        transcript.push(`Tool call ${structured.tool}: ${JSON.stringify(structured.args)}`, `Tool result: ${JSON.stringify(toolResult)}`);
    }
    return {
        text: "Connector stopped after reaching the maximum tool step count.",
        json: null,
        conversationId,
        logs: transcript,
        availableTools: activeTools.map((tool) => tool.key)
    };
}
function validateConnectorGraph(graph) {
    if (graph.nodes.length === 0) {
        throw new Error("Connector graph has no nodes yet.");
    }
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
            throw new Error("Connector graph edge references a missing node.");
        }
    }
    const adjacency = new Map();
    for (const edge of graph.edges) {
        const current = adjacency.get(edge.source) ?? [];
        current.push(edge.target);
        adjacency.set(edge.source, current);
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (nodeId) => {
        if (visiting.has(nodeId)) {
            throw new Error("Connector graphs cannot contain cycles.");
        }
        if (visited.has(nodeId)) {
            return;
        }
        visiting.add(nodeId);
        for (const target of adjacency.get(nodeId) ?? []) {
            visit(target);
        }
        visiting.delete(nodeId);
        visited.add(nodeId);
    };
    for (const node of graph.nodes) {
        visit(node.id);
    }
    const incomingCounts = new Map();
    const outgoingCounts = new Map();
    for (const edge of graph.edges) {
        incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
        outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
    }
    const outputNodes = graph.nodes.filter((node) => node.type === "output");
    if (outputNodes.length === 0) {
        throw new Error("Connector graph is missing an output node.");
    }
    const disconnectedOutput = outputNodes.find((node) => (incomingCounts.get(node.id) ?? 0) === 0);
    if (disconnectedOutput) {
        throw new Error(`Output node "${disconnectedOutput.data.label || disconnectedOutput.id}" has no incoming connection.`);
    }
    const aiNodeMissingPrompt = graph.nodes.find((node) => (node.type === "functor" || node.type === "chat") &&
        !(node.data.promptTemplate?.trim() || node.data.prompt?.trim()));
    if (aiNodeMissingPrompt) {
        throw new Error(`AI node "${aiNodeMissingPrompt.data.label || aiNodeMissingPrompt.id}" is missing a prompt.`);
    }
    const mergeNodeMissingInputs = graph.nodes.find((node) => node.type === "merge" && (incomingCounts.get(node.id) ?? 0) < 2);
    if (mergeNodeMissingInputs) {
        throw new Error(`Merge node "${mergeNodeMissingInputs.data.label || mergeNodeMissingInputs.id}" must receive both left and right inputs.`);
    }
    const templateNodeMissingTemplate = graph.nodes.find((node) => node.type === "template" && !(node.data.template ?? "").trim());
    if (templateNodeMissingTemplate) {
        throw new Error(`Template node "${templateNodeMissingTemplate.data.label || templateNodeMissingTemplate.id}" is missing its template string.`);
    }
    const pickKeyNodeMissingSelection = graph.nodes.find((node) => node.type === "pick_key" && !(node.data.selectedKey ?? "").trim());
    if (pickKeyNodeMissingSelection) {
        throw new Error(`Pick-key node "${pickKeyNodeMissingSelection.data.label || pickKeyNodeMissingSelection.id}" is missing the key it should select.`);
    }
    const isolatedNode = graph.nodes.find((node) => node.type !== "output" &&
        (outgoingCounts.get(node.id) ?? 0) === 0);
    if (isolatedNode) {
        throw new Error(`Node "${isolatedNode.data.label || isolatedNode.id}" is not connected to anything downstream.`);
    }
}
function buildOutputResult(connector, resolvedNodeValues, nodeResults) {
    const outputs = Object.fromEntries(connector.publishedOutputs.map((output) => {
        const nodeValue = resolvedNodeValues.get(output.nodeId);
        return [
            output.id,
            {
                label: output.label,
                text: nodeValue?.text ?? "",
                json: nodeValue?.json ?? null
            }
        ];
    }));
    const first = connector.publishedOutputs[0];
    return aiConnectorRunResultSchema.parse({
        primaryText: first ? outputs[first.id]?.text ?? "" : "",
        outputs,
        nodeResults
    });
}
function parseValueLiteral(valueType, valueLiteral) {
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
        }
        catch {
            return valueType === "array" ? [] : {};
        }
    }
    return valueLiteral;
}
function createConversationRecord(input) {
    const now = new Date().toISOString();
    return saveAiConnectorConversation(aiConnectorConversationSchema.parse({
        id: input.existing?.id ?? `aicv_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        connectorId: input.connectorId,
        provider: input.provider,
        externalConversationId: input.externalConversationId,
        transcript: input.transcript,
        createdAt: input.existing?.createdAt ?? now,
        updatedAt: now
    }));
}
async function executeConnector(connector, rawInput, services) {
    validateConnectorGraph(connector.graph);
    const parsedInput = runAiConnectorSchema.parse(rawInput);
    const incoming = new Map();
    for (const edge of connector.graph.edges) {
        const list = incoming.get(edge.target) ?? [];
        list.push(edge);
        incoming.set(edge.target, list);
    }
    const values = new Map();
    const debugNodes = [];
    const nodeResults = [];
    const debugErrors = [];
    const outputNodes = connector.graph.nodes.filter((node) => node.type === "output");
    const activeConversation = parsedInput.conversationId
        ? getAiConnectorConversationById(parsedInput.conversationId)
        : getAiConnectorConversationForConnector(connector.id);
    const publicInputValues = new Map();
    const nodePublicInputs = new Map();
    const nodePublicParams = new Map();
    for (const publicInput of connector.publicInputs) {
        const hasProvided = Object.prototype.hasOwnProperty.call(parsedInput.inputs, publicInput.key);
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
            throw new Error(`Flow input "${publicInput.label}" must match the ${publicInput.kind} type.`);
        }
        const bindings = normalizePublicInputBindings(connector, publicInput);
        if (bindings.length === 0) {
            throw new Error(`Flow input "${publicInput.label}" is not bound to any node input or parameter yet.`);
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
            const publicBindingValue = buildPublicInputValue(publicInput, resolvedValue);
            current.push({
                ...publicBindingValue,
                targetHandle: binding.targetKey
            });
            nodePublicInputs.set(binding.nodeId, current);
        }
    }
    const evaluateNode = async (nodeId) => {
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
        const graphUpstream = await Promise.all(upstreamEdges.map(async (edge) => {
            const upstreamValue = await evaluateNode(edge.source);
            const selected = readOutputSelection(upstreamValue, edge.sourceHandle);
            return {
                edge,
                sourceValue: upstreamValue,
                selected
            };
        }));
        const publicInputs = (nodePublicInputs.get(nodeId) ?? []).map((entry) => ({
            edge: {
                id: `${nodeId}_${entry.targetHandle}`,
                source: entry.sourceNodeId,
                target: nodeId,
                sourceHandle: entry.sourceHandle,
                targetHandle: entry.targetHandle,
                label: null
            },
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
            },
            selected: {
                text: entry.text,
                json: entry.json
            }
        }));
        const upstream = [...graphUpstream, ...publicInputs];
        const resolvedInputsForDebug = upstream.map((entry) => ({
            sourceNodeId: entry.edge.source,
            sourceHandle: entry.edge.sourceHandle ?? null,
            targetHandle: entry.edge.targetHandle ?? null,
            text: entry.selected.text,
            json: entry.selected.json
        }));
        let resolved;
        let nodeToolKeys = [];
        if (node.type === "box" || node.type === "box_input") {
            const boxId = node.data.boxId?.trim() || "";
            const resolvedInputs = Object.fromEntries(upstream.map(({ edge, selected }, index) => [
                edge.targetHandle ?? edge.sourceHandle ?? `input_${index + 1}`,
                selected.json ?? selected.text
            ]));
            const resolvedParams = {
                ...(node.data.paramValues && typeof node.data.paramValues === "object"
                    ? node.data.paramValues
                    : {}),
                ...(nodePublicParams.get(nodeId) ?? {})
            };
            const providedSnapshot = boxId ? parsedInput.boxSnapshots[boxId] : null;
            const snapshot = providedSnapshot && typeof providedSnapshot === "object"
                ? {
                    ...resolveForgeBoxSnapshot(boxId, {
                        actor: {
                            userIds: null,
                            source: "agent"
                        }
                    }, {
                        inputs: resolvedInputs,
                        params: resolvedParams
                    }),
                    contentJson: providedSnapshot
                }
                : boxId
                    ? resolveForgeBoxSnapshot(boxId, {
                        actor: {
                            userIds: null,
                            source: "agent"
                        }
                    }, {
                        inputs: resolvedInputs,
                        params: resolvedParams
                    })
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
                outputMap: buildOutputMap(snapshot.contentText, snapshot.contentJson, outputDefs),
                logs: []
            };
            nodeToolKeys = resolved.tools.map((tool) => tool.key);
        }
        else if (node.type === "value") {
            const parsedValue = parseValueLiteral(node.data.valueType ?? "string", node.data.valueLiteral ?? "");
            const jsonValue = parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
                ? parsedValue
                : null;
            const textValue = parsedValue === null
                ? "null"
                : typeof parsedValue === "string"
                    ? parsedValue
                    : JSON.stringify(parsedValue, null, 2);
            resolved = {
                text: textValue,
                json: jsonValue,
                tools: [],
                conversationId: null,
                outputMap: buildOutputMap(textValue, jsonValue, defaultOutputsForNode(node)),
                logs: []
            };
        }
        else if (node.type === "user_input") {
            const inputJson = Object.keys(parsedInput.context).length > 0
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
                outputMap: buildOutputMap(parsedInput.userInput || "", inputJson, defaultOutputsForNode(node)),
                logs: []
            };
        }
        else if (node.type === "merge") {
            const mergedText = upstream
                .map((entry) => entry.selected.text)
                .filter(Boolean)
                .join("\n\n");
            const mergedJson = Object.assign({}, ...upstream
                .map((entry) => entry.selected.json)
                .filter((entry) => Boolean(entry) && typeof entry === "object"));
            resolved = {
                text: mergedText,
                json: Object.keys(mergedJson).length > 0
                    ? {
                        merged: mergedJson
                    }
                    : {
                        merged: mergedText
                    },
                tools: upstream.flatMap((entry) => entry.sourceValue.tools),
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(mergedText, Object.keys(mergedJson).length > 0
                    ? {
                        merged: mergedJson
                    }
                    : {
                        merged: mergedText
                    }, defaultOutputsForNode(node)),
                logs: []
            };
        }
        else if (node.type === "template") {
            const primary = upstream[0]?.selected ?? { text: "", json: null };
            const rendered = (node.data.template ?? node.data.promptTemplate ?? "")
                .replaceAll("{{input}}", primary.text)
                .replaceAll("{{json}}", primary.json ? JSON.stringify(primary.json) : "");
            resolved = {
                text: rendered,
                json: {
                    rendered,
                    ...(tryParseJsonObject(rendered) ?? {})
                },
                tools: [],
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(rendered, {
                    rendered,
                    ...(tryParseJsonObject(rendered) ?? {})
                }, defaultOutputsForNode(node)),
                logs: []
            };
        }
        else if (node.type === "pick_key") {
            const primary = upstream[0]?.selected ?? { text: "", json: null };
            const selectedKey = node.data.selectedKey?.trim() || "";
            const selectedValue = primary.json && selectedKey in primary.json ? primary.json[selectedKey] : null;
            const selectedJson = selectedValue &&
                typeof selectedValue === "object" &&
                !Array.isArray(selectedValue)
                ? selectedValue
                : null;
            resolved = {
                text: coerceText(selectedValue),
                json: selectedJson ?? {
                    selected: selectedValue
                },
                tools: [],
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(coerceText(selectedValue), selectedJson ?? {
                    selected: selectedValue
                }, defaultOutputsForNode(node)),
                logs: []
            };
        }
        else if (node.type === "output") {
            const outputHandle = node.data.outputKey?.trim() || null;
            const publishedSelections = upstream.map((entry) => readOutputSelection(entry.sourceValue, outputHandle ?? entry.edge.sourceHandle));
            const mergedText = publishedSelections
                .map((entry) => entry.text)
                .filter(Boolean)
                .join("\n\n");
            const leadSelection = publishedSelections[0] ?? { text: mergedText, json: null };
            const publishedKey = outputHandle || "result";
            const publishedJson = leadSelection.json ?? {
                [publishedKey]: leadSelection.text
            };
            resolved = {
                text: mergedText,
                json: publishedJson,
                tools: [],
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(mergedText, publishedJson, defaultOutputsForNode(node)),
                logs: []
            };
        }
        else {
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
                outputMap: buildOutputMap(modelResult.text, modelResult.json, outputDefs),
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
    }
    catch (error) {
        debugErrors.push(error instanceof Error ? error.message : "Flow execution failed");
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
    const conversationProviderNode = connector.graph.nodes.find((node) => node.type === "chat");
    const resolvedConversationId = [...values.values()].find((entry) => entry.conversationId)?.conversationId ?? null;
    const nextConversation = conversationProviderNode
        ? createConversationRecord({
            connectorId: connector.id,
            provider: conversationProviderNode.data.modelConfig?.provider ?? null,
            externalConversationId: conversationProviderNode.data.modelConfig?.provider &&
                isOpenAiFamily({
                    provider: conversationProviderNode.data.modelConfig.provider,
                    baseUrl: conversationProviderNode.data.modelConfig.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
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
                            role: "user",
                            text: parsedInput.userInput,
                            createdAt: new Date().toISOString()
                        }
                    ]
                    : []),
                {
                    role: "assistant",
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
function migrateLegacyProcessor(processorId) {
    const processor = getAiProcessorById(processorId);
    if (!processor) {
        return null;
    }
    const existing = getDatabase()
        .prepare(`SELECT * FROM ai_connectors WHERE legacy_processor_id = ?`)
        .get(processorId);
    if (existing) {
        return mapConnector(existing);
    }
    const sourceLinks = listAiProcessorLinks(processor.surfaceId).filter((link) => link.targetProcessorId === processor.id);
    const inputNodes = sourceLinks.map((link, index) => ({
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
    const modelNode = {
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
    const outputNode = {
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
    ensureLegacyProcessorsMigrated();
    const rows = getDatabase()
        .prepare(`SELECT * FROM ai_connectors ORDER BY created_at ASC`)
        .all();
    return rows.map(mapConnector);
}
export function getAiConnectorById(connectorId) {
    ensureLegacyProcessorsMigrated();
    const row = getDatabase()
        .prepare(`SELECT * FROM ai_connectors WHERE id = ?`)
        .get(connectorId);
    return row ? mapConnector(row) : null;
}
export function getAiConnectorBySlug(slug) {
    ensureLegacyProcessorsMigrated();
    const row = getDatabase()
        .prepare(`SELECT * FROM ai_connectors WHERE slug = ?`)
        .get(slug);
    return row ? mapConnector(row) : null;
}
export function createAiConnector(input) {
    const parsed = createAiConnectorSchema.parse(input);
    const now = new Date().toISOString();
    const id = `aic_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const slug = buildConnectorSlug(parsed.title, id);
    const graph = normalizeConnectorGraph(parsed.graph.nodes.length > 0 ? parsed.graph : buildDefaultGraph(parsed.kind, parsed.title));
    const publishedOutputs = ensurePublishedOutputs(id, graph);
    getDatabase()
        .prepare(`INSERT INTO ai_connectors (
        id, slug, title, description, kind, home_surface_id, endpoint_enabled, graph_json, public_inputs_json, published_outputs_json, last_run_json, legacy_processor_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, slug, parsed.title, parsed.description, parsed.kind, parsed.homeSurfaceId, parsed.endpointEnabled ? 1 : 0, JSON.stringify(graph), JSON.stringify(parsed.publicInputs), JSON.stringify(publishedOutputs), null, input.legacyProcessorId ?? null, now, now);
    return getAiConnectorById(id);
}
export function updateAiConnector(connectorId, patch) {
    const current = getAiConnectorById(connectorId);
    if (!current) {
        return null;
    }
    const parsed = updateAiConnectorSchema.parse(patch);
    const nextGraph = normalizeConnectorGraph(parsed.graph ?? current.graph);
    validateConnectorGraph(nextGraph);
    const nextTitle = parsed.title ?? current.title;
    const next = {
        ...current,
        ...parsed,
        title: nextTitle,
        slug: parsed.title && parsed.title !== current.title
            ? buildConnectorSlug(parsed.title, current.id)
            : current.slug,
        graph: nextGraph,
        publicInputs: parsed.publicInputs ?? current.publicInputs,
        publishedOutputs: ensurePublishedOutputs(current.id, nextGraph)
    };
    const now = new Date().toISOString();
    getDatabase()
        .prepare(`UPDATE ai_connectors
       SET slug = ?, title = ?, description = ?, kind = ?, home_surface_id = ?, endpoint_enabled = ?, graph_json = ?, public_inputs_json = ?, published_outputs_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.slug, next.title, next.description, next.kind, next.homeSurfaceId, next.endpointEnabled ? 1 : 0, JSON.stringify(next.graph), JSON.stringify(next.publicInputs), JSON.stringify(next.publishedOutputs), now, connectorId);
    return getAiConnectorById(connectorId);
}
export function deleteAiConnector(connectorId) {
    const current = getAiConnectorById(connectorId);
    if (!current) {
        return null;
    }
    getDatabase().prepare(`DELETE FROM ai_connectors WHERE id = ?`).run(connectorId);
    return current;
}
export async function runAiConnector(connectorId, input, services, mode = "run") {
    const connector = getAiConnectorById(connectorId);
    if (!connector) {
        throw new Error(`Connector ${connectorId} was not found.`);
    }
    const pendingRun = aiConnectorRunSchema.parse({
        id: `aicr_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        connectorId,
        mode,
        status: "running",
        userInput: input.userInput ?? "",
        inputs: input.inputs ?? {},
        context: input.context ?? {},
        conversationId: input.conversationId ?? null,
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null
    });
    insertRun(pendingRun);
    try {
        const execution = await executeConnector(connector, input, services);
        const completedRun = aiConnectorRunSchema.parse({
            ...pendingRun,
            status: "completed",
            result: execution.result,
            conversationId: execution.conversation?.id ?? pendingRun.conversationId,
            completedAt: new Date().toISOString()
        });
        insertRun(completedRun);
        return {
            connector: getAiConnectorById(connectorId),
            run: completedRun,
            conversation: execution.conversation
        };
    }
    catch (error) {
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
