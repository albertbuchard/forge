import { describe, expect, it } from "vitest";
import manifest from "../../openclaw.plugin.json";
import packageManifest from "../../openclaw-plugin/openclaw.plugin.json";

describe("forge plugin manifest", () => {
  it("is self-describing for OpenClaw discovery and config UI", () => {
    expect(manifest).toMatchObject({
      id: "forge",
      name: "Forge",
      description: expect.any(String),
      version: expect.any(String),
      skills: ["./skills"]
    });
    expect(manifest.uiHints).toMatchObject({
      baseUrl: expect.objectContaining({ label: expect.any(String) }),
      apiToken: expect.objectContaining({ sensitive: true }),
      actorLabel: expect.objectContaining({ label: expect.any(String) }),
      timeoutMs: expect.objectContaining({ advanced: true })
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
