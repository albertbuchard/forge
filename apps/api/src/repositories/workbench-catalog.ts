import type { SQLInputValue } from "node:sqlite";
import {
  buildConnectorOutputCatalogEntry,
  listForgeBoxCatalog
} from "../connectors/box-registry.js";
import { getDatabase } from "../db.js";
import type { AiConnectorKind, ForgeBoxCatalogEntry } from "../types.js";

export const DEFAULT_WORKBENCH_CATALOG_LIMIT = 24;
export const MAX_WORKBENCH_CATALOG_LIMIT = 100;
export const MAX_WORKBENCH_CATALOG_QUERY_LENGTH = 200;
const MAX_WORKBENCH_CATALOG_FACETS = 100;
const MAX_WORKBENCH_FLOW_DESCRIPTION_LENGTH = 600;

export type WorkbenchFlowCatalogStatus = "enabled" | "disabled";
export type WorkbenchBoxCatalogSource = "forge" | "flow_output";

export type WorkbenchCatalogFacet = {
  value: string;
  label: string;
  count: number;
};

export type WorkbenchFlowCatalogItem = {
  id: string;
  slug: string;
  title: string;
  description: string;
  descriptionTruncated: boolean;
  kind: AiConnectorKind;
  homeSurfaceId: string | null;
  endpointEnabled: boolean;
  status: WorkbenchFlowCatalogStatus;
  nodeCount: number;
  edgeCount: number;
  publicInputCount: number;
  publishedOutputCount: number;
  lastRunStatus: "running" | "completed" | "failed" | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkbenchBoxCatalogItem = ForgeBoxCatalogEntry & {
  source: WorkbenchBoxCatalogSource;
  sourceFlowId: string | null;
  sourceFlowEnabled: boolean | null;
};

type WorkbenchFlowCatalogRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  description_length: number;
  kind: AiConnectorKind;
  home_surface_id: string | null;
  endpoint_enabled: number;
  node_count: number;
  edge_count: number;
  public_input_count: number;
  published_output_count: number;
  last_run_status: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConnectorOutputCatalogRow = {
  connector_id: string;
  connector_title: string;
  home_surface_id: string | null;
  endpoint_enabled: number;
  output_id: string;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function addInFilter(
  clauses: string[],
  params: SQLInputValue[],
  column: string,
  values: readonly SQLInputValue[]
) {
  if (values.length === 0) {
    return;
  }
  clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function titleCase(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function toFacet(value: string, count: number, label = titleCase(value)) {
  return { value, label, count } satisfies WorkbenchCatalogFacet;
}

function buildFlowWhere(input: {
  q?: string;
  kinds?: AiConnectorKind[];
  homeSurfaceIds?: string[];
  statuses?: WorkbenchFlowCatalogStatus[];
}) {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  const query = input.q?.trim().toLowerCase() ?? "";
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    clauses.push(`(
      lower(title) LIKE ? ESCAPE '\\'
      OR lower(description) LIKE ? ESCAPE '\\'
      OR lower(slug) LIKE ? ESCAPE '\\'
      OR lower(kind) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(home_surface_id, '')) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM json_each(
          CASE WHEN json_valid(graph_json) THEN graph_json ELSE '{"nodes":[]}' END,
          '$.nodes'
        ) AS node
        WHERE lower(COALESCE(json_extract(node.value, '$.data.label'), ''))
          LIKE ? ESCAPE '\\'
      )
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  addInFilter(clauses, params, "kind", input.kinds ?? []);
  addInFilter(clauses, params, "home_surface_id", input.homeSurfaceIds ?? []);
  addInFilter(
    clauses,
    params,
    "endpoint_enabled",
    (input.statuses ?? []).map((status) => (status === "enabled" ? 1 : 0))
  );
  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function listFlowFacets() {
  const database = getDatabase();
  const kindRows = database
    .prepare(
      `SELECT kind AS value, COUNT(*) AS count
       FROM ai_connectors
       GROUP BY kind
       ORDER BY count DESC, value ASC`
    )
    .all() as Array<{ value: string; count: number }>;
  const surfaceRows = database
    .prepare(
      `SELECT home_surface_id AS value, COUNT(*) AS count
       FROM ai_connectors
       WHERE home_surface_id IS NOT NULL AND trim(home_surface_id) <> ''
       GROUP BY home_surface_id
       ORDER BY count DESC, value ASC
       LIMIT ?`
    )
    .all(MAX_WORKBENCH_CATALOG_FACETS) as Array<{
    value: string;
    count: number;
  }>;
  const statusRow = database
    .prepare(
      `SELECT
         SUM(CASE WHEN endpoint_enabled = 1 THEN 1 ELSE 0 END) AS enabled_count,
         SUM(CASE WHEN endpoint_enabled = 0 THEN 1 ELSE 0 END) AS disabled_count
       FROM ai_connectors`
    )
    .get() as { enabled_count: number | null; disabled_count: number | null };
  return {
    kinds: kindRows.map((row) => toFacet(row.value, row.count)),
    homeSurfaces: surfaceRows.map((row) =>
      toFacet(row.value, row.count, row.value)
    ),
    statuses: [
      toFacet("enabled", statusRow.enabled_count ?? 0, "Endpoint enabled"),
      toFacet("disabled", statusRow.disabled_count ?? 0, "Endpoint disabled")
    ]
  };
}

export function listWorkbenchFlowCatalogPage(
  input: {
    q?: string;
    kinds?: AiConnectorKind[];
    homeSurfaceIds?: string[];
    statuses?: WorkbenchFlowCatalogStatus[];
    limit?: number;
    offset?: number;
  } = {}
) {
  const limit = Math.min(
    MAX_WORKBENCH_CATALOG_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_WORKBENCH_CATALOG_LIMIT))
  );
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const where = buildFlowWhere(input);
  const database = getDatabase();
  const total = (
    database
      .prepare(`SELECT COUNT(*) AS count FROM ai_connectors ${where.sql}`)
      .get(...where.params) as { count: number }
  ).count;
  const rows = database
    .prepare(
      `SELECT
         id,
         slug,
         title,
         substr(description, 1, ?) AS description,
         length(description) AS description_length,
         kind,
         home_surface_id,
         endpoint_enabled,
         CASE WHEN json_valid(graph_json)
           THEN COALESCE(json_array_length(json_extract(graph_json, '$.nodes')), 0)
           ELSE 0
         END AS node_count,
         CASE WHEN json_valid(graph_json)
           THEN COALESCE(json_array_length(json_extract(graph_json, '$.edges')), 0)
           ELSE 0
         END AS edge_count,
         CASE WHEN json_valid(public_inputs_json)
           THEN COALESCE(json_array_length(public_inputs_json), 0)
           ELSE 0
         END AS public_input_count,
         CASE WHEN json_valid(published_outputs_json)
           THEN COALESCE(json_array_length(published_outputs_json), 0)
           ELSE 0
         END AS published_output_count,
         CASE WHEN json_valid(last_run_json)
           THEN json_extract(last_run_json, '$.status')
           ELSE NULL
         END AS last_run_status,
         CASE WHEN json_valid(last_run_json)
           THEN COALESCE(
             json_extract(last_run_json, '$.completedAt'),
             json_extract(last_run_json, '$.createdAt')
           )
           ELSE NULL
         END AS last_run_at,
         created_at,
         updated_at
       FROM ai_connectors
       ${where.sql}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(
      MAX_WORKBENCH_FLOW_DESCRIPTION_LENGTH + 1,
      ...where.params,
      limit,
      offset
    ) as WorkbenchFlowCatalogRow[];
  const flows = rows.map(
    (row): WorkbenchFlowCatalogItem => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description:
        row.description_length > MAX_WORKBENCH_FLOW_DESCRIPTION_LENGTH
          ? `${row.description.slice(0, MAX_WORKBENCH_FLOW_DESCRIPTION_LENGTH).trimEnd()}…`
          : row.description,
      descriptionTruncated:
        row.description_length > MAX_WORKBENCH_FLOW_DESCRIPTION_LENGTH,
      kind: row.kind,
      homeSurfaceId: row.home_surface_id,
      endpointEnabled: row.endpoint_enabled === 1,
      status: row.endpoint_enabled === 1 ? "enabled" : "disabled",
      nodeCount: row.node_count,
      edgeCount: row.edge_count,
      publicInputCount: row.public_input_count,
      publishedOutputCount: row.published_output_count,
      lastRunStatus:
        row.last_run_status === "running" ||
        row.last_run_status === "completed" ||
        row.last_run_status === "failed"
          ? row.last_run_status
          : null,
      lastRunAt: row.last_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  );
  return {
    flows,
    total,
    limit,
    offset,
    hasMore: offset + flows.length < total,
    facets: listFlowFacets()
  };
}

function withBoxSource(box: ForgeBoxCatalogEntry): WorkbenchBoxCatalogItem {
  return {
    ...box,
    source: "forge",
    sourceFlowId: null,
    sourceFlowEnabled: null
  };
}

function matchesBoxQuery(box: WorkbenchBoxCatalogItem, query: string) {
  if (!query) {
    return true;
  }
  return [
    box.title,
    box.description,
    box.category,
    box.surfaceId ?? "",
    box.routePath ?? "",
    ...box.tags,
    ...box.inputs.flatMap((port) => [port.key, port.label, port.kind]),
    ...box.params.flatMap((port) => [port.key, port.label, port.kind]),
    ...box.output.flatMap((port) => [port.key, port.label, port.kind]),
    ...box.tools.flatMap((tool) => [tool.key, tool.label, tool.description])
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function buildConnectorOutputWhere(input: {
  q?: string;
  categories?: string[];
  surfaceIds?: string[];
}) {
  const clauses = [
    "json_valid(connector.published_outputs_json)",
    "json_type(output.value) = 'object'",
    "COALESCE(json_extract(output.value, '$.id'), '') <> ''"
  ];
  const params: SQLInputValue[] = [];
  const categories = input.categories ?? [];
  if (categories.length > 0 && !categories.includes("Workbench outputs")) {
    clauses.push("0 = 1");
  }
  addInFilter(
    clauses,
    params,
    "connector.home_surface_id",
    input.surfaceIds ?? []
  );
  const query = input.q?.trim().toLowerCase() ?? "";
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    clauses.push(`(
      lower(connector.title) LIKE ? ESCAPE '\\'
      OR lower(connector.description) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(connector.home_surface_id, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(json_extract(output.value, '$.label'), '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(json_extract(output.value, '$.id'), '')) LIKE ? ESCAPE '\\'
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

function listBoxFacets(staticBoxes: WorkbenchBoxCatalogItem[]) {
  const database = getDatabase();
  const outputCount = (
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ai_connectors AS connector,
           json_each(
             CASE WHEN json_valid(connector.published_outputs_json)
               THEN connector.published_outputs_json
               ELSE '[]'
             END
           ) AS output
         WHERE json_type(output.value) = 'object'
           AND COALESCE(json_extract(output.value, '$.id'), '') <> ''`
      )
      .get() as { count: number }
  ).count;
  const outputSurfaces = database
    .prepare(
      `SELECT connector.home_surface_id AS value, COUNT(*) AS count
       FROM ai_connectors AS connector,
         json_each(
           CASE WHEN json_valid(connector.published_outputs_json)
             THEN connector.published_outputs_json
             ELSE '[]'
           END
         ) AS output
       WHERE connector.home_surface_id IS NOT NULL
         AND trim(connector.home_surface_id) <> ''
         AND json_type(output.value) = 'object'
         AND COALESCE(json_extract(output.value, '$.id'), '') <> ''
       GROUP BY connector.home_surface_id
       ORDER BY count DESC, value ASC
       LIMIT ?`
    )
    .all(MAX_WORKBENCH_CATALOG_FACETS) as Array<{
    value: string;
    count: number;
  }>;
  const categoryCounts = new Map<string, number>();
  const surfaceCounts = new Map<string, number>();
  for (const box of staticBoxes) {
    categoryCounts.set(
      box.category,
      (categoryCounts.get(box.category) ?? 0) + 1
    );
    if (box.surfaceId) {
      surfaceCounts.set(
        box.surfaceId,
        (surfaceCounts.get(box.surfaceId) ?? 0) + 1
      );
    }
  }
  if (outputCount > 0) {
    categoryCounts.set("Workbench outputs", outputCount);
  }
  for (const row of outputSurfaces) {
    surfaceCounts.set(
      row.value,
      (surfaceCounts.get(row.value) ?? 0) + row.count
    );
  }
  const sortedFacets = (counts: Map<string, number>) =>
    [...counts.entries()]
      .sort(
        ([leftValue, leftCount], [rightValue, rightCount]) =>
          rightCount - leftCount || leftValue.localeCompare(rightValue)
      )
      .slice(0, MAX_WORKBENCH_CATALOG_FACETS)
      .map(([value, count]) => toFacet(value, count, value));
  return {
    categories: sortedFacets(categoryCounts),
    surfaces: sortedFacets(surfaceCounts),
    sources: [
      toFacet("forge", staticBoxes.length, "Forge boxes"),
      toFacet("flow_output", outputCount, "Flow outputs")
    ]
  };
}

export function listWorkbenchBoxCatalogPage(
  input: {
    q?: string;
    categories?: string[];
    surfaceIds?: string[];
    sources?: WorkbenchBoxCatalogSource[];
    limit?: number;
    offset?: number;
  } = {}
) {
  const limit = Math.min(
    MAX_WORKBENCH_CATALOG_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_WORKBENCH_CATALOG_LIMIT))
  );
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const query = input.q?.trim().toLowerCase() ?? "";
  const sources = input.sources ?? [];
  const includeForge = sources.length === 0 || sources.includes("forge");
  const includeOutputs =
    sources.length === 0 || sources.includes("flow_output");
  const allStaticBoxes = listForgeBoxCatalog().map(withBoxSource);
  const staticMatches = includeForge
    ? allStaticBoxes
        .filter(
          (box) =>
            matchesBoxQuery(box, query) &&
            ((input.categories?.length ?? 0) === 0 ||
              input.categories!.includes(box.category)) &&
            ((input.surfaceIds?.length ?? 0) === 0 ||
              (box.surfaceId !== null &&
                input.surfaceIds!.includes(box.surfaceId)))
        )
        .sort(
          (left, right) =>
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id)
        )
    : [];
  const outputWhere = buildConnectorOutputWhere(input);
  const database = getDatabase();
  const outputTotal = includeOutputs
    ? (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM ai_connectors AS connector,
               json_each(
                 CASE WHEN json_valid(connector.published_outputs_json)
                   THEN connector.published_outputs_json
                   ELSE '[]'
                 END
               ) AS output
             ${outputWhere.sql}`
          )
          .get(...outputWhere.params) as { count: number }
      ).count
    : 0;
  const staticPage = staticMatches.slice(offset, offset + limit);
  const outputLimit = Math.max(0, limit - staticPage.length);
  const outputOffset = Math.max(0, offset - staticMatches.length);
  const outputRows =
    includeOutputs && outputLimit > 0
      ? (database
          .prepare(
            `SELECT
               connector.id AS connector_id,
               connector.title AS connector_title,
               connector.home_surface_id,
               connector.endpoint_enabled,
               json_extract(output.value, '$.id') AS output_id
             FROM ai_connectors AS connector,
               json_each(
                 CASE WHEN json_valid(connector.published_outputs_json)
                   THEN connector.published_outputs_json
                   ELSE '[]'
                 END
               ) AS output
             ${outputWhere.sql}
             ORDER BY
               lower(connector.title) ASC,
               lower(COALESCE(json_extract(output.value, '$.label'), '')) ASC,
               output_id ASC
             LIMIT ? OFFSET ?`
          )
          .all(
            ...outputWhere.params,
            outputLimit,
            outputOffset
          ) as ConnectorOutputCatalogRow[])
      : [];
  const outputBoxes = outputRows.map(
    (row): WorkbenchBoxCatalogItem => ({
      ...buildConnectorOutputCatalogEntry({
        connectorId: row.connector_id,
        title: row.connector_title,
        outputId: row.output_id
      }),
      surfaceId: row.home_surface_id,
      source: "flow_output",
      sourceFlowId: row.connector_id,
      sourceFlowEnabled: row.endpoint_enabled === 1
    })
  );
  const boxes = [...staticPage, ...outputBoxes];
  const total = staticMatches.length + outputTotal;
  return {
    boxes,
    total,
    limit,
    offset,
    hasMore: offset + boxes.length < total,
    facets: listBoxFacets(allStaticBoxes)
  };
}
