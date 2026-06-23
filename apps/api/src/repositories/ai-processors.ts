import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { getDatabase } from "../db.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  aiProcessorLinkSchema,
  aiProcessorSchema,
  createAiProcessorLinkSchema,
  createAiProcessorSchema,
  runAiProcessorSchema,
  surfaceProcessorGraphPayloadSchema,
  updateAiProcessorSchema,
  type AiProcessor,
  type AiProcessorLink,
  type CreateAiProcessorInput,
  type CreateAiProcessorLinkInput,
  type RunAiProcessorInput,
  type SurfaceProcessorGraphPayload,
  type UpdateAiProcessorInput
} from "../types.js";
import { LlmManager } from "../managers/platform/llm-manager.js";
import {
  FORGE_DEFAULT_AGENT_ID,
  getAiModelConnectionById,
  listAiModelConnections,
  readModelConnectionCredential
} from "./model-settings.js";
import { getSettings } from "./settings.js";

const MAX_RUN_HISTORY = 12;
const MAX_TOOL_STEPS = 6;
const execFile = promisify(execFileCallback);

type AiProcessorRow = {
  id: string;
  slug: string;
  surface_id: string;
  title: string;
  prompt_flow: string;
  context_input: string;
  tool_config_json: string;
  agent_ids_json: string;
  agent_config_json: string;
  trigger_mode: "manual" | "route" | "cron";
  cron_expression: string;
  machine_access_json: string;
  endpoint_enabled: number;
  last_run_at: string | null;
  last_run_status: "idle" | "running" | "completed" | "failed" | null;
  last_run_output_json: string | null;
  run_history_json: string;
  created_at: string;
  updated_at: string;
};

type AiProcessorLinkRow = {
  id: string;
  surface_id: string;
  source_widget_id: string;
  target_processor_id: string;
  access_mode: "read" | "write" | "read_write" | "exec";
  capability_mode: "content" | "tool" | "mcp" | "processor";
  metadata_json: string;
  created_at: string;
  updated_at: string;
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
  return normalized || "processor";
}

function buildProcessorSlug(title: string, id: string) {
  return `${slugifySegment(title)}-${id.slice(-6)}`;
}

function processorWidgetId(processorId: string) {
  return `aiproc:${processorId}`;
}

function processorIdFromNodeId(nodeId: string) {
  return nodeId.startsWith("aiproc:") ? nodeId.slice("aiproc:".length) : null;
}

function resolveAllowedPath(inputPath: string) {
  const candidate = path.resolve(process.cwd(), inputPath);
  const workspaceRoot = process.cwd();
  if (
    candidate !== workspaceRoot &&
    !candidate.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error("Machine access is restricted to the Forge workspace root.");
  }
  return candidate;
}

function tryParseStructuredAgentResponse(value: string) {
  try {
    return JSON.parse(value) as
      | {
          action: "final";
          text: string;
        }
      | {
          action: "tool";
          tool: "machine_read_file" | "machine_write_file" | "machine_exec";
          args: Record<string, unknown>;
        };
  } catch {
    return null;
  }
}

