import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import { createAiProcessor } from "./repositories/ai-processors.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

function insertCatalogFlows(count: number) {
  const database = getDatabase();
  const insert = database.prepare(
    `INSERT INTO ai_connectors (
      id, slug, title, description, kind, home_surface_id,
      endpoint_enabled, graph_json, public_inputs_json,
      published_outputs_json, last_run_json, legacy_processor_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  );
  const timestamp = "2026-07-16T12:00:00.000Z";
  runInTransaction(() => {
    for (let index = 1; index <= count; index += 1) {
      const suffix = String(index).padStart(4, "0");
      const kind = index % 2 === 0 ? "chat" : "functor";
      const enabled = index % 3 === 0 ? 0 : 1;
      const title =
        index === count
          ? `100% Ready catalog flow ${suffix}`
          : `Catalog flow ${suffix}`;
      insert.run(
        `catalog_${suffix}`,
        `catalog-flow-${suffix}`,
        title,
        `${title} description ${"x".repeat(900)}`,
        kind,
        index % 5 === 0 ? "wiki" : "projects",
        enabled,
        JSON.stringify({
          nodes: [
            {
              id: `node_${suffix}`,
              type: "functor",
              position: { x: 0, y: 0 },
              data: {
                label: index === 7 ? "Needle node label" : `Node ${suffix}`,
                description: "",
                prompt: "Do not transfer this graph through catalog reads."
              }
            }
          ],
          edges: []
        }),
        JSON.stringify([
          {
            key: "topic",
            label: "Topic",
            kind: "text",
            required: false,
            bindings: []
          }
        ]),
        JSON.stringify([
          {
            id: `output_${suffix}`,
            nodeId: `node_${suffix}`,
            label: `Output ${suffix}`,
            apiPath: `/api/v1/workbench/flows/catalog_${suffix}/output`
          }
        ]),
        index % 4 === 0
          ? JSON.stringify({
              status: "completed",
              createdAt: timestamp,
              completedAt: timestamp
            })
          : null,
        timestamp,
        timestamp
      );
    }
  });
}

test("Workbench catalogs are bounded, searchable, pure, and preserve exact contracts", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-workbench-catalog-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    peerRuntime: false,
    taskRunWatchdog: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    insertCatalogFlows(600);

    const startedAt = performance.now();
    const firstPageResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/flows?limit=24",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    const elapsedMs = performance.now() - startedAt;
    assert.equal(firstPageResponse.statusCode, 200);
    assert.ok(elapsedMs < 2_500, `catalog page took ${elapsedMs.toFixed(1)}ms`);
    assert.ok(firstPageResponse.body.length < 80_000);
    const firstPage = firstPageResponse.json() as {
      flows: Array<Record<string, unknown>>;
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
      facets: {
        kinds: Array<{ value: string; count: number }>;
        statuses: Array<{ value: string; count: number }>;
      };
    };
    assert.equal(firstPage.flows.length, 24);
    assert.equal(firstPage.total, 600);
    assert.equal(firstPage.limit, 24);
    assert.equal(firstPage.offset, 0);
    assert.equal(firstPage.hasMore, true);
    assert.ok(firstPage.facets.kinds.some((facet) => facet.value === "chat"));
    assert.ok(
      firstPage.facets.statuses.some(
        (facet) => facet.value === "disabled" && facet.count === 200
      )
    );
    for (const flow of firstPage.flows) {
      assert.equal(flow.graph, undefined);
      assert.equal(flow.publicInputs, undefined);
      assert.equal(flow.publishedOutputs, undefined);
      assert.equal(flow.lastRun, undefined);
      assert.equal(typeof flow.nodeCount, "number");
      assert.equal(typeof flow.publishedOutputCount, "number");
      assert.ok(String(flow.description).length <= 601);
    }

    const filteredResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/flows?q=needle&kind=functor&status=enabled&limit=24",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    assert.equal(filteredResponse.statusCode, 200);
    const filtered = filteredResponse.json() as {
      flows: Array<{ id: string; status: string }>;
      total: number;
    };
    assert.equal(filtered.total, 1);
    assert.equal(filtered.flows.length, 1);
    assert.equal(filtered.flows[0]?.id, "catalog_0007");
    assert.equal(filtered.flows[0]?.status, "enabled");

    const literalWildcardResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/flows?q=%25",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    assert.equal(literalWildcardResponse.statusCode, 200);
    const literalWildcard = literalWildcardResponse.json() as {
      flows: Array<{ id: string }>;
      total: number;
    };
    assert.equal(literalWildcard.total, 1);
    assert.equal(literalWildcard.flows[0]?.id, "catalog_0600");

    const secondPageResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/flows?limit=24&offset=24",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    assert.equal(secondPageResponse.statusCode, 200);
    const secondPage = secondPageResponse.json() as {
      flows: Array<{ id: string }>;
    };
    assert.equal(secondPage.flows.length, 24);
    assert.equal(
      new Set([
        ...firstPage.flows.map((flow) => String(flow.id)),
        ...secondPage.flows.map((flow) => flow.id)
      ]).size,
      48
    );

    const outputCatalogResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/catalog/boxes?source=flow_output&q=Catalog%20flow%200600&limit=10",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    assert.equal(outputCatalogResponse.statusCode, 200);
    const outputCatalog = outputCatalogResponse.json() as {
      boxes: Array<{
        source: string;
        sourceFlowId: string;
        sourceFlowEnabled: boolean;
        output: Array<{ key: string }>;
      }>;
      total: number;
      hasMore: boolean;
    };
    assert.equal(outputCatalog.total, 1);
    assert.equal(outputCatalog.hasMore, false);
    assert.equal(outputCatalog.boxes[0]?.source, "flow_output");
    assert.equal(outputCatalog.boxes[0]?.sourceFlowId, "catalog_0600");
    assert.equal(outputCatalog.boxes[0]?.sourceFlowEnabled, false);
    assert.equal(outputCatalog.boxes[0]?.output[0]?.key, "output_0600");

    const forgeBoxResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/catalog/boxes?source=forge&limit=1",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    assert.equal(forgeBoxResponse.statusCode, 200);
    const forgeBoxPage = forgeBoxResponse.json() as {
      boxes: Array<{ source: string; inputs: unknown[]; output: unknown[] }>;
      total: number;
      limit: number;
      hasMore: boolean;
    };
    assert.equal(forgeBoxPage.boxes.length, 1);
    assert.equal(forgeBoxPage.boxes[0]?.source, "forge");
    assert.ok(Array.isArray(forgeBoxPage.boxes[0]?.inputs));
    assert.ok(Array.isArray(forgeBoxPage.boxes[0]?.output));
    assert.equal(forgeBoxPage.limit, 1);
    assert.equal(forgeBoxPage.hasMore, forgeBoxPage.total > 1);

    createAiProcessor({
      surfaceId: "projects",
      title: "Created after startup",
      promptFlow: "",
      contextInput: "",
      toolConfig: [],
      agentIds: [],
      agentConfigs: [],
      triggerMode: "manual",
      cronExpression: "",
      machineAccess: { read: false, write: false, exec: false },
      endpointEnabled: true
    });
    const beforePureRead = (
      getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM ai_connectors")
        .get() as {
        count: number;
      }
    ).count;
    const pureReadResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/flows?limit=1",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    assert.equal(pureReadResponse.statusCode, 200);
    const afterPureRead = (
      getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM ai_connectors")
        .get() as {
        count: number;
      }
    ).count;
    assert.equal(afterPureRead, beforePureRead);

    for (const url of [
      "/api/v1/workbench/flows?limit=101",
      "/api/v1/workbench/flows?includeArchived=false",
      "/api/v1/workbench/catalog/boxes?source=unknown"
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie, host: "127.0.0.1:4317" }
      });
      assert.equal(response.statusCode, 400, url);
    }

    const unauthorizedResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/flows",
      headers: { host: "forge.invalid" }
    });
    assert.equal(unauthorizedResponse.statusCode, 401);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Workbench OpenAPI and onboarding publish the paged catalog contract", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-workbench-contract-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    peerRuntime: false,
    taskRunWatchdog: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { cookie }
    });
    assert.equal(openApiResponse.statusCode, 200);
    const document = openApiResponse.json() as {
      components: {
        schemas: Record<
          string,
          { additionalProperties?: boolean; required?: string[] }
        >;
      };
      paths: Record<
        string,
        {
          get?: {
            parameters?: Array<{
              name: string;
              schema?: {
                default?: number;
                maximum?: number;
                maxLength?: number;
              };
            }>;
            responses?: Record<
              string,
              {
                content?: {
                  "application/json"?: { schema?: { $ref?: string } };
                };
              }
            >;
          };
        }
      >;
    };
    const flows = document.paths["/api/v1/workbench/flows"]?.get;
    const boxes = document.paths["/api/v1/workbench/catalog/boxes"]?.get;
    assert.equal(
      flows?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/WorkbenchFlowCatalogPage"
    );
    assert.equal(
      boxes?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/WorkbenchBoxCatalogPage"
    );
    assert.deepEqual(
      flows?.parameters
        ?.filter((parameter) =>
          ["q", "kind", "homeSurfaceId", "status", "limit", "offset"].includes(
            parameter.name
          )
        )
        .map((parameter) => parameter.name),
      ["q", "kind", "homeSurfaceId", "status", "limit", "offset"]
    );
    assert.equal(
      flows?.parameters?.find((parameter) => parameter.name === "q")?.schema
        ?.maxLength,
      200
    );
    assert.deepEqual(
      [
        flows?.parameters?.find((parameter) => parameter.name === "limit")
          ?.schema?.default,
        flows?.parameters?.find((parameter) => parameter.name === "limit")
          ?.schema?.maximum
      ],
      [24, 100]
    );
    assert.equal(
      document.components.schemas.WorkbenchFlowCatalogItem
        ?.additionalProperties,
      false
    );
    assert.equal(
      document.components.schemas.WorkbenchBoxCatalogItem?.additionalProperties,
      false
    );
    assert.ok(
      document.components.schemas.WorkbenchFlowCatalogPage?.required?.includes(
        "hasMore"
      )
    );
    assert.ok(
      document.components.schemas.WorkbenchBoxCatalogPage?.required?.includes(
        "facets"
      )
    );

    const onboardingResponse = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding",
      headers: { cookie, host: "127.0.0.1:4317" }
    });
    assert.equal(onboardingResponse.statusCode, 200);
    assert.match(onboardingResponse.body, /hasMore/);
    assert.match(onboardingResponse.body, /status=enabled/);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
