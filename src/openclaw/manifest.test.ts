import { describe, expect, it } from "vitest";
import manifest from "../../openclaw.plugin.json";
import packageManifest from "../../openclaw-plugin/openclaw.plugin.json";

describe("forge plugin manifest", () => {
  it("is self-describing for OpenClaw discovery and config UI", () => {
    expect(manifest).toMatchObject({
      id: "forge-openclaw-plugin",
      name: "Forge",
      description: expect.stringContaining("Curated OpenClaw adapter"),
      version: expect.any(String),
      skills: ["./skills"]
    });
    expect(manifest.uiHints).toMatchObject({
      origin: expect.objectContaining({ label: expect.any(String) }),
      port: expect.objectContaining({ label: expect.any(String) }),
      dataRoot: expect.objectContaining({ advanced: true }),
      apiToken: expect.objectContaining({ sensitive: true }),
      actorLabel: expect.objectContaining({ label: expect.any(String) }),
      timeoutMs: expect.objectContaining({ advanced: true })
    });
    expect(manifest.configSchema).toMatchObject({
      type: "object",
      properties: {
        origin: expect.objectContaining({ default: "http://127.0.0.1" }),
        port: expect.objectContaining({ default: 4317 }),
        dataRoot: expect.objectContaining({ default: "~/.forge" }),
        actorLabel: expect.objectContaining({ default: "" })
      }
    });
  });

  it("stays aligned with the publishable OpenClaw package manifest", () => {
    expect(packageManifest).toMatchObject({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      skills: manifest.skills,
      uiHints: manifest.uiHints,
      configSchema: manifest.configSchema
    });
  });
});
