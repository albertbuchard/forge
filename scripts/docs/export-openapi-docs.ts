import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_ONBOARDING_TOOL_INPUT_CATALOG } from "../../apps/api/src/app.ts";
import { buildOpenApiDocument } from "../../apps/api/src/openapi.ts";
import type { ForgePluginConfig } from "../../apps/web/src/openclaw/api-client.ts";
import { registerForgePluginTools } from "../../apps/web/src/openclaw/tools.ts";
import type { ForgeRegisteredTool } from "../../apps/web/src/openclaw/plugin-sdk-types.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const docsRoot = path.join(repoRoot, "plugins/openclaw", "docs");
const apiDocsRoot = path.join(docsRoot, "api");
const document = buildOpenApiDocument();
const payload = `${JSON.stringify(document, null, 2)}\n`;

const pluginManifest = JSON.parse(
  readFileSync(
    path.join(repoRoot, "plugins/openclaw/openclaw.plugin.json"),
    "utf8"
  )
) as { contracts?: { tools?: string[] } };

type ToolCatalogEntry = (typeof AGENT_ONBOARDING_TOOL_INPUT_CATALOG)[number];

const toolGroups = [
  {
    id: "operator",
    title: "Operator, UI, And Runtime",
    match: (tool: string) =>
      /operator|onboarding|doctor|ui_entrypoint|user_directory|xp_metrics|weekly_review/.test(
        tool
      )
  },
  {
    id: "entities",
    title: "Shared Entity Batch CRUD",
    match: (tool: string) => /_entities$|search_entities/.test(tool)
  },
  {
    id: "work",
    title: "Work, Tasks, And Time",
    match: (tool: string) =>
      /current_work|call_work_route|task_run|work_minutes|log_work|reward|insight/.test(
        tool
      )
  },
  {
    id: "wiki",
    title: "Wiki And Evidence Memory",
    match: (tool: string) => /wiki/.test(tool)
  },
  {
    id: "health",
    title: "Health, Food, And Training",
    match: (tool: string) =>
      /sleep|sports|training_load|weight_loss|nutrition|food|body_checkin|appearance_checkin|subjective_food_effect|gut_checkin|workout/.test(
        tool
      )
  },
  {
    id: "calendar",
    title: "Calendar And Timeboxes",
    match: (tool: string) =>
      /calendar|timebox|work_block_template|recommend_task_timeboxes/.test(tool)
  },
  {
    id: "preferences",
    title: "Preferences",
    match: (tool: string) => /preferences/.test(tool)
  },
  {
    id: "questionnaires",
    title: "Questionnaires And Self-Observation",
    match: (tool: string) => /questionnaire|self_observation/.test(tool)
  },
  {
    id: "specialized",
    title: "Specialized Domain Surfaces",
    match: (tool: string) => /movement|life_force|workbench|artifact/.test(tool)
  }
];

function splitCatalogToolNames(entry: ToolCatalogEntry) {
  return entry.toolName
    .split("|")
    .map((toolName) => toolName.trim())
    .filter(Boolean);
}

function findCatalogEntry(toolName: string) {
  return AGENT_ONBOARDING_TOOL_INPUT_CATALOG.find((entry) =>
    splitCatalogToolNames(entry).includes(toolName)
  );
}

function groupForTool(toolName: string) {
  return (
    toolGroups.find((group) => group.match(toolName)) ?? {
      id: "other",
      title: "Other Forge Tools"
    }
  );
}

const toolNames = [...(pluginManifest.contracts?.tools ?? [])].sort((a, b) =>
  a.localeCompare(b)
);
const registeredTools = new Map<string, ForgeRegisteredTool>();
registerForgePluginTools(
  {
    registerTool(tool) {
      registeredTools.set(tool.name, tool);
    }
  },
  {
    origin: "http://127.0.0.1",
    port: 4317,
    baseUrl: "http://127.0.0.1:4317",
    webAppUrl: "http://127.0.0.1:4317/forge/",
    portSource: "default",
    dataRoot: "",
    apiToken: "",
    actorLabel: "Docs Generator",
    injectBootstrapContext: false,
    timeoutMs: 15_000
  } satisfies ForgePluginConfig
);
const documentedToolNames = new Set(
  AGENT_ONBOARDING_TOOL_INPUT_CATALOG.flatMap(splitCatalogToolNames)
);
const onboardingCatalogSha256 = createHash("sha256")
  .update(JSON.stringify(AGENT_ONBOARDING_TOOL_INPUT_CATALOG))
  .digest("hex");
const generatedAt = process.env.FORGE_DOCS_GENERATED_AT?.trim()
  ? new Date(process.env.FORGE_DOCS_GENERATED_AT).toISOString()
  : new Date().toISOString();
const agentToolsPayload = {
  generatedAt,
  source: {
    manifest: "plugins/openclaw/openclaw.plugin.json",
    onboardingCatalog:
      "apps/api/src/app.ts#AGENT_ONBOARDING_TOOL_INPUT_CATALOG",
    catalogEntryCount: AGENT_ONBOARDING_TOOL_INPUT_CATALOG.length,
    documentedToolCount: documentedToolNames.size,
    catalogSha256: onboardingCatalogSha256
  },
  groups: [
    ...toolGroups.map(({ id, title }) => ({ id, title })),
    { id: "other", title: "Other Forge Tools" }
  ],
  tools: toolNames.map((toolName) => {
    const catalogEntry = findCatalogEntry(toolName);
    const registeredTool = registeredTools.get(toolName);
    const group = groupForTool(toolName);
    return {
      name: toolName,
      groupId: group.id,
      groupTitle: group.title,
      label: registeredTool?.label ?? toolName,
      summary: catalogEntry?.summary ?? registeredTool?.description ?? "",
      whenToUse:
        catalogEntry?.whenToUse ??
        registeredTool?.description ??
        "Use the live Forge onboarding payload for the current input contract.",
      inputShape: catalogEntry?.inputShape ?? "{}",
      requiredFields: catalogEntry?.requiredFields ?? [],
      notes: catalogEntry?.notes ?? [],
      example: catalogEntry?.example ?? "{}",
      catalogDocumented: documentedToolNames.has(toolName)
    };
  })
};
const toolsPayload = `${JSON.stringify(agentToolsPayload, null, 2)}\n`;

mkdirSync(apiDocsRoot, { recursive: true });
writeFileSync(path.join(docsRoot, "openapi.json"), payload, "utf8");
writeFileSync(path.join(apiDocsRoot, "openapi.json"), payload, "utf8");
writeFileSync(path.join(docsRoot, "agent-tools.json"), toolsPayload, "utf8");

console.log("Exported OpenAPI documents:");
console.log(`- ${path.join(docsRoot, "openapi.json")}`);
console.log(`- ${path.join(apiDocsRoot, "openapi.json")}`);
console.log(`- ${path.join(docsRoot, "agent-tools.json")}`);
