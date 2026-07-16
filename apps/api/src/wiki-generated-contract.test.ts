import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AGENT_ONBOARDING_TOOL_INPUT_CATALOG } from "./app.js";
import { buildOpenApiDocument } from "./openapi.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

function wikiOpenApiSurface(document: {
  components: { schemas: Record<string, unknown> };
  paths: Record<string, unknown>;
}) {
  return {
    schemas: Object.fromEntries(
      Object.entries(document.components.schemas).filter(([name]) =>
        name.startsWith("Wiki")
      )
    ),
    paths: Object.fromEntries(
      Object.entries(document.paths).filter(([route]) =>
        route.startsWith("/api/v1/wiki")
      )
    )
  };
}

test("generated OpenAPI files match the source Wiki contract", async () => {
  const source = wikiOpenApiSurface(
    buildOpenApiDocument() as unknown as Parameters<
      typeof wikiOpenApiSurface
    >[0]
  );
  for (const relativePath of [
    "plugins/openclaw/docs/openapi.json",
    "plugins/openclaw/docs/api/openapi.json"
  ]) {
    const generated = JSON.parse(
      await readFile(path.join(repoRoot, relativePath), "utf8")
    ) as Parameters<typeof wikiOpenApiSurface>[0];
    assert.deepEqual(
      wikiOpenApiSurface(generated),
      source,
      `${relativePath} is stale for Wiki`
    );
  }
});

test("generated agent-tool Wiki entries match the onboarding source", async () => {
  const generated = JSON.parse(
    await readFile(
      path.join(repoRoot, "plugins/openclaw/docs/agent-tools.json"),
      "utf8"
    )
  ) as {
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
  const sourceByTool = new Map(
    AGENT_ONBOARDING_TOOL_INPUT_CATALOG.flatMap((entry) =>
      entry.toolName
        .split("|")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [name, entry] as const)
    )
  );
  const wikiTools = generated.tools.filter((tool) => /wiki/i.test(tool.name));
  assert.ok(wikiTools.length > 0);
  for (const tool of wikiTools) {
    const source = sourceByTool.get(tool.name);
    assert.ok(source, `${tool.name} is missing from the onboarding catalog`);
    assert.equal(tool.summary, source.summary);
    assert.equal(tool.whenToUse, source.whenToUse);
    assert.equal(tool.inputShape, source.inputShape);
    assert.deepEqual(tool.requiredFields, source.requiredFields);
    assert.deepEqual(tool.notes, source.notes);
    assert.equal(tool.example, source.example);
    assert.equal(tool.catalogDocumented, true);
  }
});
