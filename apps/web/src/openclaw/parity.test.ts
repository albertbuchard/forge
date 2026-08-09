import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer } from "../../../../apps/api/src/app";
import { buildOpenApiDocument } from "../../../../apps/api/src/openapi";
import { createAgentToken } from "../../../../apps/api/src/repositories/settings";
import { createAgentTokenSchema } from "../../../../apps/api/src/types";
import {
  collectPublishedOnboardingApiRouteKeys,
  collectRequiredMirroredOnboardingApiRouteKeys,
  collectSupportedPluginApiRouteKeys,
  FORGE_SUPPORTED_PLUGIN_API_ROUTES,
  type ApiRouteKey
} from "./parity";
import { buildRouteParityReport, collectMirroredApiRouteKeys } from "./routes";
import { courseRouteSpecs } from "./tools";

function readHermesCourseRouteSpecs() {
  const source = readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../../plugins/hermes/forge_hermes/catalog.py"
    ),
    "utf8"
  );
  const start = source.indexOf("COURSE_ROUTE_SPECS:");
  const end = source.indexOf("COURSE_ROUTE_EXAMPLES:", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return Object.fromEntries(
    [
      ...source
        .slice(start, end)
        .matchAll(
          /"([^"]+)":\s*\{\s*"method":\s*"([A-Z]+)",\s*"path":\s*"([^"]+)"/g
        )
    ].map((match) => [match[1], `${match[2]} ${match[3]}`])
  );
}

