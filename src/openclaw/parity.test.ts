import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../server/src/openapi";
import { getCrudEntityCapabilityMatrix } from "../../server/src/services/entity-crud";
import { FORGE_PLUGIN_ROUTE_EXCLUSIONS } from "./parity";
import { buildRouteParityReport, collectMirroredApiRouteKeys } from "./routes";

describe("forge plugin route parity", () => {
  it("covers every stable agent-relevant /api/v1 route with either a mirror or explicit exclusion", () => {
    const openapi = buildOpenApiDocument();
    const report = buildRouteParityReport(openapi.paths ?? {});

    expect(report.uncovered).toEqual([]);
    expect(report.mirrored).toContain("GET /api/v1/domains");
    expect(report.mirrored).toContain("GET /api/v1/comments");
    expect(report.mirrored).toContain("GET /api/v1/comments/:id");
    expect(report.mirrored).toContain("PATCH /api/v1/comments/:id");
    expect(report.mirrored).toContain("DELETE /api/v1/comments/:id");
    expect(report.mirrored).toContain("DELETE /api/v1/insights/:id");
    expect(report.mirrored).toContain("GET /api/v1/operator/overview");
    expect(report.mirrored).toContain("PATCH /api/v1/settings");
    expect(report.mirrored).toContain("GET /api/v1/settings/bin");
    expect(report.mirrored).toContain("POST /api/v1/entities/create");
    expect(report.mirrored).toContain("POST /api/v1/entities/update");
    expect(report.mirrored).toContain("POST /api/v1/entities/delete");
    expect(report.mirrored).toContain("POST /api/v1/entities/restore");
    expect(report.mirrored).toContain("POST /api/v1/entities/search");
    expect(report.mirrored).toContain("POST /api/v1/task-runs/:id/focus");
    expect(report.mirrored).toContain("DELETE /api/v1/tasks/:id");
    expect(report.mirrored).toContain("DELETE /api/v1/psyche/reports/:id");
  });

  it("keeps exclusions explicit and machine-readable", () => {
    expect(FORGE_PLUGIN_ROUTE_EXCLUSIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/api/v1/settings/tokens" }),
        expect.objectContaining({ method: "GET", path: "/api/v1/events/stream" }),
        expect.objectContaining({ method: "POST", path: "/api/v1/session-events" })
      ])
    );
  });

  it("publishes mirrored route keys for governance and diagnostics", () => {
    const mirrored = collectMirroredApiRouteKeys();
    expect(mirrored.has("GET /api/v1/context")).toBe(true);
    expect(mirrored.has("GET /api/v1/task-runs")).toBe(true);
    expect(mirrored.has("PATCH /api/v1/settings")).toBe(true);
    expect(mirrored.has("POST /api/v1/task-runs/:id/focus")).toBe(true);
    expect(mirrored.has("GET /api/v1/operator/overview")).toBe(true);
    expect(mirrored.has("GET /api/v1/psyche/values/:id")).toBe(true);
    expect(mirrored.has("GET /api/v1/psyche/patterns/:id")).toBe(true);
    expect(mirrored.has("DELETE /api/v1/tasks/:id")).toBe(true);
    expect(mirrored.has("GET /api/v1/tags/:id")).toBe(true);
    expect(mirrored.has("GET /api/v1/settings/bin")).toBe(true);
    expect(mirrored.has("POST /api/v1/entities/delete")).toBe(true);
  });

  it("mirrors every CRUD capability route declared by the shared entity matrix", () => {
    const mirrored = collectMirroredApiRouteKeys();
    for (const capability of getCrudEntityCapabilityMatrix()) {
      expect(mirrored.has(`GET ${capability.routeBase}`)).toBe(true);
      expect(mirrored.has(`POST ${capability.routeBase}`)).toBe(true);
      expect(mirrored.has(`GET ${capability.routeBase}/:id`)).toBe(true);
      expect(mirrored.has(`PATCH ${capability.routeBase}/:id`)).toBe(true);
      expect(mirrored.has(`DELETE ${capability.routeBase}/:id`)).toBe(true);
    }
  });
});