async function executeMachineTool(
  processor: AiProcessor,
  tool: "machine_read_file" | "machine_write_file" | "machine_exec",
  args: Record<string, unknown>
) {
  if (tool === "machine_read_file") {
    if (!processor.machineAccess.read) {
      throw new Error("Read access is disabled for this processor.");
    }
    const targetPath =
      typeof args.path === "string" ? resolveAllowedPath(args.path) : null;
    if (!targetPath) {
      throw new Error("machine_read_file requires a string path.");
    }
    const content = await readFile(targetPath, "utf8");
    return {
      path: targetPath,
      content
    };
  }

  if (tool === "machine_write_file") {
    if (!processor.machineAccess.write) {
      throw new Error("Write access is disabled for this processor.");
    }
    const targetPath =
      typeof args.path === "string" ? resolveAllowedPath(args.path) : null;
    if (!targetPath) {
      throw new Error("machine_write_file requires a string path.");
    }
    if (typeof args.content !== "string") {
      throw new Error("machine_write_file requires string content.");
    }
    await writeFile(targetPath, args.content, "utf8");
    return {
      path: targetPath,
      bytesWritten: Buffer.byteLength(args.content, "utf8")
    };
  }

  if (!processor.machineAccess.exec) {
    throw new Error("Exec access is disabled for this processor.");
  }
  if (typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new Error("machine_exec requires a command string.");
  }
  const cwd =
    typeof args.cwd === "string" && args.cwd.trim().length > 0
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

async function runProcessorAgent(
  processor: AiProcessor,
  agent: ReturnType<typeof resolveProcessorAgentProfiles>[number],
  fullPrompt: string,
  services: {
    llm: LlmManager;
  }
) {
  if (!agent.profile) {
    return "No model connection is configured for this agent yet.";
  }

  const toolNames = [
    processor.machineAccess.read ? "machine_read_file(path)" : null,
    processor.machineAccess.write
      ? "machine_write_file(path, content)"
      : null,
    processor.machineAccess.exec ? "machine_exec(command, cwd?)" : null
  ].filter(Boolean);

  if (toolNames.length === 0) {
    const result = await services.llm.runTextPrompt(agent.profile, {
      explicitApiKey: agent.explicitApiKey,
      systemPrompt:
        "You are an AI processor inside Forge. Follow the prompt flow exactly, use the linked context carefully, and return only the final output for your assigned agent.",
      prompt: fullPrompt
    });
    return result.outputText.trim();
  }

  const transcript: string[] = [];
  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const result = await services.llm.runTextPrompt(agent.profile, {
      explicitApiKey: agent.explicitApiKey,
      systemPrompt: [
        "You are an AI processor inside Forge.",
        "You may use machine tools when they are enabled.",
        `Available tools: ${toolNames.join(", ")}.`,
        "Return strict JSON only.",
        'For a final answer, return {"action":"final","text":"..."}',
        'To call a tool, return {"action":"tool","tool":"machine_exec","args":{...}}'
      ].join(" "),
      prompt: [
        fullPrompt,
        transcript.length > 0
          ? `Tool transcript:\n${transcript.join("\n\n")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    });
    const structured = tryParseStructuredAgentResponse(result.outputText.trim());
    if (!structured || structured.action === "final") {
      return structured?.text?.trim() || result.outputText.trim();
    }
    const toolResult = await executeMachineTool(
      processor,
      structured.tool,
      structured.args
    );
    transcript.push(
      `Tool call ${structured.tool}: ${JSON.stringify(structured.args)}`,
      `Tool result: ${JSON.stringify(toolResult)}`
    );
  }

  return "Processor stopped after reaching the maximum tool step count.";
}

function mapProcessor(row: AiProcessorRow): AiProcessor {
  return aiProcessorSchema.parse({
    id: row.id,
    slug: row.slug,
    surfaceId: row.surface_id,
    title: row.title,
    promptFlow: row.prompt_flow,
    contextInput: row.context_input,
    toolConfig: parseJson(row.tool_config_json, []),
    agentIds: parseJson(row.agent_ids_json, []),
    agentConfigs: parseJson(row.agent_config_json, []),
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
    runHistory: parseJson(row.run_history_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapLink(row: AiProcessorLinkRow): AiProcessorLink {
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

export function listAiProcessors(surfaceId?: string) {
  const rows = surfaceId
    ? ((getDatabase()
        .prepare(
          `SELECT * FROM ai_processors WHERE surface_id = ? ORDER BY created_at ASC`
        )
        .all(surfaceId) as AiProcessorRow[]) ?? [])
    : ((getDatabase()
        .prepare(`SELECT * FROM ai_processors ORDER BY created_at ASC`)
        .all() as AiProcessorRow[]) ?? []);
  return rows.map(mapProcessor);
}

export function getAiProcessorById(processorId: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM ai_processors WHERE id = ?`)
    .get(processorId) as AiProcessorRow | undefined;
  return row ? mapProcessor(row) : null;
}

export function getAiProcessorBySlug(slug: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM ai_processors WHERE slug = ?`)
    .get(slug) as AiProcessorRow | undefined;
  return row ? mapProcessor(row) : null;
}

export function listAiProcessorLinks(surfaceId?: string) {
  const rows = surfaceId
    ? ((getDatabase()
        .prepare(
          `SELECT * FROM ai_processor_links WHERE surface_id = ? ORDER BY created_at ASC`
        )
        .all(surfaceId) as AiProcessorLinkRow[]) ?? [])
    : ((getDatabase()
        .prepare(`SELECT * FROM ai_processor_links ORDER BY created_at ASC`)
        .all() as AiProcessorLinkRow[]) ?? []);
  return rows.map(mapLink);
}

export function getSurfaceProcessorGraph(surfaceId: string): SurfaceProcessorGraphPayload {
  return surfaceProcessorGraphPayloadSchema.parse({
    surfaceId,
    processors: listAiProcessors(surfaceId),
    links: listAiProcessorLinks(surfaceId)
  });
}

export function createAiProcessor(input: CreateAiProcessorInput) {
  const parsed = createAiProcessorSchema.parse(input);
  const now = new Date().toISOString();
  const id = `aip_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const slug = buildProcessorSlug(parsed.title, id);
  getDatabase()
    .prepare(
      `INSERT INTO ai_processors (
        id, slug, surface_id, title, prompt_flow, context_input, tool_config_json, agent_ids_json, agent_config_json, trigger_mode, cron_expression, machine_access_json, endpoint_enabled, last_run_at, last_run_status, last_run_output_json, run_history_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      slug,
      parsed.surfaceId,
      parsed.title,
      parsed.promptFlow,
      parsed.contextInput,
      JSON.stringify(parsed.toolConfig),
      JSON.stringify(parsed.agentIds),
      JSON.stringify(parsed.agentConfigs),
      parsed.triggerMode,
      parsed.cronExpression,
      JSON.stringify(parsed.machineAccess),
      parsed.endpointEnabled ? 1 : 0,
      null,
      "idle",
      null,
      "[]",
      now,
      now
    );
  return getAiProcessorById(id)!;
}

export function updateAiProcessor(processorId: string, patch: UpdateAiProcessorInput) {
  const current = getAiProcessorById(processorId);
  if (!current) {
    return null;
  }
  const parsed = updateAiProcessorSchema.parse(patch);
  const next = {
    ...current,
    ...parsed,
    slug:
      parsed.title && parsed.title !== current.title
        ? buildProcessorSlug(parsed.title, current.id)
        : current.slug,
    machineAccess: {
      ...current.machineAccess,
      ...(parsed.machineAccess ?? {})
    }
  };
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE ai_processors
       SET slug = ?, title = ?, prompt_flow = ?, context_input = ?, tool_config_json = ?, agent_ids_json = ?, agent_config_json = ?, trigger_mode = ?, cron_expression = ?, machine_access_json = ?, endpoint_enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.slug,
      next.title,
      next.promptFlow,
      next.contextInput,
      JSON.stringify(next.toolConfig),
      JSON.stringify(next.agentIds),
      JSON.stringify(next.agentConfigs),
      next.triggerMode,
      next.cronExpression,
      JSON.stringify(next.machineAccess),
      next.endpointEnabled ? 1 : 0,
      now,
      processorId
    );
  return getAiProcessorById(processorId)!;
}

export function deleteAiProcessor(processorId: string) {
  const current = getAiProcessorById(processorId);
  if (!current) {
    return null;
  }
  getDatabase().prepare(`DELETE FROM ai_processors WHERE id = ?`).run(processorId);
  return current;
}

function assertProcessorGraphEdgeIsValid(input: CreateAiProcessorLinkInput) {
  const sourceProcessorId = processorIdFromNodeId(input.sourceWidgetId);
  if (!sourceProcessorId) {
    return;
  }
  if (sourceProcessorId === input.targetProcessorId) {
    throw new Error("AI processor links cannot point a processor to itself.");
  }
  const links = listAiProcessorLinks(input.surfaceId);
  const adjacency = new Map<string, Set<string>>();
  for (const link of links) {
    const upstreamProcessorId = processorIdFromNodeId(link.sourceWidgetId);
    if (!upstreamProcessorId) {
      continue;
    }
    const current = adjacency.get(upstreamProcessorId) ?? new Set<string>();
    current.add(link.targetProcessorId);
    adjacency.set(upstreamProcessorId, current);
  }
  const nextTargets = adjacency.get(sourceProcessorId) ?? new Set<string>();
  nextTargets.add(input.targetProcessorId);
  adjacency.set(sourceProcessorId, nextTargets);

  const seen = new Set<string>();
  const stack = [input.targetProcessorId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceProcessorId) {
      throw new Error("This link would create a processor cycle.");
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      stack.push(next);
    }
  }
}

export function createAiProcessorLink(input: CreateAiProcessorLinkInput) {
  const parsed = createAiProcessorLinkSchema.parse(input);
  assertProcessorGraphEdgeIsValid(parsed);
  const existing = listAiProcessorLinks(parsed.surfaceId).find(
    (link) =>
      link.sourceWidgetId === parsed.sourceWidgetId &&
      link.targetProcessorId === parsed.targetProcessorId
  );
  const now = new Date().toISOString();
  const id = existing?.id ?? `ail_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO ai_processor_links (
        id, surface_id, source_widget_id, target_processor_id, access_mode, capability_mode, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        access_mode = excluded.access_mode,
        capability_mode = excluded.capability_mode,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`
    )
    .run(
      id,
      parsed.surfaceId,
      parsed.sourceWidgetId,
      parsed.targetProcessorId,
      parsed.accessMode,
      parsed.capabilityMode,
      JSON.stringify(parsed.metadata),
      existing?.createdAt ?? now,
      now
    );
  return listAiProcessorLinks(parsed.surfaceId).find((entry) => entry.id === id)!;
}

export function deleteAiProcessorLink(linkId: string) {
  const existing = listAiProcessorLinks().find((entry) => entry.id === linkId);
  if (!existing) {
    return null;
  }
  getDatabase().prepare(`DELETE FROM ai_processor_links WHERE id = ?`).run(linkId);
  return existing;
}

function resolveProcessorAgentProfiles(processor: AiProcessor, secrets: SecretsManager) {
  const allConnections = listAiModelConnections();
  const requestedAgentIds =
    processor.agentIds.length > 0 ? processor.agentIds : [FORGE_DEFAULT_AGENT_ID];
  const configByAgentId = new Map(
    processor.agentConfigs.map((config) => [config.agentId, config])
  );
  const settings = getSettings();

  return requestedAgentIds.map((agentId) => {
    const override = configByAgentId.get(agentId) ?? null;
    let connection =
      (override?.connectionId
        ? getAiModelConnectionById(override.connectionId)
        : null) ??
      allConnections.find((entry) => entry.agentId === agentId) ??
      null;
    if (agentId === FORGE_DEFAULT_AGENT_ID) {
      const selected = settings.modelSettings.forgeAgent.basicChat.connectionId;
      connection =
        (override?.connectionId ? connection : null) ??
        (selected ? getAiModelConnectionById(selected) : null);
    }
    if (!connection) {
      return {
        agentId,
        agentLabel:
          agentId === FORGE_DEFAULT_AGENT_ID ? "Forge Agent" : agentId,
        profile: null,
        explicitApiKey: null
      };
    }
    const credential = readModelConnectionCredential(connection.id, secrets);
    const explicitApiKey =
      credential?.kind === "api_key"
        ? credential.apiKey
        : credential?.kind === "oauth"
          ? credential.access
          : null;
    return {
      agentId,
      agentLabel:
        agentId === FORGE_DEFAULT_AGENT_ID
          ? "Forge Agent"
          : connection.agentLabel,
      profile: {
        provider: connection.provider,
        baseUrl: connection.baseUrl,
        model: override?.model?.trim() || connection.model,
        systemPrompt: "",
        secretId: null,
        metadata: {}
      },
      explicitApiKey
    };
  });
}

function writeProcessorRunState(
  processor: AiProcessor,
  input: {
    lastRunAt: string | null;
    lastRunStatus: "running" | "completed" | "failed";
    lastRunOutput: { concatenated: string; byAgent: Record<string, string> } | null;
    runEntry: AiProcessor["runHistory"][number];
  }
) {
  const nextHistory = [
    input.runEntry,
    ...processor.runHistory.filter((entry) => entry.id !== input.runEntry.id)
  ].slice(0, MAX_RUN_HISTORY);
  getDatabase()
    .prepare(
      `UPDATE ai_processors
       SET last_run_at = ?, last_run_status = ?, last_run_output_json = ?, run_history_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.lastRunAt,
      input.lastRunStatus,
      input.lastRunOutput ? JSON.stringify(input.lastRunOutput) : null,
      JSON.stringify(nextHistory),
      new Date().toISOString(),
      processor.id
    );
}

async function executeAiProcessor(
  processorId: string,
  input: RunAiProcessorInput,
  services: {
    llm: LlmManager;
    secrets: SecretsManager;
  },
  state: {
    cache: Map<
      string,
      {
        processor: AiProcessor;
        output: { concatenated: string; byAgent: Record<string, string> };
      }
    >;
    active: Set<string>;
    trigger: "manual" | "route" | "cron";
  }
) {
  if (state.cache.has(processorId)) {
    return state.cache.get(processorId)!;
  }
  if (state.active.has(processorId)) {
    throw new Error("Processor graph contains a cycle.");
  }
  const processor = getAiProcessorById(processorId);
  if (!processor) {
    throw new Error("AI processor not found.");
  }

  state.active.add(processorId);
  const parsed = runAiProcessorSchema.parse(input);
  const runEntryId = `air_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const runStartedAt = new Date().toISOString();
  writeProcessorRunState(processor, {
    lastRunAt: runStartedAt,
    lastRunStatus: "running",
    lastRunOutput: processor.lastRunOutput,
    runEntry: {
      id: runEntryId,
      trigger: state.trigger,
      startedAt: runStartedAt,
      completedAt: null,
      status: "running",
      input: parsed.input,
      output: null,
      error: null
    }
  });

  try {
    const links = listAiProcessorLinks(processor.surfaceId).filter(
      (link) => link.targetProcessorId === processor.id
    );
    const upstreamOutputs: Array<{
      processorId: string;
      title: string;
      output: { concatenated: string; byAgent: Record<string, string> };
    }> = [];
    const linkedContext: string[] = [];

    for (const link of links) {
      const sourceProcessorId = processorIdFromNodeId(link.sourceWidgetId);
      if (sourceProcessorId) {
        const upstream = await executeAiProcessor(
          sourceProcessorId,
          {
            input: parsed.input,
            context: parsed.context,
            widgetSnapshots: parsed.widgetSnapshots
          },
          services,
          state
        );
        upstreamOutputs.push({
          processorId: sourceProcessorId,
          title: upstream.processor.title,
          output: upstream.output
        });
        linkedContext.push(
          `Upstream processor ${upstream.processor.title} provided ${link.capabilityMode} access (${link.accessMode}).`
        );
        continue;
      }

      const snapshot = parsed.widgetSnapshots[link.sourceWidgetId];
      linkedContext.push(
        [
          `Linked widget ${link.sourceWidgetId} offers ${link.capabilityMode} access (${link.accessMode}).`,
          snapshot !== undefined
            ? `Snapshot: ${JSON.stringify(snapshot)}`
            : `Metadata: ${JSON.stringify(link.metadata)}`
        ].join(" ")
      );
    }

    const fullPrompt = [
      processor.promptFlow.trim(),
      processor.contextInput.trim()
        ? `Processor context:\n${processor.contextInput.trim()}`
        : "",
      linkedContext.length > 0
        ? `Linked capabilities:\n${linkedContext.join("\n")}`
        : "",
      upstreamOutputs.length > 0
        ? `Upstream processor outputs:\n${upstreamOutputs
            .map(
              (entry) =>
                `${entry.title} (${entry.processorId})\n${entry.output.concatenated}`
            )
            .join("\n\n")}`
        : "",
      parsed.input.trim() ? `Runtime input:\n${parsed.input.trim()}` : "",
      Object.keys(parsed.context).length > 0
        ? `Structured context:\n${JSON.stringify(parsed.context, null, 2)}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const agents = resolveProcessorAgentProfiles(processor, services.secrets);
    const outputsByAgent: Record<string, string> = {};

    await Promise.all(
      agents.map(async (agent) => {
        outputsByAgent[agent.agentLabel] = await runProcessorAgent(
          processor,
          agent,
          fullPrompt,
          {
            llm: services.llm
          }
        );
      })
    );

    const output = {
      concatenated: Object.entries(outputsByAgent)
        .map(([agentLabel, text]) => `${agentLabel}\n${text}`.trim())
        .join("\n\n"),
      byAgent: outputsByAgent
    };
    const completedAt = new Date().toISOString();
    writeProcessorRunState(processor, {
      lastRunAt: completedAt,
      lastRunStatus: "completed",
      lastRunOutput: output,
      runEntry: {
        id: runEntryId,
        trigger: state.trigger,
        startedAt: runStartedAt,
        completedAt,
        status: "completed",
        input: parsed.input,
        output,
        error: null
      }
    });

    const result = {
      processor: getAiProcessorById(processor.id)!,
      output
    };
    state.cache.set(processorId, result);
    state.active.delete(processorId);
    return result;
  } catch (error) {
    const failedAt = new Date().toISOString();
    writeProcessorRunState(processor, {
      lastRunAt: failedAt,
      lastRunStatus: "failed",
      lastRunOutput: processor.lastRunOutput,
      runEntry: {
        id: runEntryId,
        trigger: state.trigger,
        startedAt: runStartedAt,
        completedAt: failedAt,
        status: "failed",
        input: parsed.input,
        output: null,
        error: error instanceof Error ? error.message : "Processor run failed."
      }
    });
    state.active.delete(processorId);
    throw error;
  }
}

export async function runAiProcessor(
  processorId: string,
  input: RunAiProcessorInput,
  services: {
    llm: LlmManager;
    secrets: SecretsManager;
  },
  options: {
    trigger?: "manual" | "route" | "cron";
  } = {}
) {
  return await executeAiProcessor(processorId, input, services, {
    cache: new Map(),
    active: new Set(),
    trigger: options.trigger ?? "manual"
  });
}
