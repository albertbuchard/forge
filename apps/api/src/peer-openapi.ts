import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  PEER_API_SCHEMAS,
  type PeerApiOperationId
} from "./peer-api-schemas.js";
import { PEER_ROUTE_CONTRACTS } from "./peer-route-contract.js";

type OpenApiSchema = Record<string, unknown>;

function schemaName(operationId: string, suffix: string) {
  return `${operationId[0]!.toUpperCase()}${operationId.slice(1)}${suffix}`;
}

function toInlineOpenApiSchema(schema: z.ZodTypeAny): OpenApiSchema {
  const converted = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none"
  }) as OpenApiSchema;
  const { $schema: _schema, definitions: _definitions, ...result } = converted;
  return result;
}

function rewriteComponentReferences(
  value: unknown,
  definitionPrefix: string,
  componentPrefix: string
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteComponentReferences(entry, definitionPrefix, componentPrefix)
    );
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      if (
        key === "$ref" &&
        typeof nested === "string" &&
        nested.startsWith(definitionPrefix)
      ) {
        return [
          key,
          `${componentPrefix}${nested.slice(definitionPrefix.length)}`
        ];
      }
      return [
        key,
        rewriteComponentReferences(nested, definitionPrefix, componentPrefix)
      ];
    })
  );
}

function toOpenApiComponentSchema(
  schema: z.ZodTypeAny,
  componentName: string
): OpenApiSchema {
  const converted = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "root",
    name: componentName
  }) as OpenApiSchema;
  const definitions = converted.definitions as
    | Record<string, OpenApiSchema>
    | undefined;
  const root = definitions?.[componentName];
  if (!root) {
    throw new Error(`OpenAPI schema ${componentName} has no root definition.`);
  }
  return rewriteComponentReferences(
    root,
    `#/definitions/${componentName}`,
    `#/components/schemas/${componentName}`
  ) as OpenApiSchema;
}

function parametersFor(
  schema: z.ZodTypeAny,
  location: "path" | "query"
): OpenApiSchema[] {
  const converted = toInlineOpenApiSchema(schema);
  const properties = (converted.properties ?? {}) as Record<
    string,
    OpenApiSchema
  >;
  const required = new Set(
    Array.isArray(converted.required) ? (converted.required as string[]) : []
  );
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: location === "path" || required.has(name),
    schema: propertySchema
  }));
}

function response(description: string, operationId: PeerApiOperationId) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${schemaName(operationId, "Success")}`
        }
      }
    }
  };
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" }
      }
    }
  };
}

function peopleListConflictResponse() {
  return {
    description:
      "The owner-scoped People read model changed after the cursor was issued (`people_cursor_snapshot_changed`) or changed repeatedly during the initial read (`people_snapshot_busy`). Discard the cursor and restart from the first page.",
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["code", "error", "statusCode", "restartRequired"],
          properties: {
            code: {
              type: "string",
              enum: ["people_cursor_snapshot_changed", "people_snapshot_busy"]
            },
            error: { type: "string" },
            statusCode: { type: "integer", enum: [409] },
            restartRequired: { type: "boolean", enum: [true] },
            expectedRevision: { type: "integer", minimum: 0 },
            currentRevision: { type: "integer", minimum: 0 }
          }
        }
      }
    }
  };
}

export function buildPeerOpenApiComponents() {
  const schemas: Record<string, OpenApiSchema> = {};
  for (const contract of PEER_ROUTE_CONTRACTS) {
    const operationId = contract.operationId as PeerApiOperationId;
    const runtime = PEER_API_SCHEMAS[operationId];
    const paramsName = schemaName(operationId, "Params");
    const queryName = schemaName(operationId, "Query");
    const successName = schemaName(operationId, "Success");
    schemas[paramsName] = toOpenApiComponentSchema(runtime.params, paramsName);
    schemas[queryName] = toOpenApiComponentSchema(runtime.query, queryName);
    if (runtime.body) {
      const bodyName = schemaName(operationId, "Body");
      schemas[bodyName] = toOpenApiComponentSchema(runtime.body, bodyName);
    }
    schemas[successName] = toOpenApiComponentSchema(
      runtime.success.schema,
      successName
    );
  }
  return schemas;
}

export function buildPeerOpenApiPaths() {
  const paths: Record<string, Record<string, OpenApiSchema>> = {};
  for (const contract of PEER_ROUTE_CONTRACTS) {
    const operationId = contract.operationId as PeerApiOperationId;
    const runtime = PEER_API_SCHEMAS[operationId];
    const path = contract.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, "{$1}");
    const parameters = [
      ...parametersFor(runtime.params, "path"),
      ...parametersFor(runtime.query, "query")
    ];
    const operation: OpenApiSchema = {
      operationId,
      summary: contract.summary,
      tags: [contract.tag],
      parameters,
      responses: {
        [String(runtime.success.status)]: response(
          `${contract.summary} response.`,
          operationId
        ),
        "400": errorResponse("The request did not match the bounded contract."),
        "401": errorResponse("Authentication is required."),
        "403": errorResponse("The authenticated principal is not authorized."),
        "404": errorResponse(
          "The requested owner-scoped record was not found."
        ),
        "409":
          operationId === "listPeopleReadModel"
            ? peopleListConflictResponse()
            : errorResponse("Reviewed or versioned state changed."),
        "429": errorResponse("The bounded operation rate was exceeded."),
        "503": errorResponse(
          "The peer or required local service is unavailable."
        )
      },
      "x-forge-api-family": "people-peer-sharing",
      "x-forge-principal-classes": [...contract.principalClasses],
      "x-forge-required-scopes": [...contract.requiredScopes],
      "x-forge-human-only": contract.humanOnly,
      "x-forge-mcp-exposed": contract.mcpExposed
    };
    if (runtime.body) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: `#/components/schemas/${schemaName(operationId, "Body")}`
            }
          }
        }
      };
    }
    const method = contract.method.toLowerCase();
    paths[path] = { ...(paths[path] ?? {}), [method]: operation };
  }
  return paths;
}
