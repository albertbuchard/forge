import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../server/src/openapi";
import {
  collectSupportedPluginApiRouteKeys,
  FORGE_SUPPORTED_PLUGIN_API_ROUTES,
  type ApiRouteKey
} from "./parity";
import { buildRouteParityReport, collectMirroredApiRouteKeys } from "./routes";

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
    expect(report.mirrored).toContain("GET /api/v1/calendar/overview");
    expect(report.mirrored).toContain("GET /api/v1/calendar/connections");
    expect(report.mirrored).toContain("POST /api/v1/calendar/connections");
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
  });

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
    expect(supported.has("GET /api/v1/movement/timeline")).toBe(true);
    expect(supported.has("GET /api/v1/movement/boxes/:id")).toBe(true);
    expect(supported.has("DELETE /api/v1/movement/user-boxes/:id")).toBe(true);
    expect(supported.has("POST /api/v1/life-force/fatigue-signals")).toBe(true);
    expect(supported.has("GET /api/v1/workbench/catalog/boxes")).toBe(true);
    expect(supported.has("GET /api/v1/workbench/flows/:id/runs")).toBe(true);
    expect(supported.has("GET /api/v1/workbench/flows/by-slug/:slug")).toBe(
      true
    );
    expect(supported.has("GET /api/v1/calendar/overview")).toBe(true);
    expect(supported.has("POST /api/v1/calendar/connections")).toBe(true);
    expect(supported.has("POST /api/v1/calendar/timeboxes")).toBe(true);
    expect(supported.has("GET /api/v1/preferences/workspace")).toBe(true);
    expect(supported.has("GET /api/v1/psyche/questionnaires")).toBe(true);
    expect(supported.has("GET /api/v1/psyche/self-observation/calendar")).toBe(
      true
    );
    expect(supported.has("POST /api/v1/entities/search")).toBe(true);
    expect(supported.has("POST /api/v1/work-adjustments")).toBe(true);
    expect(supported.has("POST /api/v1/insights")).toBe(true);
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
    expect(
      purposeByRoute.get("POST /api/v1/life-force/fatigue-signals")
    ).toBe("life_force");
    expect(purposeByRoute.get("GET /api/v1/workbench/flows")).toBe(
      "workbench"
    );
    expect(
      purposeByRoute.get("GET /api/v1/workbench/flows/:id/nodes/:nodeId/output")
    ).toBe("workbench");
  });

  it("mirrors exactly the curated upstream routes", () => {
    const mirrored = collectMirroredApiRouteKeys();
    expect(mirrored).toEqual(collectSupportedPluginApiRouteKeys());
  });
});
