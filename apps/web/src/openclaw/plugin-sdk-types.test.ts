import { describe, expect, it } from "vitest";
import { isForgeAgentBootstrapEvent } from "./plugin-sdk-types.js";

describe("Forge bootstrap event compatibility", () => {
  it("recognizes the published event without a host runtime helper", () => {
    expect(
      isForgeAgentBootstrapEvent({
        type: "agent",
        action: "bootstrap",
        context: { workspaceDir: "/workspace", bootstrapFiles: [] }
      })
    ).toBe(true);
  });

  it("rejects unrelated events and missing or malformed bootstrap context", () => {
    for (const event of [
      null,
      {},
      { type: "gateway", action: "startup", context: {} },
      { type: "agent", action: "bootstrap", context: null },
      {
        type: "agent",
        action: "bootstrap",
        context: { workspaceDir: 1, bootstrapFiles: [] }
      },
      {
        type: "agent",
        action: "bootstrap",
        context: { workspaceDir: "/workspace", bootstrapFiles: {} }
      }
    ]) {
      expect(isForgeAgentBootstrapEvent(event)).toBe(false);
    }
  });
});
