import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { buildServer } from "../../../../apps/api/src/app";
import { PEER_API_SCHEMAS } from "../../../../apps/api/src/peer-api-schemas";
import { PEER_ROUTE_CONTRACTS } from "../../../../apps/api/src/peer-route-contract";
import { callConfiguredForgeApi } from "./api-client";
import {
  PEER_AGENT_ROUTE_SPECS,
  PEOPLE_AGENT_ROUTE_SPECS,
  registerForgePluginTools
} from "./tools";

vi.mock("./api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client.js")>();
  return {
    ...actual,
    callConfiguredForgeApi: vi.fn()
  };
});

type JsonSchema = Record<string, unknown>;

const TEST_CONFIG = {
  origin: "http://127.0.0.1",
  port: 4317,
  baseUrl: "http://127.0.0.1:4317",
  webAppUrl: "http://127.0.0.1:4317/forge/",
  portSource: "default",
  dataRoot: "",
  apiToken: "fg_live_people_peer_test",
  actorLabel: "contract-test",
  injectBootstrapContext: true,
  timeoutMs: 15_000
} as const;

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function resolvePointer(root: JsonSchema, pointer: string): unknown {
  if (!pointer.startsWith("#/")) return undefined;
  return pointer
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((value, part) => {
      if (!value || typeof value !== "object") return undefined;
      return (value as JsonSchema)[part];
    }, root);
}

function normalizeSchema(value: unknown, root: JsonSchema): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSchema(entry, root));
  }
  if (!value || typeof value !== "object") return value;

  const schema = value as JsonSchema;
  if (typeof schema.$ref === "string") {
    const referenced = resolvePointer(root, schema.$ref);
    return normalizeSchema(
      referenced && typeof referenced === "object"
        ? { ...(referenced as JsonSchema), ...schema, $ref: undefined }
        : schema,
      root
    );
  }

  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : null;
  const constants = anyOf?.map((entry) =>
    entry && typeof entry === "object" ? (entry as JsonSchema).const : undefined
  );
  if (anyOf && constants && constants.every((entry) => entry !== undefined)) {
    const types = anyOf
      .map((entry) =>
        entry && typeof entry === "object"
          ? (entry as JsonSchema).type
          : undefined
      )
      .filter((entry): entry is string => typeof entry === "string");
    return {
      ...(types.length === anyOf.length && new Set(types).size === 1
        ? { type: types[0] }
        : {}),
      enum: [...constants].sort(),
      ...(Object.hasOwn(schema, "default") ? { default: schema.default } : {})
    };
  }

  const normalized: JsonSchema = {};
  for (const key of [
    "type",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "pattern",
    "format",
    "minItems",
    "maxItems"
  ]) {
    if (Object.hasOwn(schema, key)) normalized[key] = schema[key];
  }
  if (Object.hasOwn(schema, "default")) normalized.default = schema.default;
  if (Array.isArray(schema.enum)) normalized.enum = [...schema.enum].sort();
  if (Array.isArray(schema.required)) {
    normalized.required = [...schema.required].sort();
  }
  if (schema.properties && typeof schema.properties === "object") {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties as JsonSchema)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeSchema(child, root)])
    );
  }
  if (Object.hasOwn(schema, "items")) {
    normalized.items = normalizeSchema(schema.items, root);
  }
  if (anyOf) {
    normalized.anyOf = anyOf
      .map((entry) => normalizeSchema(entry, root))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      );
  }
  if (schema.additionalProperties === false) {
    normalized.additionalProperties = false;
  } else if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    normalized.additionalProperties = normalizeSchema(
      schema.additionalProperties,
      root
    );
  } else if (
    schema.patternProperties &&
    typeof schema.patternProperties === "object" &&
    Object.keys(schema.patternProperties as JsonSchema).length === 1
  ) {
    normalized.additionalProperties = normalizeSchema(
      Object.values(schema.patternProperties as JsonSchema)[0],
      root
    );
  }
  return normalized;
}

