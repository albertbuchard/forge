import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AGENT_ONBOARDING_TOOL_INPUT_CATALOG } from "../../apps/api/src/app.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

type CatalogEntry = (typeof AGENT_ONBOARDING_TOOL_INPUT_CATALOG)[number];
type AgentToolDocument = {
  source: {
    manifest: string;
    onboardingCatalog: string;
    catalogEntryCount: number;
    documentedToolCount: number;
    catalogSha256: string;
  };
  tools: Array<{
    name: string;
    summary: string;
    whenToUse: string;
    inputShape: string;
    requiredFields: string[];
    notes: string[];
    example: string;
    catalogDocumented: boolean;
  }>;
};

function canonicalJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function catalogSha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function splitToolNames(entry: CatalogEntry) {
  return entry.toolName
    .split("|")
    .map((toolName) => toolName.trim())
    .filter(Boolean);
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8")
  ) as T;
}

test("AGENT-01 keeps generated docs and installed runtimes identical to live onboarding", async () => {
  const sourceCatalog = canonicalJson(
    AGENT_ONBOARDING_TOOL_INPUT_CATALOG
  ) as CatalogEntry[];
  const sourceSha256 = catalogSha256(sourceCatalog);
  const expandedCatalog = sourceCatalog.flatMap((entry) =>
    splitToolNames(entry).map(
      (toolName) =>
        [
          toolName,
          {
            summary: entry.summary,
            whenToUse: entry.whenToUse,
            inputShape: entry.inputShape,
            requiredFields: [...entry.requiredFields],
            notes: [...entry.notes],
            example: entry.example
          }
        ] as const
    )
  );
  const expectedDocumentedTools = new Map(expandedCatalog);
  assert.equal(
    expectedDocumentedTools.size,
    expandedCatalog.length,
    "live onboarding must not assign the same tool name twice"
  );

  const docs = readJson<AgentToolDocument>(
    "plugins/openclaw/docs/agent-tools.json"
  );
  assert.deepEqual(docs.source, {
    manifest: "plugins/openclaw/openclaw.plugin.json",
    onboardingCatalog:
      "apps/api/src/app.ts#AGENT_ONBOARDING_TOOL_INPUT_CATALOG",
    catalogEntryCount: sourceCatalog.length,
    documentedToolCount: expectedDocumentedTools.size,
    catalogSha256: sourceSha256
  });

  const documentedTools = docs.tools.filter((tool) => tool.catalogDocumented);
  assert.equal(
    new Set(docs.tools.map((tool) => tool.name)).size,
    docs.tools.length,
    "generated agent docs must not contain duplicate tool names"
  );
  assert.deepEqual(
    documentedTools.map((tool) => tool.name).toSorted(),
    [...expectedDocumentedTools.keys()].toSorted(),
    "generated agent docs must contain every live onboarding tool exactly once"
  );
  for (const tool of documentedTools) {
    assert.deepEqual(
      {
        summary: tool.summary,
        whenToUse: tool.whenToUse,
        inputShape: tool.inputShape,
        requiredFields: tool.requiredFields,
        notes: tool.notes,
        example: tool.example
      },
      expectedDocumentedTools.get(tool.name),
      `generated agent docs drifted for ${tool.name}`
    );
  }

  const manifest = readJson<{ contracts: { tools: string[] } }>(
    "plugins/openclaw/openclaw.plugin.json"
  );
  assert.equal(
    new Set(manifest.contracts.tools).size,
    manifest.contracts.tools.length,
    "the installed tool manifest must not contain duplicate names"
  );
  assert.deepEqual(
    docs.tools.map((tool) => tool.name).toSorted(),
    [...manifest.contracts.tools].toSorted(),
    "generated agent docs must describe the exact installed tool manifest"
  );

  for (const relativePath of [
    "plugins/openclaw/dist/server/apps/api/src/app.js",
    "plugins/codex/runtime/dist/server/apps/api/src/app.js"
  ]) {
    const absolutePath = path.join(repoRoot, relativePath);
    assert.ok(
      existsSync(absolutePath),
      `${relativePath} is missing; build the packaged runtimes before checking parity`
    );
    const runtime = (await import(
      `${pathToFileURL(absolutePath).href}?agent-onboarding-parity=${Date.now()}`
    )) as {
      AGENT_ONBOARDING_TOOL_INPUT_CATALOG?: unknown;
    };
    const installedCatalog = canonicalJson(
      runtime.AGENT_ONBOARDING_TOOL_INPUT_CATALOG
    );
    assert.equal(
      catalogSha256(installedCatalog),
      sourceSha256,
      `${relativePath} has a stale onboarding catalog digest`
    );
    assert.deepEqual(
      installedCatalog,
      sourceCatalog,
      `${relativePath} drifted from the live onboarding catalog`
    );
  }
});