describe("forge plugin route parity", () => {
  it("covers the curated plugin contract and nothing broader", () => {
    const openapi = buildOpenApiDocument();
    const report = buildRouteParityReport(
      (openapi.paths ?? {}) as Record<string, Record<string, unknown>>
    );

    expect(report.missingFromPlugin).toEqual([]);
    expect(report.missingFromOpenApi).toEqual([]);
    expect(report.unexpectedMirrors).toEqual([]);
    expect(report.mirrored).toContain("GET /api/v1/health");
    expect(report.mirrored).toContain("GET /api/v1/users/directory");
    expect(report.mirrored).toContain("GET /api/v1/operator/overview");
    expect(report.mirrored).toContain("GET /api/v1/agents/onboarding");
    expect(report.mirrored).toContain("GET /api/v1/psyche/schema-catalog");
    expect(report.mirrored).toContain("GET /api/v1/wiki/settings");
    expect(report.mirrored).toContain("GET /api/v1/wiki/pages");
    expect(report.mirrored).toContain("GET /api/v1/wiki/pages/:id");
    expect(report.mirrored).toContain("GET /api/v1/wiki/health");
    expect(report.mirrored).toContain("POST /api/v1/wiki/search");
    expect(report.mirrored).toContain("POST /api/v1/wiki/pages");
    expect(report.mirrored).toContain("PATCH /api/v1/wiki/pages/:id");
    expect(report.mirrored).toContain("POST /api/v1/wiki/sync");
    expect(report.mirrored).toContain("POST /api/v1/wiki/reindex");
    expect(report.mirrored).toContain("POST /api/v1/wiki/ingest-jobs");
    expect(report.mirrored).toContain("GET /api/v1/health/sleep");
    expect(report.mirrored).toContain("PATCH /api/v1/health/sleep/:id");
    expect(report.mirrored).toContain("GET /api/v1/health/fitness");
    expect(report.mirrored).toContain("GET /api/v1/health/training-load");
    expect(report.mirrored).toContain("PATCH /api/v1/health/workouts/:id");
    expect(report.mirrored).toContain("GET /api/v1/movement/day");
    expect(report.mirrored).toContain("GET /api/v1/movement/boxes/:id");
    expect(report.mirrored).toContain("PATCH /api/v1/movement/settings");
    expect(report.mirrored).toContain("POST /api/v1/movement/user-boxes");
    expect(report.mirrored).toContain("DELETE /api/v1/movement/user-boxes/:id");
    expect(report.mirrored).toContain(
      "POST /api/v1/movement/automatic-boxes/:id/invalidate"
    );
    expect(report.mirrored).toContain("DELETE /api/v1/movement/stays/:id");
    expect(report.mirrored).toContain("DELETE /api/v1/movement/trips/:id");
    expect(report.mirrored).toContain(
      "DELETE /api/v1/movement/trips/:id/points/:pointId"
    );
    expect(report.mirrored).toContain("POST /api/v1/movement/selection");
    expect(report.mirrored).toContain("GET /api/v1/life-force");
    expect(report.mirrored).toContain("PATCH /api/v1/life-force/profile");
    expect(report.mirrored).toContain("GET /api/v1/workbench/flows");
    expect(report.mirrored).toContain("GET /api/v1/workbench/catalog/boxes");
    expect(report.mirrored).toContain("GET /api/v1/workbench/flows/:id/runs");
    expect(report.mirrored).toContain("POST /api/v1/workbench/flows/:id/run");
    expect(report.mirrored).toContain(
      "GET /api/v1/workbench/flows/:id/nodes/:nodeId/output"
    );
    expect(report.mirrored).toContain("GET /api/v1/attention-inbox");
    expect(report.mirrored).toContain(
      "POST /api/v1/attention-inbox/:id/snooze"
    );
    expect(report.mirrored).toContain(
      "POST /api/v1/attention-inbox/:id/dismiss"
    );
    expect(report.mirrored).toContain(
      "POST /api/v1/attention-inbox/:id/restore"
    );
    expect(report.mirrored).toContain("GET /api/v1/entity-navigation");
    expect(report.mirrored).toContain("POST /api/v1/entity-navigation/touch");
    expect(report.mirrored).not.toContain("PUT /api/v1/entity-navigation/pins");
    expect(report.mirrored).toContain("GET /api/v1/artifacts");
    expect(report.mirrored).toContain("POST /api/v1/artifacts");
    expect(report.mirrored).toContain("GET /api/v1/artifacts/:id");
    expect(report.mirrored).toContain("PATCH /api/v1/artifacts/:id");
    expect(report.mirrored).toContain("POST /api/v1/artifacts/:id/scan");
    expect(report.mirrored).toContain("POST /api/v1/artifacts/:id/enrich");
    expect(report.mirrored).toContain("POST /api/v1/artifacts/:id/links");
    expect(report.mirrored).toContain("POST /api/v1/artifacts/:id/trust");
    expect(report.mirrored).toContain("GET /api/v1/artifacts/:id/versions");
    expect(report.mirrored).toContain("GET /api/v1/artifacts/:id/audit");
    expect(report.mirrored).not.toContain("GET /api/v1/artifacts/:id/download");
    expect(report.mirrored).not.toContain(
      "POST /api/v1/artifacts/:id/download"
    );
    expect(report.mirrored).not.toContain("POST /api/v1/artifacts/:id/encrypt");
    expect(report.mirrored).toContain("GET /api/v1/life-events/timeline");
    expect(report.mirrored).toContain("GET /api/v1/life-events/:id");
    expect(report.mirrored).toContain(
      "POST /api/v1/life-events/:id/calendar-sync"
    );
    expect(report.mirrored).toContain(
      "POST /api/v1/life-events/from-calendar-event"
    );
    expect(report.mirrored).toContain("POST /api/v1/life-events/import-ticket");
    expect(report.mirrored).toContain(
      "GET /api/v1/life-events/:id/travel-status"
    );
    expect(report.mirrored).toContain("GET /api/v1/calendar/overview");
    expect(report.mirrored).toContain(
      "GET /api/v1/calendar/macos-local/discovery"
    );
    expect(report.mirrored).toContain("POST /api/v1/calendar/discovery");
    expect(report.mirrored).toContain("GET /api/v1/calendar/connections");
    expect(report.mirrored).toContain("POST /api/v1/calendar/connections");
    expect(report.mirrored).toContain("PATCH /api/v1/calendar/connections/:id");
    expect(report.mirrored).toContain(
      "DELETE /api/v1/calendar/connections/:id"
    );
    expect(report.mirrored).toContain(
      "GET /api/v1/calendar/connections/:id/discovery"
    );
    expect(report.mirrored).toContain(
      "POST /api/v1/calendar/connections/:id/sync"
    );
    expect(report.mirrored).toContain(
      "POST /api/v1/calendar/work-block-templates"
    );
    expect(report.mirrored).toContain(
      "POST /api/v1/calendar/timeboxes/recommend"
    );
    expect(report.mirrored).toContain("POST /api/v1/calendar/timeboxes");
    expect(report.mirrored).toContain("GET /api/v1/preferences/workspace");
    expect(report.mirrored).toContain("POST /api/v1/preferences/game/start");
    expect(report.mirrored).toContain("POST /api/v1/preferences/catalogs");
    expect(report.mirrored).toContain(
      "PATCH /api/v1/preferences/items/:id/score"
    );
    expect(report.mirrored).toContain("GET /api/v1/psyche/questionnaires");
    expect(report.mirrored).toContain(
      "POST /api/v1/psyche/questionnaires/:id/runs"
    );
    expect(report.mirrored).toContain(
      "GET /api/v1/psyche/questionnaire-runs/:id"
    );
    expect(report.mirrored).toContain(
      "GET /api/v1/psyche/self-observation/calendar"
    );
    expect(report.mirrored).toContain("POST /api/v1/entities/search");
    expect(report.mirrored).toContain("POST /api/v1/entities/create");
    expect(report.mirrored).toContain("POST /api/v1/entities/update");
    expect(report.mirrored).toContain("POST /api/v1/entities/delete");
    expect(report.mirrored).toContain("POST /api/v1/entities/restore");
    expect(report.mirrored).toContain("POST /api/v1/work-adjustments");
    expect(report.mirrored).toContain("POST /api/v1/insights");
    expect(report.mirrored).toContain(
      "POST /api/v1/courses/:courseId/voice-session"
    );
    expect(report.mirrored).toContain("POST /api/v1/courses/:courseId/upgrade");
  });

  it("derives the complete live route contract and verifies actual server registration", async () => {
    const dataRoot = mkdtempSync(path.join(os.tmpdir(), "forge-route-parity-"));
    const app = await buildServer({ dataRoot, taskRunWatchdog: false });
    try {
      const issued = createAgentToken(
        createAgentTokenSchema.parse({
          label: "Route parity test",
          agentLabel: "Route parity test",
          trustLevel: "trusted",
          scopes: ["read"]
        })
      );
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/agents/onboarding",
        headers: { authorization: `Bearer ${issued.token}` }
      });
      expect(response.statusCode).toBe(200);
      const onboarding = response.json();
      const courseMethodRoutes = onboarding.onboarding.entityRouteModel
        .specializedDomainSurfaces.courses.methodRoutes as Record<
        string,
        string
      >;
      const openapi = buildOpenApiDocument();
      const pathMap = (openapi.paths ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const report = buildRouteParityReport(pathMap, onboarding);
      const published = collectPublishedOnboardingApiRouteKeys(onboarding);
      const requiredMirrors =
        collectRequiredMirroredOnboardingApiRouteKeys(onboarding);

      expect(report.missingPublishedFromOpenApi).toEqual([]);
      expect(report.missingRequiredMirrors).toEqual([]);
      expect(report.publishedByOnboarding).toEqual([...published].sort());
      expect(report.requiredMirrorsFromOnboarding).toEqual(
        [...requiredMirrors].sort()
      );

      const courseRoutes = report.publishedByOnboarding.filter(
        (route) =>
          route.includes("/api/v1/courses") ||
          route.includes("/api/v1/concepts")
      );
      expect(courseRoutes).toEqual(
        [
          "GET /api/v1/concepts",
          "GET /api/v1/concepts/:conceptId",
          "GET /api/v1/courses",
          "GET /api/v1/courses/:courseId",
          "GET /api/v1/courses/:courseId/export",
          "GET /api/v1/courses/:courseId/learn",
          "POST /api/v1/courses/:courseId/lessons/:lessonId/activities/:activityId/attempts",
          "POST /api/v1/courses/:courseId/upgrade",
          "POST /api/v1/courses/:courseId/voice-session",
          "POST /api/v1/courses/import"
        ].sort()
      );
      expect(
        Object.fromEntries(
          Object.entries(courseRouteSpecs).map(([routeKey, route]) => [
            routeKey,
            `${route.method} ${route.path}`
          ])
        )
      ).toEqual(courseMethodRoutes);
      expect(readHermesCourseRouteSpecs()).toEqual(courseMethodRoutes);

      for (const route of published) {
        const [method, url] = route.split(" ");
        expect(
          app.hasRoute({
            method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
            url
          }),
          `${route} should be registered by Fastify`
        ).toBe(true);
      }
    } finally {
      await app.close();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  }, 45_000);

  it("publishes supported route keys for governance and diagnostics", () => {
    const supported = collectSupportedPluginApiRouteKeys();
    expect(supported.has("GET /api/v1/health")).toBe(true);
    expect(supported.has("GET /api/v1/users/directory")).toBe(true);
    expect(supported.has("GET /api/v1/operator/overview")).toBe(true);
    expect(supported.has("GET /api/v1/agents/onboarding")).toBe(true);
    expect(supported.has("GET /api/v1/wiki/settings")).toBe(true);
    expect(supported.has("POST /api/v1/wiki/ingest-jobs")).toBe(true);
    expect(supported.has("GET /api/v1/health/sleep")).toBe(true);
    expect(supported.has("GET /api/v1/health/fitness")).toBe(true);
    expect(supported.has("GET /api/v1/health/training-load")).toBe(true);
    expect(supported.has("GET /api/v1/movement/timeline")).toBe(true);
    expect(supported.has("GET /api/v1/movement/boxes/:id")).toBe(true);
    expect(supported.has("DELETE /api/v1/movement/user-boxes/:id")).toBe(true);
    expect(supported.has("POST /api/v1/life-force/fatigue-signals")).toBe(true);
    expect(supported.has("GET /api/v1/workbench/catalog/boxes")).toBe(true);
    expect(supported.has("GET /api/v1/workbench/flows/:id/runs")).toBe(true);
    expect(supported.has("GET /api/v1/workbench/flows/by-slug/:slug")).toBe(
      true
    );
    expect(supported.has("GET /api/v1/artifacts")).toBe(true);
    expect(supported.has("POST /api/v1/artifacts")).toBe(true);
    expect(supported.has("POST /api/v1/artifacts/:id/links")).toBe(true);
    expect(
      supported.has("GET /api/v1/artifacts/:id/download" as ApiRouteKey)
    ).toBe(false);
    expect(
      supported.has("POST /api/v1/artifacts/:id/download" as ApiRouteKey)
    ).toBe(false);
    expect(
      supported.has("POST /api/v1/artifacts/:id/encrypt" as ApiRouteKey)
    ).toBe(false);
    expect(supported.has("GET /api/v1/life-events/timeline")).toBe(true);
    expect(supported.has("GET /api/v1/life-events/:id")).toBe(true);
    expect(supported.has("POST /api/v1/life-events/:id/calendar-sync")).toBe(
      true
    );
    expect(supported.has("POST /api/v1/life-events/from-calendar-event")).toBe(
      true
    );
    expect(supported.has("POST /api/v1/life-events/import-ticket")).toBe(true);
    expect(supported.has("GET /api/v1/life-events/:id/travel-status")).toBe(
      true
    );
    expect(supported.has("GET /api/v1/calendar/overview")).toBe(true);
    expect(supported.has("GET /api/v1/calendar/macos-local/discovery")).toBe(
      true
    );
    expect(supported.has("POST /api/v1/calendar/discovery")).toBe(true);
    expect(supported.has("POST /api/v1/calendar/connections")).toBe(true);
    expect(supported.has("PATCH /api/v1/calendar/connections/:id")).toBe(true);
    expect(supported.has("DELETE /api/v1/calendar/connections/:id")).toBe(true);
    expect(supported.has("POST /api/v1/calendar/timeboxes")).toBe(true);
    expect(supported.has("GET /api/v1/preferences/workspace")).toBe(true);
    expect(supported.has("GET /api/v1/psyche/questionnaires")).toBe(true);
    expect(supported.has("GET /api/v1/psyche/self-observation/calendar")).toBe(
      true
    );
    expect(supported.has("POST /api/v1/entities/search")).toBe(true);
    expect(supported.has("POST /api/v1/work-adjustments")).toBe(true);
    expect(supported.has("POST /api/v1/insights")).toBe(true);
    expect(supported.has("POST /api/v1/courses/:courseId/voice-session")).toBe(
      true
    );
    expect(supported.has("POST /api/v1/courses/:courseId/upgrade")).toBe(true);
  });

  it("keeps specialized domain route families explicit in the plugin contract", () => {
    const supported = collectSupportedPluginApiRouteKeys();

    for (const route of [
      "GET /api/v1/movement/day",
      "GET /api/v1/movement/month",
      "GET /api/v1/movement/all-time",
      "GET /api/v1/movement/timeline",
      "GET /api/v1/movement/places",
      "GET /api/v1/movement/boxes/:id",
      "GET /api/v1/movement/trips/:id",
      "POST /api/v1/movement/selection",
      "POST /api/v1/movement/user-boxes/preflight",
      "POST /api/v1/movement/user-boxes",
      "PATCH /api/v1/movement/user-boxes/:id",
      "DELETE /api/v1/movement/user-boxes/:id",
      "POST /api/v1/movement/automatic-boxes/:id/invalidate",
      "PATCH /api/v1/movement/stays/:id",
      "DELETE /api/v1/movement/stays/:id",
      "PATCH /api/v1/movement/trips/:id",
      "DELETE /api/v1/movement/trips/:id",
      "PATCH /api/v1/movement/trips/:id/points/:pointId",
      "DELETE /api/v1/movement/trips/:id/points/:pointId"
    ]) {
      expect(
        supported.has(route as ApiRouteKey),
        `${route} should stay mirrored`
      ).toBe(true);
    }

    for (const route of [
      "GET /api/v1/life-force",
      "PATCH /api/v1/life-force/profile",
      "PUT /api/v1/life-force/templates/:weekday",
      "POST /api/v1/life-force/fatigue-signals"
    ]) {
      expect(
        supported.has(route as ApiRouteKey),
        `${route} should stay mirrored`
      ).toBe(true);
    }

    for (const route of [
      "GET /api/v1/workbench/catalog/boxes",
      "GET /api/v1/workbench/flows",
      "POST /api/v1/workbench/flows",
      "GET /api/v1/workbench/flows/:id",
      "PATCH /api/v1/workbench/flows/:id",
      "DELETE /api/v1/workbench/flows/:id",
      "GET /api/v1/workbench/flows/by-slug/:slug",
      "POST /api/v1/workbench/flows/:id/run",
      "POST /api/v1/workbench/run",
      "POST /api/v1/workbench/flows/:id/chat",
      "GET /api/v1/workbench/flows/:id/output",
      "GET /api/v1/workbench/flows/:id/runs",
      "GET /api/v1/workbench/flows/:id/runs/:runId",
      "GET /api/v1/workbench/flows/:id/runs/:runId/nodes",
      "GET /api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
      "GET /api/v1/workbench/flows/:id/nodes/:nodeId/output"
    ]) {
      expect(
        supported.has(route as ApiRouteKey),
        `${route} should stay mirrored`
      ).toBe(true);
    }

    for (const route of [
      "GET /api/v1/artifacts",
      "POST /api/v1/artifacts",
      "GET /api/v1/artifacts/:id",
      "PATCH /api/v1/artifacts/:id",
      "POST /api/v1/artifacts/:id/scan",
      "POST /api/v1/artifacts/:id/enrich",
      "POST /api/v1/artifacts/:id/links",
      "POST /api/v1/artifacts/:id/trust",
      "GET /api/v1/artifacts/:id/versions",
      "GET /api/v1/artifacts/:id/audit"
    ]) {
      expect(
        supported.has(route as ApiRouteKey),
        `${route} should stay mirrored`
      ).toBe(true);
    }
    for (const route of [
      "GET /api/v1/life-events/timeline",
      "GET /api/v1/life-events/:id",
      "POST /api/v1/life-events/:id/calendar-sync",
      "POST /api/v1/life-events/from-calendar-event",
      "POST /api/v1/life-events/import-ticket",
      "GET /api/v1/life-events/:id/travel-status"
    ]) {
      expect(
        supported.has(route as ApiRouteKey),
        `${route} should stay mirrored`
      ).toBe(true);
    }
    expect(
      supported.has("GET /api/v1/artifacts/:id/download" as ApiRouteKey)
    ).toBe(false);
    expect(
      supported.has("POST /api/v1/artifacts/:id/download" as ApiRouteKey)
    ).toBe(false);
    expect(
      supported.has("POST /api/v1/artifacts/:id/encrypt" as ApiRouteKey)
    ).toBe(false);
  });

  it("labels specialized domain route families with their own route purposes", () => {
    const purposeByRoute = new Map(
      FORGE_SUPPORTED_PLUGIN_API_ROUTES.map((route) => [
        `${route.method} ${route.path}`,
        route.purpose
      ])
    );

    expect(purposeByRoute.get("GET /api/v1/movement/timeline")).toBe(
      "movement"
    );
    expect(purposeByRoute.get("POST /api/v1/movement/user-boxes")).toBe(
      "movement"
    );
    expect(purposeByRoute.get("GET /api/v1/life-force")).toBe("life_force");
    expect(purposeByRoute.get("POST /api/v1/life-force/fatigue-signals")).toBe(
      "life_force"
    );
    expect(purposeByRoute.get("GET /api/v1/workbench/flows")).toBe("workbench");
    expect(
      purposeByRoute.get("GET /api/v1/workbench/flows/:id/nodes/:nodeId/output")
    ).toBe("workbench");
    expect(purposeByRoute.get("GET /api/v1/artifacts")).toBe("artifact");
    expect(purposeByRoute.get("POST /api/v1/artifacts/:id/links")).toBe(
      "artifact"
    );
    expect(purposeByRoute.get("GET /api/v1/life-events/timeline")).toBe(
      "life_event"
    );
    expect(
      purposeByRoute.get("POST /api/v1/life-events/from-calendar-event")
    ).toBe("life_event");
    expect(
      purposeByRoute.get("GET /api/v1/artifacts/:id/download")
    ).toBeUndefined();
  });

  it("mirrors exactly the curated upstream routes", () => {
    const mirrored = collectMirroredApiRouteKeys();
    expect(mirrored).toEqual(collectSupportedPluginApiRouteKeys());
  });
});
