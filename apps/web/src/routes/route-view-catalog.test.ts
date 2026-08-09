import { describe, expect, it } from "vitest";
import {
  NAV_ROUTE_REGISTRY,
  PRIMARY_ROUTES,
  SHELL_NAV_ROUTES,
  getRouteDetail,
  getRouteLabel,
  routeMatches
} from "@/components/shell/shell-routes";
import {
  ROUTE_VIEW_CATALOG,
  resolveRouteViewIdFromPathname
} from "@/routes/route-view-catalog";

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
      expect(
        meta.description.length,
        `${viewId} description`
      ).toBeGreaterThanOrEqual(58);
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

  it("registers People as a primary responsive shell destination", () => {
    const peopleRoute = PRIMARY_ROUTES.find((route) => route.id === "people");
    expect(peopleRoute).toBeDefined();
    if (!peopleRoute) {
      throw new Error("People route is missing.");
    }

    expect(peopleRoute).toMatchObject({
      to: "/people",
      label: "People"
    });
    expect(SHELL_NAV_ROUTES).toContain(peopleRoute);
    expect(NAV_ROUTE_REGISTRY).toContain(peopleRoute);
    expect(routeMatches("/people/person_123", peopleRoute)).toBe(true);
    expect(getRouteDetail(peopleRoute, t)).toBe(
      ROUTE_VIEW_CATALOG["people-index"].description
    );
  });

  it("resolves People collection and detail paths to one master-detail surface", () => {
    expect(resolveRouteViewIdFromPathname("/people")).toBe("people-index");
    expect(resolveRouteViewIdFromPathname("/forge/people/person_123/")).toBe(
      "people-index"
    );
  });

  it("treats courses and concepts as first-class learning destinations", () => {
    const coursesRoute = PRIMARY_ROUTES.find((route) => route.id === "courses");
    expect(coursesRoute).toBeDefined();
    expect(routeMatches("/courses/math_123/learn", coursesRoute!)).toBe(true);
    expect(routeMatches("/concepts/local-invertibility", coursesRoute!)).toBe(
      true
    );
    expect(resolveRouteViewIdFromPathname("/courses/math_123/learn")).toBe(
      "course-learn"
    );
    expect(
      resolveRouteViewIdFromPathname("/concepts/local-invertibility")
    ).toBe("concept-detail");
  });

  it("registers record comparison as a first-class, globally findable destination", () => {
    const comparisonRoute = PRIMARY_ROUTES.find(
      (route) => route.id === "compare"
    );
    expect(comparisonRoute).toMatchObject({
      to: "/compare",
      label: "Compare records"
    });
    expect(NAV_ROUTE_REGISTRY).toContain(comparisonRoute);
    expect(resolveRouteViewIdFromPathname("/compare")).toBe("comparison-index");
    expect(getRouteDetail(comparisonRoute!, t)).toBe(
      ROUTE_VIEW_CATALOG["comparison-index"].description
    );
  });
});
