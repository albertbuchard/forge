import { describe, expect, it } from "vitest";
import {
  NAV_ROUTE_REGISTRY,
  getRouteDetail,
  getRouteLabel
} from "@/components/shell/shell-routes";
import { ROUTE_VIEW_CATALOG } from "@/routes/route-view-catalog";

const t = (key: string) => key;

const FORBIDDEN_PLACEHOLDERS = [
  "Psyche shortcut",
  "workspace.",
  "surface.",
  "context.",
  "detail.",
  "review.",
  "state."
];

describe("route view copy", () => {
  it("keeps every route description informative enough for loading and navigation surfaces", () => {
    for (const [viewId, meta] of Object.entries(ROUTE_VIEW_CATALOG)) {
      expect(meta.description, `${viewId} description`).toMatch(/[a-z]/i);
      expect(meta.description, `${viewId} description`).toMatch(/[,.]/);
      expect(meta.description.length, `${viewId} description`).toBeGreaterThanOrEqual(58);
      for (const placeholder of FORBIDDEN_PLACEHOLDERS) {
        expect(meta.description, `${viewId} description`).not.toBe(placeholder);
      }
    }
  });

  it("gives each configurable Psyche shortcut a specific explanation", () => {
    const psycheShortcuts = NAV_ROUTE_REGISTRY.filter((route) =>
      route.id.startsWith("psyche:")
    );

    expect(psycheShortcuts.length).toBeGreaterThan(0);
    for (const route of psycheShortcuts) {
      const label = getRouteLabel(route, t);
      const detail = getRouteDetail(route, t);
      expect(detail, `${label} detail`).not.toBe("Psyche shortcut");
      expect(detail, `${label} detail`).toMatch(/[a-z]/i);
      expect(detail.length, `${label} detail`).toBeGreaterThanOrEqual(58);
    }
  });
});
