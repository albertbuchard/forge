import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTestHarness } from "../helpers.js";

interface OpenApiOperation {
  parameters?: { in: string; name: string }[];
  responses?: Record<
    string,
    { headers?: Record<string, { schema?: Record<string, unknown> }> }
  >;
  security?: { ForgeChannelSignature?: unknown[] }[];
}

interface OpenApiDocument {
  components?: { securitySchemes?: Record<string, unknown> };
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

describe("OpenAPI contract", () => {
  it("contains only the exact service routes and signs every channel operation", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const document = harness.service.app.swagger() as OpenApiDocument;

    assert.equal(document.openapi, "3.1.0");
    assert.deepEqual(Object.keys(document.paths).sort(), [
      "/.well-known/forge-connectivity",
      "/healthz",
      "/v1/envelopes/{opaqueChannel}",
      "/v1/envelopes/{opaqueChannel}/ack",
      "/v1/key-packages/{opaqueChannel}",
      "/v1/presence/{opaqueChannel}"
    ]);
    assert.deepEqual(
      Object.keys(document.paths["/v1/presence/{opaqueChannel}"] ?? {}).sort(),
      ["delete", "get", "put"]
    );
    assert.deepEqual(
      Object.keys(document.paths["/v1/envelopes/{opaqueChannel}"] ?? {}).sort(),
      ["get", "post"]
    );
    assert.deepEqual(
      Object.keys(document.paths["/v1/envelopes/{opaqueChannel}/ack"] ?? {}),
      ["post"]
    );
    assert.deepEqual(
      Object.keys(
        document.paths["/v1/key-packages/{opaqueChannel}"] ?? {}
      ).sort(),
      ["get", "put"]
    );
    assert.equal(
      Object.keys(document.paths).some((route) => route.includes("admin")),
      false
    );

    for (const [route, operations] of Object.entries(document.paths)) {
      if (!route.startsWith("/v1/")) {
        continue;
      }
      for (const operation of Object.values(operations)) {
        assert.deepEqual(operation.security, [{ ForgeChannelSignature: [] }]);
      }
    }

    const securitySchemes = document.components?.securitySchemes ?? {};
    assert.ok("ForgeChannelSignature" in securitySchemes);
    assert.equal(
      Object.keys(securitySchemes).some((name) =>
        name.toLowerCase().includes("bearer")
      ),
      false
    );

    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        const queryNames = (operation.parameters ?? [])
          .filter((parameter) => parameter.in === "query")
          .map((parameter) => parameter.name);
        assert.equal(queryNames.includes("type"), false);
        assert.equal(queryNames.includes("additionalProperties"), false);
        assert.equal(queryNames.includes("maxProperties"), false);
      }
    }
    assert.deepEqual(
      (document.paths["/v1/envelopes/{opaqueChannel}"]?.get?.parameters ?? [])
        .filter((parameter) => parameter.in === "query")
        .map((parameter) => parameter.name),
      ["cursor", "limit", "waitSeconds"]
    );

    const mutationResponses: [string, string, string[]][] = [
      ["/v1/presence/{opaqueChannel}", "put", ["200", "201"]],
      ["/v1/presence/{opaqueChannel}", "delete", ["200"]],
      ["/v1/envelopes/{opaqueChannel}", "post", ["200", "202"]],
      ["/v1/envelopes/{opaqueChannel}/ack", "post", ["200"]],
      ["/v1/key-packages/{opaqueChannel}", "put", ["200", "201"]]
    ];
    for (const [route, method, statuses] of mutationResponses) {
      const operation = document.paths[route]?.[method];
      assert.ok(operation);
      for (const status of statuses) {
        assert.deepEqual(
          operation.responses?.[status]?.headers?.["idempotency-replayed"]
            ?.schema,
          { type: "string", enum: ["true", "false"] }
        );
      }
    }
  });
});
