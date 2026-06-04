import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readText(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Forge docs site agent tool reference", () => {
  it("lists every registered OpenClaw tool in the generated docs payload", () => {
    const manifest = readJson<{ contracts: { tools: string[] } }>(
      "openclaw.plugin.json"
    );
    const toolDocs = readJson<{ tools: Array<{ name: string }> }>(
      "openclaw-plugin/docs/agent-tools.json"
    );

    const documentedTools = new Set(toolDocs.tools.map((tool) => tool.name));

    expect(toolDocs.tools).toHaveLength(manifest.contracts.tools.length);
    for (const toolName of manifest.contracts.tools) {
      expect(documentedTools.has(toolName), toolName).toBe(true);
    }
  });

  it("links the tools page from the docs navigation and uses generated data", () => {
    const toolsPage = readText("openclaw-plugin/docs/tools.html");
    const toolsScript = readText("openclaw-plugin/docs/tools.js");
    const apiPage = readText("openclaw-plugin/docs/api/index.html");
    const homePage = readText("openclaw-plugin/docs/index.html");

    expect(toolsScript).toContain("./agent-tools.json");
    expect(toolsPage).toContain("Every Forge tool exposed to agents.");
    expect(toolsPage).toContain("Name-only custom foods are rejected.");
    expect(apiPage).toContain("../tools.html");
    expect(homePage).toContain("./tools.html");
  });

  it("keeps the tools page direct instead of using marketing filler", () => {
    const plainText = readText("openclaw-plugin/docs/tools.html")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();

    for (const phrase of [
      "seamless",
      "supercharge",
      "world-class",
      "premium",
      "effortless"
    ]) {
      expect(plainText).not.toContain(phrase);
    }
  });
});
