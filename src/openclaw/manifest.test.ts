import { describe, expect, it } from "vitest";
import manifest from "../../openclaw.plugin.json";
import packageManifest from "../../openclaw-plugin/openclaw.plugin.json";
import { registerForgePlugin } from "./plugin-entry-shared";

function collectRegisteredToolNames() {
  const tools: string[] = [];

  registerForgePlugin({
    pluginConfig: {
      origin: "http://127.0.0.1",
      port: 4317,
      dataRoot: "/tmp/forge-data"
    },
    registerHttpRoute() {},
    registerTool(tool) {
      tools.push(typeof tool === "function" ? "factory" : tool.name);
    },
    registerService() {}
  });

  return tools.sort();
}

describe("forge plugin manifest", () => {
  it("is self-describing for OpenClaw discovery and config UI", () => {
    expect(manifest).toMatchObject({
      id: "forge-openclaw-plugin",
      name: "Forge",
      description: expect.stringContaining("Curated OpenClaw adapter"),
      version: expect.any(String),
      activation: {
        onStartup: true,
        onCapabilities: ["tool"],
        onCommands: ["forge"]
      },
      commandAliases: [{ name: "forge" }],
      skills: ["./skills"]
    });
    expect(manifest.contracts?.tools).toEqual(collectRegisteredToolNames());
    expect(manifest.uiHints).toMatchObject({
      origin: expect.objectContaining({ label: expect.any(String) }),
      port: expect.objectContaining({ label: expect.any(String) }),
      dataRoot: expect.objectContaining({ advanced: true }),
      apiToken: expect.objectContaining({ sensitive: true }),
      actorLabel: expect.objectContaining({ label: expect.any(String) }),
      injectBootstrapContext: expect.objectContaining({
        label: expect.any(String)
      }),
      timeoutMs: expect.objectContaining({ advanced: true })
    });
    expect(manifest.configSchema).toMatchObject({
      type: "object",
      properties: {
        origin: expect.objectContaining({ default: "http://127.0.0.1" }),
        port: expect.objectContaining({ default: 4317 }),
        dataRoot: expect.objectContaining({ default: "~/.forge" }),
        actorLabel: expect.objectContaining({ default: "" }),
        injectBootstrapContext: expect.objectContaining({ default: true })
      }
    });
  });

  it("stays aligned with the publishable OpenClaw package manifest", () => {
    expect(packageManifest).toMatchObject({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      activation: manifest.activation,
      skills: manifest.skills,
      commandAliases: manifest.commandAliases,
      contracts: manifest.contracts,
      uiHints: manifest.uiHints,
      configSchema: manifest.configSchema
    });
  });
});
