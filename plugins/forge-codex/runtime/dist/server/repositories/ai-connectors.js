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
                    outputKey: "primary",
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
                outputId: "primary"
            })
        ].map((entry) => ({
            id: entry.boxId.replace(/^connector-output:/, ""),
            nodeId: "node_output",
            label: entry.label,
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
    return aiConnectorSchema.parse({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        kind: row.kind,
        homeSurfaceId: row.home_surface_id,
        endpointEnabled: row.endpoint_enabled === 1,
        graph: parseJson(row.graph_json, { nodes: [], edges: [] }),
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
        id, connector_id, mode, status, user_input, context_json, conversation_id, result_json, error, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        connector_id = excluded.connector_id,
        mode = excluded.mode,
        status = excluded.status,
        user_input = excluded.user_input,
        context_json = excluded.context_json,
        conversation_id = excluded.conversation_id,
        result_json = excluded.result_json,
        error = excluded.error,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at`)
        .run(input.id, input.connectorId, input.mode, input.status, input.userInput, JSON.stringify(input.context), input.conversationId, input.result ? JSON.stringify(input.result) : null, input.error, input.createdAt, input.completedAt);
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
        return JSON.parse(value);
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
function buildOutputMap(primaryText, primaryJson, outputKeys = []) {
    const outputMap = {
        primary: {
            text: primaryText,
            json: primaryJson
        }
    };
    for (const key of outputKeys) {
        if (!primaryJson || !(key in primaryJson)) {
            continue;
        }
        const value = primaryJson[key];
        outputMap[key] = {
            text: coerceText(value),
            json: value && typeof value === "object" && !Array.isArray(value)
                ? value
                : null
        };
    }
    return outputMap;
}
function readOutputSelection(value, handle) {
    if (!handle || handle === "primary") {
        return { text: value.text, json: value.json };
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
        input.upstream.length > 0
            ? `Linked inputs:\n${input.upstream
                .map((entry, index) => `Input ${index + 1}:\n${entry.text}${entry.json ? `\nJSON: ${JSON.stringify(entry.json)}` : ""}`)
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
    if (!explicitApiKey) {
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
        apiKey: explicitApiKey
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
                        .map((tool) => `${tool.key} (${tool.description})`)
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
            transcript
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
                logs: transcript
            };
        }
        const structured = tryParseStructuredAgentResponse(rawText.trim());
        if (!structured || structured.action === "final") {
            return {
                text: structured?.text?.trim() || rawText.trim(),
                json: tryParseJsonObject(structured?.text?.trim() || rawText.trim()),
                conversationId,
                logs: transcript
            };
        }
        const toolResult = structured.tool.startsWith("machine_")
            ? await executeMachineTool(structured.tool, structured.args)
            : await executeForgeBoxTool(activeTools.find((tool) => tool.key === structured.tool)?.boxId ?? "", structured.tool, structured.args);
        transcript.push(`Tool call ${structured.tool}: ${JSON.stringify(structured.args)}`, `Tool result: ${JSON.stringify(toolResult)}`);
    }
    return {
        text: "Connector stopped after reaching the maximum tool step count.",
        json: null,
        conversationId,
        logs: transcript
    };
}
function validateConnectorGraph(graph) {
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
}
function buildOutputResult(connector, resolvedNodeValues) {
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
        outputs
    });
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
    const debugErrors = [];
    const outputNodes = connector.graph.nodes.filter((node) => node.type === "output");
    const activeConversation = parsedInput.conversationId
        ? getAiConnectorConversationById(parsedInput.conversationId)
        : getAiConnectorConversationForConnector(connector.id);
    const evaluateNode = async (nodeId) => {
        const existing = values.get(nodeId);
        if (existing) {
            return existing;
        }
        const node = connector.graph.nodes.find((entry) => entry.id === nodeId);
        if (!node) {
            throw new Error(`Missing connector node ${nodeId}.`);
        }
        const upstreamEdges = incoming.get(nodeId) ?? [];
        const upstream = await Promise.all(upstreamEdges.map(async (edge) => {
            const upstreamValue = await evaluateNode(edge.source);
            const selected = readOutputSelection(upstreamValue, edge.sourceHandle);
            return {
                edge,
                sourceValue: upstreamValue,
                selected
            };
        }));
        let resolved;
        if (node.type === "box" || node.type === "box_input") {
            const boxId = node.data.boxId?.trim() || "";
            const providedSnapshot = boxId ? parsedInput.boxSnapshots[boxId] : null;
            const snapshot = providedSnapshot && typeof providedSnapshot === "object"
                ? {
                    ...resolveForgeBoxSnapshot(boxId),
                    contentJson: providedSnapshot
                }
                : boxId
                    ? resolveForgeBoxSnapshot(boxId)
                    : {
                        boxId: "",
                        label: node.data.label,
                        capturedAt: new Date().toISOString(),
                        contentText: "No box is configured for this node yet.",
                        contentJson: null,
                        tools: []
                    };
            const outputKeys = [
                ...(node.data.outputs ?? []).map((port) => port.key),
                ...Object.keys(snapshot.contentJson ?? {})
            ];
            resolved = {
                text: snapshot.contentText,
                json: snapshot.contentJson,
                tools: snapshot.tools.map((tool) => ({
                    boxId: snapshot.boxId,
                    key: tool.key,
                    label: tool.label,
                    description: tool.description
                })),
                conversationId: null,
                outputMap: buildOutputMap(snapshot.contentText, snapshot.contentJson, outputKeys),
                logs: []
            };
        }
        else if (node.type === "user_input") {
            resolved = {
                text: parsedInput.userInput || "",
                json: Object.keys(parsedInput.context).length > 0 ? parsedInput.context : null,
                tools: [],
                conversationId: activeConversation?.id ?? null,
                outputMap: buildOutputMap(parsedInput.userInput || "", Object.keys(parsedInput.context).length > 0 ? parsedInput.context : null, Object.keys(parsedInput.context ?? {})),
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
                json: Object.keys(mergedJson).length > 0 ? mergedJson : null,
                tools: upstream.flatMap((entry) => entry.sourceValue.tools),
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(mergedText, Object.keys(mergedJson).length > 0 ? mergedJson : null, Object.keys(mergedJson)),
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
                json: tryParseJsonObject(rendered),
                tools: [],
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(rendered, tryParseJsonObject(rendered)),
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
                json: selectedJson,
                tools: [],
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(coerceText(selectedValue), selectedJson),
                logs: []
            };
        }
        else if (node.type === "output") {
            const mergedText = upstream
                .map((entry) => entry.selected.text)
                .filter(Boolean)
                .join("\n\n");
            resolved = {
                text: mergedText,
                json: upstream[0]?.selected.json ?? null,
                tools: [],
                conversationId: upstream.find((entry) => entry.sourceValue.conversationId)?.sourceValue
                    .conversationId ?? null,
                outputMap: buildOutputMap(mergedText, upstream[0]?.selected.json ?? null, Object.keys(upstream[0]?.selected.json ?? {})),
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
                    logs: entry.sourceValue.logs
                })),
                services,
                conversation: activeConversation
            });
            const outputKeys = (node.data.outputs ?? []).map((port) => port.key);
            resolved = {
                text: modelResult.text,
                json: modelResult.json,
                tools: [],
                conversationId: modelResult.conversationId,
                outputMap: buildOutputMap(modelResult.text, modelResult.json, outputKeys),
                logs: modelResult.logs
            };
        }
        values.set(nodeId, resolved);
        debugNodes.push({
            nodeId: node.id,
            nodeType: node.type,
            label: node.data.label,
            input: upstream.map((entry) => ({
                sourceNodeId: entry.edge.source,
                sourceHandle: entry.edge.sourceHandle ?? null,
                targetHandle: entry.edge.targetHandle ?? null,
                text: entry.selected.text,
                json: entry.selected.json
            })),
            output: {
                text: resolved.text,
                json: resolved.json
            },
            tools: resolved.tools.map((tool) => tool.key),
            logs: resolved.logs,
            error: null
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
        ...buildOutputResult(connector, values),
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
            outputKey: "primary",
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
    const graph = parsed.graph.nodes.length > 0 ? parsed.graph : buildDefaultGraph(parsed.kind, parsed.title);
    const publishedOutputs = ensurePublishedOutputs(id, graph);
    getDatabase()
        .prepare(`INSERT INTO ai_connectors (
        id, slug, title, description, kind, home_surface_id, endpoint_enabled, graph_json, published_outputs_json, last_run_json, legacy_processor_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, slug, parsed.title, parsed.description, parsed.kind, parsed.homeSurfaceId, parsed.endpointEnabled ? 1 : 0, JSON.stringify(graph), JSON.stringify(publishedOutputs), null, input.legacyProcessorId ?? null, now, now);
    return getAiConnectorById(id);
}
export function updateAiConnector(connectorId, patch) {
    const current = getAiConnectorById(connectorId);
    if (!current) {
        return null;
    }
    const parsed = updateAiConnectorSchema.parse(patch);
    const nextGraph = parsed.graph ?? current.graph;
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
        publishedOutputs: ensurePublishedOutputs(current.id, nextGraph)
    };
    const now = new Date().toISOString();
    getDatabase()
        .prepare(`UPDATE ai_connectors
       SET slug = ?, title = ?, description = ?, kind = ?, home_surface_id = ?, endpoint_enabled = ?, graph_json = ?, published_outputs_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.slug, next.title, next.description, next.kind, next.homeSurfaceId, next.endpointEnabled ? 1 : 0, JSON.stringify(next.graph), JSON.stringify(next.publishedOutputs), now, connectorId);
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
