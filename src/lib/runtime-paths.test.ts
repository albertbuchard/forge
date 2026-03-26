import { describe, expect, it } from "vitest";
import { normalizeAssetBasePath, normalizeRouterBasename } from "./runtime-paths";

describe("runtime path helpers", () => {
  it("keeps a trailing slash for asset resolution", () => {
    expect(normalizeAssetBasePath("/forge")).toBe("/forge/");
    expect(normalizeAssetBasePath("/forge/")).toBe("/forge/");
  });

  it("removes the trailing slash for router basename matching", () => {
    expect(normalizeRouterBasename("/forge")).toBe("/forge");
    expect(normalizeRouterBasename("/forge/")).toBe("/forge");
    expect(normalizeRouterBasename("/")).toBe("/");
  });
});
