import { describe, expect, it } from "vitest";
import {
  GAMIFICATION_ASSET_MANIFEST,
  GAMIFICATION_CATALOG
} from "@/lib/gamification-catalog";

describe("gamification catalog", () => {
  it("ships the requested trophy and unlock count", () => {
    expect(GAMIFICATION_CATALOG).toHaveLength(144);
    expect(GAMIFICATION_CATALOG.filter((item) => item.kind === "trophy")).toHaveLength(96);
    expect(GAMIFICATION_CATALOG.filter((item) => item.kind === "unlock")).toHaveLength(48);
  });

  it("resolves every catalog item to a manifest asset", () => {
    const assetKeys = new Set<string>();
    for (const item of GAMIFICATION_CATALOG) {
      expect(GAMIFICATION_ASSET_MANIFEST[item.assetKey]).toBeDefined();
      expect(assetKeys.has(item.assetKey)).toBe(false);
      assetKeys.add(item.assetKey);
    }
  });
});