function normalizeRootSchema(schema: unknown) {
  const root = schema as JsonSchema;
  return normalizeSchema(root, root);
}

function collectTools(apiToken: string = TEST_CONFIG.apiToken) {
  const tools: Array<{
    name: string;
    description: string;
    parameters: JsonSchema;
    execute: (toolCallId: string, params: unknown) => Promise<unknown>;
  }> = [];
  registerForgePluginTools(
    {
      registerTool(tool) {
        tools.push(tool as (typeof tools)[number]);
      }
    },
    { ...TEST_CONFIG, apiToken }
  );
  return tools;
}

const AGENT_ROUTE_SPECS = {
  ...PEOPLE_AGENT_ROUTE_SPECS,
  ...PEER_AGENT_ROUTE_SPECS
};
const mockedCallConfiguredForgeApi = vi.mocked(callConfiguredForgeApi);

describe("People and peer-sharing agent contract", () => {
  beforeEach(() => {
    mockedCallConfiguredForgeApi.mockReset();
    mockedCallConfiguredForgeApi.mockResolvedValue({
      status: 200,
      body: { ok: true }
    });
  });

  it("publishes exactly the routes marked MCP-exposed by the server contract", () => {
    const expected = PEER_ROUTE_CONTRACTS.filter((route) => route.mcpExposed)
      .map((route) => ({
        operationId: route.operationId,
        method: route.method,
        path: route.path,
        requiredScopes: [...route.requiredScopes],
        principalClasses: [...route.principalClasses],
        humanOnly: route.humanOnly,
        mcpExposed: route.mcpExposed
      }))
      .sort((left, right) => left.operationId.localeCompare(right.operationId));
    const actual = Object.values(AGENT_ROUTE_SPECS)
      .map((route) => ({
        operationId: route.operationId,
        method: route.method,
        path: route.path,
        requiredScopes: [...route.requiredScopes],
        principalClasses: [...route.principalClasses],
        humanOnly: route.humanOnly,
        mcpExposed: route.mcpExposed
      }))
      .sort((left, right) => left.operationId.localeCompare(right.operationId));

    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(15);
    expect(
      actual.every((route) => route.principalClasses.includes("agent_token"))
    ).toBe(true);
    expect(actual.every((route) => !route.humanOnly)).toBe(true);
  });

  it("keeps every exposed path, query, and body schema aligned with Zod", () => {
    for (const route of Object.values(AGENT_ROUTE_SPECS)) {
      const server = PEER_API_SCHEMAS[route.operationId];
      const serverParams = zodToJsonSchema(server.params) as JsonSchema;
      const serverQuery = zodToJsonSchema(server.query) as JsonSchema;

      expect(normalizeRootSchema(route.paramsSchema)).toEqual(
        normalizeRootSchema(serverParams)
      );
      expect(normalizeRootSchema(route.querySchema)).toEqual(
        normalizeRootSchema(serverQuery)
      );
      if (server.body) {
        expect(
          route.bodySchema,
          `${route.operationId} needs a tool body`
        ).toBeDefined();
        expect(normalizeRootSchema(route.bodySchema)).toEqual(
          normalizeRootSchema(zodToJsonSchema(server.body))
        );
      } else {
        expect(route.bodySchema).toBeUndefined();
      }
    }
  });

  it("registers only the two allowlisted tools and excludes every human-only action", () => {
    const tools = collectTools();
    const people = tools.find(
      (tool) => tool.name === "forge_call_people_route"
    );
    const peers = tools.find((tool) => tool.name === "forge_call_peer_route");
    expect(people).toBeDefined();
    expect(peers).toBeDefined();

    const publishedOperationIds = [people, peers].flatMap((tool) =>
      ((tool?.parameters.anyOf ?? []) as JsonSchema[]).map(
        (variant) =>
          ((variant.properties as JsonSchema).routeKey as JsonSchema).const
      )
    );
    expect(new Set(publishedOperationIds)).toEqual(
      new Set(
        PEER_ROUTE_CONTRACTS.filter((route) => route.mcpExposed).map(
          (route) => route.operationId
        )
      )
    );

    const humanOnlyOperationIds = PEER_ROUTE_CONTRACTS.filter(
      (route) => route.humanOnly || !route.mcpExposed
    ).map((route) => route.operationId);
    for (const operationId of humanOnlyOperationIds) {
      expect(publishedOperationIds).not.toContain(operationId);
    }
    expect(people?.description).toMatch(/cannot pair Forge installations/i);
    expect(people?.description).toContain("redactedFields");
    expect(people?.description).toMatch(/never infer withheld fields/i);
    expect(peers?.description).toMatch(/cannot create or accept pairing/i);
  });

  it("requires an explicit scoped agent token even on local People reads", async () => {
    const people = collectTools("").find(
      (tool) => tool.name === "forge_call_people_route"
    );
    await expect(
      people?.execute("call_people", { routeKey: "listPeopleReadModel" })
    ).rejects.toThrow(/configured Forge agent token/i);
  });

  it("forwards exact People and peer paths, queries, and bodies", async () => {
    const tools = collectTools();
    const people = tools.find(
      (tool) => tool.name === "forge_call_people_route"
    );
    const peers = tools.find((tool) => tool.name === "forge_call_peer_route");

    await people?.execute("call_people_list", {
      routeKey: "listPeopleReadModel",
      query: { query: "Jon Doe", source: "shared", limit: 10 }
    });
    expect(mockedCallConfiguredForgeApi).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ apiToken: TEST_CONFIG.apiToken }),
      {
        method: "GET",
        path: "/api/v1/people?query=Jon+Doe&source=shared&limit=10",
        body: undefined
      }
    );

    const questionBody = {
      question: "What is Jon doing next Monday?",
      timeZone: "Europe/Zurich",
      referenceTime: "2026-07-15T12:00:00.000+02:00"
    };
    await people?.execute("call_people_question", {
      routeKey: "interpretPersonQuestion",
      pathParams: { personId: "person/jon" },
      body: questionBody
    });
    expect(mockedCallConfiguredForgeApi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ apiToken: TEST_CONFIG.apiToken }),
      {
        method: "POST",
        path: "/api/v1/people/person%2Fjon/questions/interpret",
        body: questionBody
      }
    );

    await peers?.execute("call_peer_diagnostics", {
      routeKey: "getPeerDiagnostics",
      pathParams: { relationshipId: "relationship/one" },
      query: { limit: 25 }
    });
    expect(mockedCallConfiguredForgeApi).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ apiToken: TEST_CONFIG.apiToken }),
      {
        method: "GET",
        path: "/api/v1/peers/relationships/relationship%2Fone/diagnostics?limit=25",
        body: undefined
      }
    );
  });

  it("keeps person batch-first and the live OpenAPI route catalog current", async () => {
    const dataRoot = mkdtempSync(
      path.join(os.tmpdir(), "forge-person-catalog-")
    );
    temporaryRoots.push(dataRoot);
    const app = await buildServer({ dataRoot, taskRunWatchdog: false });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding"
    });
    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(openApiResponse.statusCode).toBe(200);
    const person = response
      .json()
      .onboarding.entityCatalog.find(
        (entry: { entityType: string }) => entry.entityType === "person"
      );
    expect(person?.classification).toBe("batch_crud_entity");
    expect(person?.preferredMutationTool).toMatch(/forge_create_entities/);
    expect(person?.preferredMutationTool).toMatch(/forge_restore_entities/);
    expect(person?.questionFlow?.openingQuestion).toMatch(
      /Who is this person/i
    );

    const openApi = openApiResponse.json() as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    for (const route of PEER_ROUTE_CONTRACTS) {
      const openApiPath = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      expect(
        openApi.paths[openApiPath]?.[route.method.toLowerCase()]?.operationId,
        `${route.method} ${route.path} is missing from live OpenAPI`
      ).toBe(route.operationId);
    }
  });
});
