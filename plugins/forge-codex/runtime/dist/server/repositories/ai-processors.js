import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { aiProcessorLinkSchema, aiProcessorSchema, createAiProcessorLinkSchema, createAiProcessorSchema, runAiProcessorSchema, surfaceProcessorGraphPayloadSchema, updateAiProcessorSchema } from "../types.js";
import { FORGE_DEFAULT_AGENT_ID, getAiModelConnectionById, listAiModelConnections, readModelConnectionCredential } from "./model-settings.js";
import { getSettings } from "./settings.js";
function parseJson(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    }
    catch {
        return fallback;
    }
}
function mapProcessor(row) {
    return aiProcessorSchema.parse({
        id: row.id,
        surfaceId: row.surface_id,
        title: row.title,
        promptFlow: row.prompt_flow,
        contextInput: row.context_input,
        toolConfig: parseJson(row.tool_config_json, []),
        agentIds: parseJson(row.agent_ids_json, []),
        triggerMode: row.trigger_mode,
        cronExpression: row.cron_expression,
        machineAccess: parseJson(row.machine_access_json, {
            read: false,
            write: false,
            exec: false
        }),
        endpointEnabled: row.endpoint_enabled === 1,
        lastRunAt: row.last_run_at,
        lastRunStatus: row.last_run_status,
        lastRunOutput: parseJson(row.last_run_output_json, null),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapLink(row) {
    return aiProcessorLinkSchema.parse({
        id: row.id,
        surfaceId: row.surface_id,
        sourceWidgetId: row.source_widget_id,
        targetProcessorId: row.target_processor_id,
        accessMode: row.access_mode,
        capabilityMode: row.capability_mode,
        metadata: parseJson(row.metadata_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
export function listAiProcessors(surfaceId) {
    const rows = surfaceId
        ? (getDatabase()
            .prepare(`SELECT * FROM ai_processors WHERE surface_id = ? ORDER BY created_at ASC`)
            .all(surfaceId) ?? [])
        : (getDatabase()
            .prepare(`SELECT * FROM ai_processors ORDER BY created_at ASC`)
            .all() ?? []);
    return rows.map(mapProcessor);
}
export function getAiProcessorById(processorId) {
    const row = getDatabase()
        .prepare(`SELECT * FROM ai_processors WHERE id = ?`)
        .get(processorId);
    return row ? mapProcessor(row) : null;
}
export function listAiProcessorLinks(surfaceId) {
    const rows = surfaceId
        ? (getDatabase()
            .prepare(`SELECT * FROM ai_processor_links WHERE surface_id = ? ORDER BY created_at ASC`)
            .all(surfaceId) ?? [])
        : (getDatabase()
            .prepare(`SELECT * FROM ai_processor_links ORDER BY created_at ASC`)
            .all() ?? []);
    return rows.map(mapLink);
}
export function getSurfaceProcessorGraph(surfaceId) {
    return surfaceProcessorGraphPayloadSchema.parse({
        surfaceId,
        processors: listAiProcessors(surfaceId),
        links: listAiProcessorLinks(surfaceId)
    });
}
export function createAiProcessor(input) {
    const parsed = createAiProcessorSchema.parse(input);
    const now = new Date().toISOString();
    const id = `aip_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO ai_processors (
        id, surface_id, title, prompt_flow, context_input, tool_config_json, agent_ids_json, trigger_mode, cron_expression, machine_access_json, endpoint_enabled, last_run_at, last_run_status, last_run_output_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, parsed.surfaceId, parsed.title, parsed.promptFlow, parsed.contextInput, JSON.stringify(parsed.toolConfig), JSON.stringify(parsed.agentIds), parsed.triggerMode, parsed.cronExpression, JSON.stringify(parsed.machineAccess), parsed.endpointEnabled ? 1 : 0, null, "idle", null, now, now);
    return getAiProcessorById(id);
}
export function updateAiProcessor(processorId, patch) {
    const current = getAiProcessorById(processorId);
    if (!current) {
        return null;
    }
    const parsed = updateAiProcessorSchema.parse(patch);
    const next = {
        ...current,
        ...parsed,
        machineAccess: {
            ...current.machineAccess,
            ...(parsed.machineAccess ?? {})
        }
    };
    const now = new Date().toISOString();
    getDatabase()
        .prepare(`UPDATE ai_processors
       SET title = ?, prompt_flow = ?, context_input = ?, tool_config_json = ?, agent_ids_json = ?, trigger_mode = ?, cron_expression = ?, machine_access_json = ?, endpoint_enabled = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.title, next.promptFlow, next.contextInput, JSON.stringify(next.toolConfig), JSON.stringify(next.agentIds), next.triggerMode, next.cronExpression, JSON.stringify(next.machineAccess), next.endpointEnabled ? 1 : 0, now, processorId);
    return getAiProcessorById(processorId);
}
export function deleteAiProcessor(processorId) {
    const current = getAiProcessorById(processorId);
    if (!current) {
        return null;
    }
    getDatabase().prepare(`DELETE FROM ai_processors WHERE id = ?`).run(processorId);
    return current;
}
export function createAiProcessorLink(input) {
    const parsed = createAiProcessorLinkSchema.parse(input);
    const existing = listAiProcessorLinks(parsed.surfaceId).find((link) => link.sourceWidgetId === parsed.sourceWidgetId &&
        link.targetProcessorId === parsed.targetProcessorId);
    const now = new Date().toISOString();
    const id = existing?.id ?? `ail_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO ai_processor_links (
        id, surface_id, source_widget_id, target_processor_id, access_mode, capability_mode, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        access_mode = excluded.access_mode,
        capability_mode = excluded.capability_mode,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`)
        .run(id, parsed.surfaceId, parsed.sourceWidgetId, parsed.targetProcessorId, parsed.accessMode, parsed.capabilityMode, JSON.stringify(parsed.metadata), existing?.createdAt ?? now, now);
    return listAiProcessorLinks(parsed.surfaceId).find((entry) => entry.id === id);
}
export function deleteAiProcessorLink(linkId) {
    const existing = listAiProcessorLinks().find((entry) => entry.id === linkId);
    if (!existing) {
        return null;
    }
    getDatabase().prepare(`DELETE FROM ai_processor_links WHERE id = ?`).run(linkId);
    return existing;
}
function resolveProcessorAgentProfiles(processor, secrets) {
    const allConnections = listAiModelConnections();
    const requestedAgentIds = processor.agentIds.length > 0 ? processor.agentIds : [FORGE_DEFAULT_AGENT_ID];
    const settings = getSettings();
    return requestedAgentIds.map((agentId) => {
        let connection = allConnections.find((entry) => entry.agentId === agentId) ?? null;
        if (agentId === FORGE_DEFAULT_AGENT_ID) {
            const selected = settings.modelSettings.forgeAgent.basicChat.connectionId;
            connection = selected ? getAiModelConnectionById(selected) : null;
        }
        if (!connection) {
            return {
                agentId,
                agentLabel: agentId === FORGE_DEFAULT_AGENT_ID ? "Forge Agent" : agentId,
                profile: null,
                explicitApiKey: null
            };
        }
        const credential = readModelConnectionCredential(connection.id, secrets);
        const explicitApiKey = credential?.kind === "api_key"
            ? credential.apiKey
            : credential?.kind === "oauth"
                ? credential.access
                : null;
        return {
            agentId,
            agentLabel: agentId === FORGE_DEFAULT_AGENT_ID
                ? "Forge Agent"
                : connection.agentLabel,
            profile: {
                provider: connection.provider,
                baseUrl: connection.baseUrl,
                model: connection.model,
                systemPrompt: "",
                secretId: null,
                metadata: {}
            },
            explicitApiKey
        };
    });
}
export async function runAiProcessor(processorId, input, services) {
    const processor = getAiProcessorById(processorId);
    if (!processor) {
        throw new Error("AI processor not found.");
    }
    const parsed = runAiProcessorSchema.parse(input);
    const links = listAiProcessorLinks(processor.surfaceId).filter((link) => link.targetProcessorId === processor.id);
    const linkedContext = links
        .map((link) => `Linked widget ${link.sourceWidgetId} offers ${link.capabilityMode} access (${link.accessMode}). Metadata: ${JSON.stringify(link.metadata)}`)
        .join("\n");
    const fullPrompt = [
        processor.promptFlow.trim(),
        processor.contextInput.trim()
            ? `Processor context:\n${processor.contextInput.trim()}`
            : "",
        linkedContext ? `Linked capabilities:\n${linkedContext}` : "",
        parsed.input.trim() ? `Runtime input:\n${parsed.input.trim()}` : "",
        Object.keys(parsed.context).length > 0
            ? `Structured context:\n${JSON.stringify(parsed.context, null, 2)}`
            : ""
    ]
        .filter(Boolean)
        .join("\n\n");
    const now = new Date().toISOString();
    getDatabase()
        .prepare(`UPDATE ai_processors SET last_run_at = ?, last_run_status = ?, updated_at = ? WHERE id = ?`)
        .run(now, "running", now, processor.id);
    const agents = resolveProcessorAgentProfiles(processor, services.secrets);
    const outputsByAgent = {};
    await Promise.all(agents.map(async (agent) => {
        if (!agent.profile) {
            outputsByAgent[agent.agentLabel] =
                "No model connection is configured for this agent yet.";
            return;
        }
        const result = await services.llm.runTextPrompt(agent.profile, {
            explicitApiKey: agent.explicitApiKey,
            systemPrompt: "You are an AI processor widget inside Forge. Follow the given prompt flow and return the final output only.",
            prompt: fullPrompt
        });
        outputsByAgent[agent.agentLabel] = result.outputText.trim();
    }));
    const concatenated = Object.entries(outputsByAgent)
        .map(([agentLabel, output]) => `${agentLabel}\n${output}`.trim())
        .join("\n\n");
    const finalNow = new Date().toISOString();
    getDatabase()
        .prepare(`UPDATE ai_processors
       SET last_run_at = ?, last_run_status = ?, last_run_output_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(finalNow, "completed", JSON.stringify({
        concatenated,
        byAgent: outputsByAgent
    }), finalNow, processor.id);
    return {
        processor: getAiProcessorById(processor.id),
        output: {
            concatenated,
            byAgent: outputsByAgent
        }
    };
}
