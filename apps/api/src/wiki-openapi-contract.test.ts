import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenApiDocument } from "./openapi.js";

test("OpenAPI publishes bounded compact wiki browse and ranked search contracts", () => {
  type Schema = {
    additionalProperties?: boolean;
    required?: string[];
    properties: Record<
      string,
      { maximum?: number; maxLength?: number } | undefined
    >;
  };
  type Document = {
    components: { schemas: Record<string, Schema> };
    paths: {
      "/api/v1/wiki/pages": {
        get: {
          parameters: Array<{
            name: string;
            schema: { maximum?: number };
          }>;
          responses: {
            "200": {
              content: { "application/json": { schema: { $ref: string } } };
            };
          };
        };
        post: {
          requestBody: {
            required: boolean;
            content: { "application/json": { schema: { $ref: string } } };
          };
          responses: { "201": unknown };
        };
      };
      "/api/v1/wiki/pages/{id}": {
        get: {
          parameters: Array<{
            name: string;
            in: string;
            required?: boolean;
          }>;
        };
        patch: {
          parameters: Array<{
            name: string;
            in: string;
            required?: boolean;
          }>;
          requestBody: {
            required: boolean;
            content: { "application/json": { schema: { $ref: string } } };
          };
        };
        delete: {
          parameters: Array<{
            name: string;
            in: string;
            required?: boolean;
          }>;
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    required: string[];
                    properties: Record<string, unknown>;
                  };
                };
              };
            };
          };
        };
      };
      "/api/v1/wiki/by-slug/{slug}": {
        get: {
          parameters: Array<{
            name: string;
            in: string;
            required?: boolean;
          }>;
        };
      };
      "/api/v1/wiki/search": {
        post: {
          requestBody: {
            content: { "application/json": { schema: { $ref: string } } };
          };
          responses: {
            "200": {
              content: { "application/json": { schema: { $ref: string } } };
            };
          };
        };
      };
      "/api/v1/wiki/tree": { get: unknown };
    };
  };

  const document = buildOpenApiDocument() as unknown as Document;
  const summary = document.components.schemas.WikiPageSummary;
  const searchInput = document.components.schemas.WikiSearchInput;
  const searchResult = document.components.schemas.WikiSearchResult;
  const searchResponse = document.components.schemas.WikiSearchResponse;

  assert.equal(summary.additionalProperties, false);
  assert.ok(summary.properties.title);
  assert.ok(summary.properties.summary);
  assert.equal(summary.properties.contentMarkdown, undefined);
  assert.equal(searchInput.properties.limit?.maximum, 50);
  assert.equal(searchInput.properties.offset?.maximum, 999);
  assert.equal(searchInput.properties.query?.maxLength, 500);
  for (const field of ["matchKind", "snippet", "score", "page"]) {
    assert.ok(searchResult.properties[field]);
  }
  for (const field of [
    "limit",
    "offset",
    "hasMore",
    "nextOffset",
    "warnings",
    "results"
  ]) {
    assert.ok(searchResponse.properties[field]);
  }

  const pageLimit = document.paths["/api/v1/wiki/pages"].get.parameters.find(
    (parameter) => parameter.name === "limit"
  );
  assert.equal(pageLimit?.schema.maximum, 500);
  const pageOffset = document.paths["/api/v1/wiki/pages"].get.parameters.find(
    (parameter) => parameter.name === "offset"
  );
  assert.equal(pageOffset?.schema.maximum, 9999);
  assert.equal(
    document.paths["/api/v1/wiki/pages"].get.responses["200"].content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/WikiPageListResponse"
  );
  assert.equal(
    document.paths["/api/v1/wiki/search"].post.requestBody.content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/WikiSearchInput"
  );
  assert.equal(
    document.paths["/api/v1/wiki/search"].post.responses["200"].content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/WikiSearchResponse"
  );
  assert.ok(document.paths["/api/v1/wiki/tree"].get);
  assert.ok(document.paths["/api/v1/wiki/pages"].post.responses["201"]);
  assert.equal(
    document.paths["/api/v1/wiki/pages"].post.requestBody.content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/WikiPageCreateInput"
  );
  assert.deepEqual(document.components.schemas.WikiPageCreateInput.required, [
    "contentMarkdown"
  ]);
  assert.equal(
    document.paths["/api/v1/wiki/pages/{id}"].patch.requestBody.content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/WikiPagePatchInput"
  );
  assert.equal(
    document.components.schemas.WikiPagePatchInput.required,
    undefined
  );
  for (const operation of ["get", "patch", "delete"] as const) {
    const id = document.paths["/api/v1/wiki/pages/{id}"][
      operation
    ].parameters.find((parameter) => parameter.name === "id");
    assert.equal(id?.in, "path");
    assert.equal(id?.required, true);
  }
  const slug = document.paths[
    "/api/v1/wiki/by-slug/{slug}"
  ].get.parameters.find((parameter) => parameter.name === "slug");
  assert.equal(slug?.in, "path");
  assert.equal(slug?.required, true);
  const deleteSchema =
    document.paths["/api/v1/wiki/pages/{id}"].delete.responses["200"].content[
      "application/json"
    ].schema;
  assert.deepEqual(deleteSchema.required, ["deleted"]);
  assert.ok(deleteSchema.properties.deleted);
});
