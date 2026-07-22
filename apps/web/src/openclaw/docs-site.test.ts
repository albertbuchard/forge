import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
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
      "plugins/openclaw/openclaw.plugin.json"
    );
    const toolDocs = readJson<{ tools: Array<{ name: string }> }>(
      "plugins/openclaw/docs/agent-tools.json"
    );

    const documentedTools = new Set(toolDocs.tools.map((tool) => tool.name));

    expect(toolDocs.tools).toHaveLength(manifest.contracts.tools.length);
    for (const toolName of manifest.contracts.tools) {
      expect(documentedTools.has(toolName), toolName).toBe(true);
    }
  });

  it("documents specialized route-key tool inputs instead of empty placeholders", () => {
    const toolDocs = readJson<{
      tools: Array<{
        name: string;
        inputShape: string;
        requiredFields: string[];
        notes: string[];
      }>;
    }>("plugins/openclaw/docs/agent-tools.json");
    const toolsByName = new Map(
      toolDocs.tools.map((tool) => [tool.name, tool])
    );

    for (const toolName of [
      "forge_call_movement_route",
      "forge_call_life_force_route",
      "forge_call_workbench_route",
      "forge_call_course_route"
    ]) {
      const tool = toolsByName.get(toolName);
      expect(tool, toolName).toBeDefined();
      expect(tool?.inputShape, toolName).toMatch(/routeKey/);
      expect(tool?.inputShape, toolName).toMatch(/pathParams/);
      expect(tool?.requiredFields, toolName).toContain("routeKey");
      expect(tool?.notes.join(" "), toolName).toMatch(
        /live onboarding|methodRoutes|exact placeholder/i
      );
    }

    expect(toolsByName.get("forge_call_movement_route")?.inputShape).toMatch(
      /tripPointDelete/
    );
    expect(toolsByName.get("forge_call_life_force_route")?.inputShape).toMatch(
      /weekdayTemplate/
    );
    expect(toolsByName.get("forge_call_workbench_route")?.inputShape).toMatch(
      /latestNodeOutput/
    );
    expect(toolsByName.get("forge_call_course_route")?.inputShape).toMatch(
      /learningSession[\s\S]*submitAttempt[\s\S]*conceptDetail/
    );
  });

  it("links the tools page from the docs navigation and uses generated data", () => {
    const toolsPage = readText("plugins/openclaw/docs/tools.html");
    const toolsScript = readText("plugins/openclaw/docs/tools.js");
    const apiPage = readText("plugins/openclaw/docs/api/index.html");
    const homePage = readText("plugins/openclaw/docs/index.html");

    expect(toolsScript).toContain("./agent-tools.json");
    expect(toolsPage).toContain("Every Forge tool exposed to agents.");
    expect(toolsPage).toContain("Name-only custom foods are rejected.");
    expect(apiPage).toContain("../tools.html");
    expect(homePage).toContain("./tools.html");
  });

  it("keeps the tools page direct instead of using marketing filler", () => {
    const plainText = readText("plugins/openclaw/docs/tools.html")
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
