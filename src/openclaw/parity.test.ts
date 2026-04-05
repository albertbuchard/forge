import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../server/src/openapi";
import { collectSupportedPluginApiRouteKeys } from "./parity";
import { buildRouteParityReport, collectMirroredApiRouteKeys } from "./routes";

describe("forge plugin route parity", () => {
  it("covers the curated plugin contract and nothing broader", () => {
    const openapi = buildOpenApiDocument();
    const report = buildRouteParityReport(openapi.paths ?? {});

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
    expect(supported.has("POST /api/v1/entities/search")).toBe(true);
    expect(supported.has("POST /api/v1/work-adjustments")).toBe(true);
    expect(supported.has("POST /api/v1/insights")).toBe(true);
  });

  it("mirrors exactly the curated upstream routes", () => {
    const mirrored = collectMirroredApiRouteKeys();
    expect(mirrored).toEqual(collectSupportedPluginApiRouteKeys());
  });
});
