import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import {
  closeDatabase,
  configureDatabase,
  initializeDatabase
} from "../../apps/api/src/db";
import { KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP } from "../../apps/web/src/lib/knowledge-graph-types";
import {
  buildPerformanceGraphFixture,
  PERFORMANCE_GRAPH_SIZES,
  type PerformanceGraphSize
} from "./knowledge-graph-performance-fixture";
import { installE2eStorageGuards, waitForForge } from "./helpers";

const resultRoot = process.env.FORGE_KG_PERF_RESULT_DIR?.trim();
const repetitions = Number.parseInt(
  process.env.FORGE_KG_PERF_REPETITIONS ?? "5",
  10
);
const configuredSizes = (
  process.env.FORGE_KG_PERF_SIZES ?? "small,medium,large"
)
  .split(",")
  .map((value) => value.trim())
  .filter(
    (value): value is PerformanceGraphSize => value in PERFORMANCE_GRAPH_SIZES
  );
const positionMode =
  process.env.FORGE_KG_POSITION_MODE === "baseline"
    ? ("baseline" as const)
    : ("optimized" as const);
const adaptiveMode =
  process.env.FORGE_KG_ADAPTIVE_MODE === "off"
    ? ("off" as const)
    : ("on" as const);
const requireSigma = process.env.FORGE_KG_PERF_WEBGL === "1";
const fullStack = process.env.FORGE_KG_PERF_FULL_STACK === "1";
const FULL_STACK_REQUIRED_ENTITY_KINDS = [
  "goal",
  "project",
  "task",
  "tag",
  "wiki_page",
  "note",
  "wiki_space",
  "value",
  "pattern",
  "behavior",
  "belief",
  "mode",
  "event_type",
  "emotion",
  "workbench",
  "functor",
  "chat"
] as const;
const FULL_STACK_REQUIRED_RELATION_KINDS = [
  "goal_project",
  "project_task",
  "tag_goal",
  "tag_task",
  "wiki_parent",
  "note_link",
  "wiki_link",
  "value_goal",
  "pattern_value",
  "behavior_pattern",
  "belief_value",
  "mode_value",
  "workbench_route",
  "workbench_flow"
] as const;
const FULL_STACK_REQUIRED_RELATION_FAMILIES = [
  "structural",
  "contextual",
  "taxonomy",
  "workspace"
] as const;
const FULL_STACK_LARGE_NOTE_COUNT = 1_953;

test.use({ trace: "off" });

let seededFullStackSize: PerformanceGraphSize | null = null;

async function seedFullStackFixture(size: PerformanceGraphSize) {
  if (seededFullStackSize === size) return;
  const dataRoot = process.env.FORGE_E2E_DATA_ROOT;
  if (!dataRoot) {
    throw new Error(
      "Full-stack graph performance requires an isolated data root."
    );
  }
  configureDatabase({ dataRoot, seedDemoData: true });
  await initializeDatabase();
  closeDatabase();
  const dimensions = PERFORMANCE_GRAPH_SIZES[size];
  const noteCount =
    size === "large" ? FULL_STACK_LARGE_NOTE_COUNT : dimensions.nodes;
  const database = new DatabaseSync(path.join(dataRoot, "forge.sqlite"));
  const now = "2026-08-01T00:00:00.000Z";
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare("DELETE FROM note_links WHERE note_id LIKE 'kgperf_%'")
      .run();
    database.prepare("DELETE FROM notes WHERE id LIKE 'kgperf_%'").run();
    database
      .prepare(
        `INSERT OR IGNORE INTO ai_connectors (
          id, slug, title, description, kind, home_surface_id,
          endpoint_enabled, graph_json, public_inputs_json,
          published_outputs_json, last_run_json, legacy_processor_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, '[]', '[]', NULL, NULL, ?, ?)`
      )
      .run(
        "aic_kgperf_functor",
        "kgperf-functor",
        "Knowledge synthesis flow",
        "Deterministic full-stack benchmark functor.",
        "functor",
        "wiki",
        JSON.stringify({ nodes: [], edges: [] }),
        now,
        now
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO ai_connectors (
          id, slug, title, description, kind, home_surface_id,
          endpoint_enabled, graph_json, public_inputs_json,
          published_outputs_json, last_run_json, legacy_processor_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, '[]', '[]', NULL, NULL, ?, ?)`
      )
      .run(
        "aic_kgperf_chat",
        "kgperf-chat",
        "Knowledge navigation chat",
        "Deterministic full-stack benchmark chat.",
        "chat",
        "projects",
        JSON.stringify({ nodes: [], edges: [] }),
        now,
        now
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO psyche_values (
          id, domain_id, title, description, valued_direction, why_it_matters,
          linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
          committed_actions_json, created_at, updated_at
        ) VALUES (?, 'domain_psyche', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "psy_kgperf_value",
        "Evidence-led navigation",
        "Keep the graph truthful and useful.",
        "Follow durable knowledge relationships.",
        "The benchmark must preserve meaning.",
        JSON.stringify(["goal_build_forge"]),
        JSON.stringify(["project_forge_mobile"]),
        JSON.stringify(["task_flagship_review"]),
        JSON.stringify(["Open the strongest evidence first"]),
        now,
        now
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO behavior_patterns (
          id, domain_id, title, description, target_behavior, cue_contexts_json,
          short_term_payoff, long_term_cost, preferred_response,
          linked_value_ids_json, linked_schema_labels_json, linked_mode_labels_json,
          linked_mode_ids_json, linked_belief_ids_json, created_at, updated_at
        ) VALUES (?, 'domain_psyche', ?, ?, ?, '[]', ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?)`
      )
      .run(
        "pat_kgperf_pattern",
        "Dense graph overload",
        "Too much undifferentiated context obscures meaning.",
        "Rendering every low-value relationship",
        "Everything remains visible",
        "Navigation becomes noisy",
        "Reveal context progressively",
        JSON.stringify(["psy_kgperf_value"]),
        JSON.stringify(["mod_kgperf_mode"]),
        JSON.stringify(["blf_kgperf_belief"]),
        now,
        now
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO psyche_behaviors (
          id, domain_id, kind, title, description, common_cues_json, urge_story,
          short_term_payoff, long_term_cost, replacement_move, repair_plan,
          linked_pattern_ids_json, linked_value_ids_json, linked_schema_ids_json,
          linked_mode_ids_json, created_at, updated_at
        ) VALUES (?, 'domain_psyche', 'committed', ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`
      )
      .run(
        "bhv_kgperf_behavior",
        "Follow relevant context",
        "Open direct evidence before expanding the graph.",
        "More context may help",
        "A focused path",
        "Missing wider context",
        "Use search and semantic filters",
        "Return to the durable backbone",
        JSON.stringify(["pat_kgperf_pattern"]),
        JSON.stringify(["psy_kgperf_value"]),
        JSON.stringify(["mod_kgperf_mode"]),
        now,
        now
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO belief_entries (
          id, domain_id, schema_id, statement, belief_type, origin_note, confidence,
          evidence_for_json, evidence_against_json, flexible_alternative,
          linked_value_ids_json, linked_behavior_ids_json, linked_mode_ids_json,
          linked_report_ids_json, created_at, updated_at
        ) VALUES (?, 'domain_psyche', NULL, ?, 'conditional', ?, 80, '[]', '[]', ?, ?, ?, ?, '[]', ?, ?)`
      )
      .run(
        "blf_kgperf_belief",
        "Progressive disclosure can preserve truth.",
        "Deterministic benchmark belief",
        "Hidden presentation remains searchable.",
        JSON.stringify(["psy_kgperf_value"]),
        JSON.stringify(["bhv_kgperf_behavior"]),
        JSON.stringify(["mod_kgperf_mode"]),
        now,
        now
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO mode_profiles (
          id, domain_id, family, archetype, title, persona, imagery, symbolic_form,
          facial_expression, fear, burden, protective_job, origin_context,
          first_appearance_at, linked_pattern_ids_json, linked_behavior_ids_json,
          linked_value_ids_json, created_at, updated_at
        ) VALUES (?, 'domain_psyche', 'healthy_adult', 'adult', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "mod_kgperf_mode",
        "Calm navigator",
        "A deliberate explorer of connected knowledge.",
        "A clear map with a visible path",
        "Compass",
        "Attentive",
        "Losing relevant context",
        "Carries the need for clarity",
        "Keep the selected path visible",
        "Knowledge navigation benchmark",
        now,
        JSON.stringify(["pat_kgperf_pattern"]),
        JSON.stringify(["bhv_kgperf_behavior"]),
        JSON.stringify(["psy_kgperf_value"]),
        now,
        now
      );
    const insertNote = database.prepare(
      `INSERT INTO notes (
        id, kind, title, slug, space_id, parent_slug, index_order, show_in_index,
        aliases_json, summary, content_markdown, content_plain, author, source,
        tags_json, destroy_at, source_path, frontmatter_json, revision_hash,
        last_synced_at, created_at, updated_at
      ) VALUES (?, 'evidence', ?, ?, 'wiki_space_shared', NULL, 0, 1, '[]', ?, ?, ?, NULL,
        'system', '[]', NULL, '', '{}', '', NULL, ?, ?)`
    );
    for (let index = 0; index < noteCount; index += 1) {
      const id = `kgperf_${size}_${String(index).padStart(4, "0")}`;
      const title = `kgperf-${size} deterministic note ${index}`;
      insertNote.run(
        id,
        title,
        id,
        `kgperf-${size} full-stack fixture`,
        `# ${title}\n\nAuthorized isolated benchmark fixture.`,
        `${title} Authorized isolated benchmark fixture.`,
        now,
        now
      );
    }
    const insertLink = database.prepare(
      `INSERT OR IGNORE INTO note_links (
        note_id, entity_type, entity_id, anchor_key, created_at
      ) VALUES (?, 'note', ?, ?, ?)`
    );
    for (let index = 0; index < dimensions.edges; index += 1) {
      const sourceIndex = index % noteCount;
      const targetIndex =
        (sourceIndex + 1 + ((index * 37) % (noteCount - 1))) % noteCount;
      insertLink.run(
        `kgperf_${size}_${String(sourceIndex).padStart(4, "0")}`,
        `kgperf_${size}_${String(targetIndex).padStart(4, "0")}`,
        `kgperf-edge-${index}`,
        now
      );
    }
    database.exec("COMMIT");
    seededFullStackSize = size;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

type BrowserCollector = {
  frames: number[];
  longTasks: Array<{ startTime: number; duration: number }>;
};

type JourneyResult = {
  name:
    | "pan"
    | "zoom"
    | "selection"
    | "details-open"
    | "details-return"
    | "search"
    | "filter-change";
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  within25MsPercent: number | null;
  sampleCount: number;
  interactionLatencyMs: number;
  longTasks: Array<{ startTime: number; duration: number }>;
};

declare global {
  interface Window {
    __FORGE_KG_PERF_COLLECTOR__?: BrowserCollector;
    __FORGE_KG_PERF_INPUT_AT__?: number;
    __FORGE_KG_PERF_VISIBLE_AT__?: number;
    __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: {
      visibleNodeIds: string[];
      focusedNodeId: string | null;
      layoutGeneration: number;
      rendererMode?: string;
      camera: { x: number; y: number; ratio: number };
      nodeScreenPositions: Record<
        string,
        { x: number; y: number; size: number }
      >;
    };
    __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
      selectNode: (nodeId: string | null) => void;
      nudgeCameraBy: (deltaX: number, deltaY: number) => void;
    };
    __FORGE_KG_POSITION_MODE__?: "baseline" | "optimized";
    __FORGE_KG_ADAPTIVE_MODE__?: "off" | "on";
    __FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?: {
      workerPositionMessageCount: number;
      positionCommitCount: number;
      rendererRefreshCount: number;
      rejectedPositionMessageCount: number;
      retainedNodeCount: number;
      retainedEdgeCount: number;
      renderedNodeCount: number;
      renderedEdgeCount: number;
      lastNormalizedRmsDisplacement: number | null;
      layoutStartedAt: number | null;
      initialLayoutSettledAt: number | null;
      stableLayoutAt: number | null;
      firstUsefulGraphAt: number | null;
      lastRenderAt: number | null;
      requestedPresentationKey: string;
      renderedPresentationKey: string | null;
      focusNodeId: string | null;
      camera: { x: number; y: number; ratio: number; angle: number } | null;
    };
  }
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1)
  );
  return sorted[index] ?? null;
}

function summarizeRuns(measured: Array<Record<string, unknown>>) {
  return configuredSizes.map((size) => {
    const runs = measured.filter((run) => run.size === size) as Array<{
      journeys?: JourneyResult[];
      loadError?: string | null;
      idleRefresh?: { rejected: boolean };
    }>;
    const primaryValues = runs
      .filter((run) => !run.loadError && !run.idleRefresh?.rejected)
      .map((run) =>
        Math.max(...(run.journeys ?? []).map((journey) => journey.p95Ms ?? 0))
      );
    const mean =
      primaryValues.length > 0
        ? primaryValues.reduce((sum, value) => sum + value, 0) /
          primaryValues.length
        : null;
    const standardDeviation =
      mean === null
        ? null
        : Math.sqrt(
            primaryValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
              primaryValues.length
          );
    return {
      size,
      validRuns: primaryValues.length,
      rejectedRuns: runs.length - primaryValues.length,
      medianWorstJourneyP95Ms: percentile(primaryValues, 0.5),
      interquartileRangeMs:
        primaryValues.length > 0
          ? (percentile(primaryValues, 0.75) ?? 0) -
            (percentile(primaryValues, 0.25) ?? 0)
          : null,
      worstRunMs: primaryValues.length > 0 ? Math.max(...primaryValues) : null,
      coefficientOfVariation:
        mean && standardDeviation !== null ? standardDeviation / mean : null
    };
  });
}

function summarizeJourney(
  name: JourneyResult["name"],
  timestamps: number[],
  interactionLatencyMs: number,
  longTasks: JourneyResult["longTasks"]
): JourneyResult {
  const intervals = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index]!)
    .filter((interval) => interval > 0 && interval < 1_000);
  return {
    name,
    p50Ms: percentile(intervals, 0.5),
    p95Ms: percentile(intervals, 0.95),
    p99Ms: percentile(intervals, 0.99),
    maxMs: intervals.length > 0 ? Math.max(...intervals) : null,
    within25MsPercent:
      intervals.length > 0
        ? (intervals.filter((interval) => interval <= 25).length /
            intervals.length) *
          100
        : null,
    sampleCount: intervals.length,
    interactionLatencyMs,
    longTasks
  };
}

async function collectJourney(
  page: Page,
  name: JourneyResult["name"],
  action: () => Promise<number>
) {
  process.stdout.write(`[knowledge-graph-performance] start ${name}\n`);
  const startIndex = await page.evaluate(
    () => window.__FORGE_KG_PERF_COLLECTOR__?.frames.length ?? 0
  );
  const longTaskStartIndex = await page.evaluate(
    () => window.__FORGE_KG_PERF_COLLECTOR__?.longTasks.length ?? 0
  );
  await page.evaluate(() => {
    delete window.__FORGE_KG_PERF_INPUT_AT__;
    delete window.__FORGE_KG_PERF_VISIBLE_AT__;
  });
  const completedAt = await action();
  const startedAt = await page.evaluate(
    () => window.__FORGE_KG_PERF_INPUT_AT__ ?? null
  );
  if (startedAt === null) {
    throw new Error(`Journey ${name} did not record its browser input mark.`);
  }
  await page.waitForTimeout(1_000);
  const samples = await page.evaluate(
    ({ frameFrom, taskFrom }) => ({
      frames: window.__FORGE_KG_PERF_COLLECTOR__?.frames.slice(frameFrom) ?? [],
      longTasks:
        window.__FORGE_KG_PERF_COLLECTOR__?.longTasks.slice(taskFrom) ?? []
    }),
    { frameFrom: startIndex, taskFrom: longTaskStartIndex }
  );
  const result = summarizeJourney(
    name,
    samples.frames,
    completedAt - startedAt,
    samples.longTasks
  );
  process.stdout.write(`[knowledge-graph-performance] finish ${name}\n`);
  return result;
}

async function readBrowserHeap(page: Page) {
  return page.evaluate(() => {
    const memory = (
      performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }
    ).memory;
    return memory
      ? {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit
        }
      : null;
  });
}

async function readCdpPerformanceMetrics(page: Page) {
  try {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Performance.enable");
      const response = (await session.send("Performance.getMetrics")) as {
        metrics: Array<{ name: string; value: number }>;
      };
      return Object.fromEntries(
        response.metrics.map((metric) => [metric.name, metric.value])
      );
    } finally {
      await session.detach();
    }
  } catch {
    return null;
  }
}

async function collectRetainedHeapGarbage(page: Page) {
  try {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("HeapProfiler.collectGarbage");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );
      return true;
    } finally {
      await session.detach();
    }
  } catch {
    return false;
  }
}

async function installCollector(page: Page) {
  await page.addInitScript(
    (configured) => {
      const collector: BrowserCollector = { frames: [], longTasks: [] };
      window.__FORGE_KG_PERF_COLLECTOR__ = collector;
      const sample = (timestamp: number) => {
        collector.frames.push(timestamp);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      if ("PerformanceObserver" in window) {
        try {
          new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
              collector.longTasks.push({
                startTime: entry.startTime,
                duration: entry.duration
              });
            });
          }).observe({ entryTypes: ["longtask"] });
        } catch {
          // The result records an empty list when this browser omits long-task support.
        }
      }
      window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
      window.__FORGE_KG_POSITION_MODE__ = configured.positionMode;
      window.__FORGE_KG_ADAPTIVE_MODE__ = configured.adaptiveMode;
    },
    { positionMode, adaptiveMode }
  );
}

async function runFixtureJourney(page: Page, size: PerformanceGraphSize) {
  const fixture = buildPerformanceGraphFixture(size);
  const relationKindsInFixture = new Set(
    fixture.edges.map((edge) => edge.relationKind)
  );
  expect(relationKindsInFixture).toEqual(
    new Set(Object.keys(KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP))
  );
  fixture.edges.forEach((edge) => {
    expect(edge.family).toBe(
      KNOWLEDGE_GRAPH_RELATION_FAMILY_MAP[edge.relationKind]
    );
  });
  const requestTimings: Array<{
    path: string;
    startedAt: number;
    fulfilledAt: number;
    payloadBytes: number;
  }> = [];
  let fullStackResponseCounts: {
    nodes: number;
    edges: number;
    filteredNodes: number;
    filteredEdges: number;
  } | null = null;
  let fullStackResponseDistribution: {
    entityKinds: Record<string, number>;
    relationKinds: Record<string, number>;
    relationFamilies: Record<string, number>;
  } | null = null;
  let fullStackResponseIdentityHash: string | null = null;
  if (fullStack) {
    await seedFullStackFixture(size);
  } else {
    await page.route("**/api/v1/knowledge-graph**", async (route) => {
      const startedAt = performance.now();
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/focus")) {
        const focusId = url.searchParams.get("entityId");
        const focusNode =
          fixture.nodes.find((node) => node.entityId === focusId) ??
          fixture.nodes[0]!;
        const directEdges = fixture.edges
          .filter(
            (edge) =>
              edge.source === focusNode.id || edge.target === focusNode.id
          )
          .slice(0, 24);
        const neighborIds = new Set(
          directEdges.flatMap((edge) => [edge.source, edge.target])
        );
        const body = JSON.stringify({
          focus: {
            generatedAt: fixture.generatedAt,
            focusNode,
            firstRingNodes: fixture.nodes.filter((node) =>
              neighborIds.has(node.id)
            ),
            neighborhoodEdges: directEdges,
            familyGroups: [],
            relationCounts: {
              structural: 0,
              contextual: directEdges.length,
              taxonomy: 0,
              workspace: 0
            },
            secondRingCounts: {
              structural: 0,
              contextual: 0,
              taxonomy: 0,
              workspace: 0
            }
          }
        });
        await route.fulfill({
          contentType: "application/json",
          body
        });
        requestTimings.push({
          path: url.pathname,
          startedAt,
          fulfilledAt: performance.now(),
          payloadBytes: Buffer.byteLength(body)
        });
        return;
      }
      const queryText = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
      const responseGraph = queryText
        ? (() => {
            const nodes = fixture.nodes.filter((node) =>
              `${node.title} ${node.subtitle} ${node.description} ${node.searchText ?? ""}`
                .toLowerCase()
                .includes(queryText)
            );
            const nodeIds = new Set(nodes.map((node) => node.id));
            const edges = fixture.edges.filter(
              (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
            );
            return {
              ...fixture,
              nodes,
              edges,
              counts: {
                ...fixture.counts,
                nodeCount: nodes.length,
                edgeCount: edges.length,
                filteredNodeCount: nodes.length,
                filteredEdgeCount: edges.length,
                limited: false
              }
            };
          })()
        : fixture;
      const body = JSON.stringify({ graph: responseGraph });
      await route.fulfill({
        contentType: "application/json",
        body
      });
      requestTimings.push({
        path: url.pathname,
        startedAt,
        fulfilledAt: performance.now(),
        payloadBytes: Buffer.byteLength(body)
      });
    });
  }

  const navigationStartedAt = Date.now();
  let loadError: string | null = null;
  try {
    const search = new URLSearchParams({
      limit: "2000",
      graphDiagnostics: "1",
      fixture: size
    });
    if (process.env.FORGE_KG_PERF_DISPLAY === "all") {
      search.set("display", "all");
    }
    const requestStartedAt = performance.now();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/knowledge-graph?") &&
        !response.url().includes("/focus")
    );
    await page.goto(`knowledge-graph?${search.toString()}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    const graphResponse = await responsePromise;
    if (fullStack) {
      const responseBody = await graphResponse.body();
      requestTimings.push({
        path: new URL(graphResponse.url()).pathname,
        startedAt: requestStartedAt,
        fulfilledAt: performance.now(),
        payloadBytes: responseBody.byteLength
      });
      const responseText = responseBody.toString("utf8");
      const responsePayload = JSON.parse(responseText) as {
        graph: {
          nodes: Array<{ id: string; entityKind: string }>;
          edges: Array<{
            id: string;
            relationKind: string;
            family: string;
          }>;
          counts: {
            filteredNodeCount: number;
            filteredEdgeCount: number;
          };
        };
      };
      if (!responsePayload.graph) {
        throw new Error(
          `Knowledge Graph API returned HTTP ${graphResponse.status()}: ${responseText.slice(0, 500)}`
        );
      }
      fullStackResponseCounts = {
        nodes: responsePayload.graph.nodes.length,
        edges: responsePayload.graph.edges.length,
        filteredNodes: responsePayload.graph.counts.filteredNodeCount,
        filteredEdges: responsePayload.graph.counts.filteredEdgeCount
      };
      fullStackResponseDistribution = {
        entityKinds: responsePayload.graph.nodes.reduce<Record<string, number>>(
          (counts, node) => {
            counts[node.entityKind] = (counts[node.entityKind] ?? 0) + 1;
            return counts;
          },
          {}
        ),
        relationKinds: responsePayload.graph.edges.reduce<
          Record<string, number>
        >((counts, edge) => {
          counts[edge.relationKind] = (counts[edge.relationKind] ?? 0) + 1;
          return counts;
        }, {}),
        relationFamilies: responsePayload.graph.edges.reduce<
          Record<string, number>
        >((counts, edge) => {
          counts[edge.family] = (counts[edge.family] ?? 0) + 1;
          return counts;
        }, {})
      };
      fullStackResponseIdentityHash = createHash("sha256")
        .update(
          JSON.stringify({
            nodeIds: responsePayload.graph.nodes.map((node) => node.id).sort(),
            edgeIds: responsePayload.graph.edges.map((edge) => edge.id).sort()
          })
        )
        .digest("hex");
      expect(fullStackResponseCounts.nodes).toBeGreaterThanOrEqual(
        size === "large" ? 2_000 : Math.max(fixture.nodes.length, 1)
      );
      for (const kind of FULL_STACK_REQUIRED_ENTITY_KINDS) {
        expect(fullStackResponseDistribution.entityKinds[kind]).toBeGreaterThan(
          0
        );
      }
      for (const kind of FULL_STACK_REQUIRED_RELATION_KINDS) {
        expect(
          fullStackResponseDistribution.relationKinds[kind]
        ).toBeGreaterThan(0);
      }
      for (const family of FULL_STACK_REQUIRED_RELATION_FAMILIES) {
        expect(
          fullStackResponseDistribution.relationFamilies[family]
        ).toBeGreaterThan(0);
      }
    }
    await waitForForge(page);
    await page.waitForFunction(
      (expectedSourceNodeCount) => {
        const diagnostics = window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__;
        const pageState = window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__;
        const performance = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
        return Boolean(
          diagnostics &&
          pageState &&
          performance &&
          pageState.presentationNodeCount > 0 &&
          diagnostics.visibleNodeIds.length ===
            pageState.presentationNodeCount &&
          performance.retainedNodeCount === expectedSourceNodeCount
        );
      },
      fullStack ? (fullStackResponseCounts?.nodes ?? 0) : fixture.nodes.length,
      { timeout: size === "large" ? 30_000 : 20_000 }
    );
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }
  const firstUsefulGraphMs = Date.now() - navigationStartedAt;
  if (loadError) {
    return {
      size,
      expected: PERFORMANCE_GRAPH_SIZES[size],
      loadError,
      firstUsefulGraphMs,
      requestTimings,
      fullStackResponseCounts,
      fullStackResponseDistribution,
      fullStackResponseIdentityHash,
      journeys: [] as JourneyResult[],
      longTasks: [],
      heap: null
    };
  }

  await page.waitForFunction(
    () =>
      typeof window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
        ?.initialLayoutSettledAt === "number",
    undefined,
    { timeout: size === "large" ? 15_000 : 10_000 }
  );
  const diagnostics = await page.evaluate(
    () => window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__!
  );
  if (requireSigma) {
    expect(diagnostics.rendererMode).toBe("sigma");
  }
  const idleSample = await page.evaluate(async () => {
    const start = window.__FORGE_KG_PERF_COLLECTOR__?.frames.length ?? 0;
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    return {
      visibilityState: document.visibilityState,
      frames: window.__FORGE_KG_PERF_COLLECTOR__?.frames.slice(start) ?? []
    };
  });
  const idleIntervals = idleSample.frames
    .slice(1)
    .map((timestamp, index) => timestamp - idleSample.frames[index]!)
    .filter((interval) => interval > 0 && interval < 1_000);
  const idleMedianMs = percentile(idleIntervals, 0.5);
  const idleP95Ms = percentile(idleIntervals, 0.95);
  const refreshRejected =
    idleSample.visibilityState !== "visible" ||
    idleMedianMs === null ||
    idleP95Ms === null ||
    idleP95Ms > idleMedianMs * 1.5;
  const targetNodeId =
    diagnostics.visibleNodeIds[
      Math.min(17, diagnostics.visibleNodeIds.length - 1)
    ]!;
  const preJourneyGarbageCollected = await collectRetainedHeapGarbage(page);
  const preJourneyHeap = await readBrowserHeap(page);
  const preJourneyCdpMetrics = await readCdpPerformanceMetrics(page);
  const canvas = page.getByLabel("Knowledge graph canvas").first();
  const journeys: JourneyResult[] = [];
  journeys.push(
    await collectJourney(page, "pan", async () => {
      const before = await page.evaluate(() => ({
        camera: window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.camera!,
        lastRenderAt:
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.lastRenderAt ?? 0
      }));
      await page.evaluate(() => {
        window.__FORGE_KG_PERF_INPUT_AT__ = performance.now();
        window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.nudgeCameraBy(0.09, 0.04);
      });
      await page.waitForFunction((previous) => {
        const snapshot = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
        const camera = snapshot?.camera;
        return Boolean(
          camera &&
          snapshot.lastRenderAt !== null &&
          snapshot.lastRenderAt > previous.lastRenderAt &&
          (Math.abs(camera.x - previous.camera.x) > 0.01 ||
            Math.abs(camera.y - previous.camera.y) > 0.01)
        );
      }, before);
      return page.evaluate(
        () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.lastRenderAt!
      );
    })
  );
  journeys.push(
    await collectJourney(page, "zoom", async () => {
      const before = await page.evaluate(() => ({
        ratio: window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.camera!.ratio,
        lastRenderAt:
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.lastRenderAt ?? 0
      }));
      const isMobile = await page.evaluate(
        () => window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.isMobile ?? false
      );
      const box = await canvas.boundingBox();
      if (isMobile) {
        await page.evaluate(() => {
          const inputAt = performance.now();
          window.__FORGE_KG_PERF_INPUT_AT__ = inputAt;
          window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.zoomIn?.();
          const observeVisibleZoom = () => {
            const renderAt =
              window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.lastRenderAt ?? 0;
            if (renderAt >= inputAt) {
              window.__FORGE_KG_PERF_VISIBLE_AT__ = renderAt;
              return;
            }
            requestAnimationFrame(observeVisibleZoom);
          };
          requestAnimationFrame(observeVisibleZoom);
        });
      } else if (box) {
        await canvas.evaluate((element) => {
          element.addEventListener(
            "wheel",
            () => {
              const inputAt = performance.now();
              window.__FORGE_KG_PERF_INPUT_AT__ = inputAt;
              const observeVisibleZoom = () => {
                const renderAt =
                  window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.lastRenderAt ??
                  0;
                if (renderAt >= inputAt) {
                  window.__FORGE_KG_PERF_VISIBLE_AT__ = renderAt;
                  return;
                }
                requestAnimationFrame(observeVisibleZoom);
              };
              requestAnimationFrame(observeVisibleZoom);
            },
            { capture: true, once: true }
          );
        });
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -480);
      }
      await page.waitForFunction(
        (previous) => {
          const snapshot = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
          const ratio = snapshot?.camera?.ratio;
          return Boolean(
            typeof ratio === "number" &&
            snapshot?.lastRenderAt !== null &&
            (snapshot?.lastRenderAt ?? 0) > previous.lastRenderAt &&
            Math.abs(ratio - previous.ratio) > 0.01
          );
        },
        before,
        { timeout: 20_000 }
      );
      await page.waitForFunction(
        () => typeof window.__FORGE_KG_PERF_VISIBLE_AT__ === "number"
      );
      return page.evaluate(() => window.__FORGE_KG_PERF_VISIBLE_AT__!);
    })
  );
  journeys.push(
    await collectJourney(page, "selection", async () => {
      const beforeRenderAt = await page.evaluate(
        () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.lastRenderAt ?? 0
      );
      await page.evaluate((nodeId) => {
        const inputAt = performance.now();
        window.__FORGE_KG_PERF_INPUT_AT__ = inputAt;
        window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.selectNode(nodeId);
        const observeVisibleFocus = () => {
          const snapshot = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
          if (
            snapshot?.focusNodeId === nodeId &&
            (snapshot.lastRenderAt ?? 0) >= inputAt
          ) {
            window.__FORGE_KG_PERF_VISIBLE_AT__ = snapshot.lastRenderAt!;
            return;
          }
          requestAnimationFrame(observeVisibleFocus);
        };
        requestAnimationFrame(observeVisibleFocus);
      }, targetNodeId);
      await page.waitForFunction(
        ({ nodeId, before }) => {
          const snapshot = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
          return (
            snapshot?.focusNodeId === nodeId &&
            (snapshot.lastRenderAt ?? 0) > before
          );
        },
        { nodeId: targetNodeId, before: beforeRenderAt }
      );
      await page.waitForFunction(
        () => typeof window.__FORGE_KG_PERF_VISIBLE_AT__ === "number"
      );
      return page.evaluate(() => window.__FORGE_KG_PERF_VISIBLE_AT__!);
    })
  );
  await page.evaluate(() => {
    window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.selectNode(null);
  });
  await page.waitForFunction(
    () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.focusNodeId === null
  );
  journeys.push(
    await collectJourney(page, "details-open", async () => {
      const isMobile = await page.evaluate(
        () => window.matchMedia("(max-width: 1023px)").matches
      );
      await page.evaluate((nodeId) => {
        const inputAt = performance.now();
        window.__FORGE_KG_PERF_INPUT_AT__ = inputAt;
        window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.selectNode(nodeId);
        const observeVisibleFocus = () => {
          const snapshot = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
          if (
            snapshot?.focusNodeId === nodeId &&
            (snapshot.lastRenderAt ?? 0) >= inputAt
          ) {
            window.__FORGE_KG_PERF_VISIBLE_AT__ = snapshot.lastRenderAt!;
            return;
          }
          requestAnimationFrame(observeVisibleFocus);
        };
        requestAnimationFrame(observeVisibleFocus);
      }, targetNodeId);
      if (isMobile) {
        await page.waitForFunction(
          (nodeId) =>
            window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId,
          targetNodeId
        );
        await page.evaluate(() => {
          window.__FORGE_KG_PERF_INPUT_AT__ = performance.now();
          delete window.__FORGE_KG_PERF_VISIBLE_AT__;
          window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.activateFocusedNode?.();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              window.__FORGE_KG_PERF_VISIBLE_AT__ = performance.now();
            })
          );
        });
      }
      await expect(
        page.getByRole("button", { name: "Open page" })
      ).toBeVisible();
      await page.waitForFunction(
        () => typeof window.__FORGE_KG_PERF_VISIBLE_AT__ === "number"
      );
      return page.evaluate(() => window.__FORGE_KG_PERF_VISIBLE_AT__!);
    })
  );
  journeys.push(
    await collectJourney(page, "details-return", async () => {
      const isMobile = await page.evaluate(
        () => window.matchMedia("(max-width: 1023px)").matches
      );
      const detailsDialog = page.getByRole("dialog");
      const closeButton = isMobile
        ? detailsDialog.getByRole("button", {
            name: "Close dialog",
            exact: true
          })
        : page.getByRole("button", { name: "Close", exact: true });
      await closeButton.evaluate((element) => {
        element.addEventListener(
          "click",
          () => {
            window.__FORGE_KG_PERF_INPUT_AT__ = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                window.__FORGE_KG_PERF_VISIBLE_AT__ = performance.now();
              })
            );
          },
          { capture: true, once: true }
        );
      });
      await closeButton.click();
      await page.waitForFunction(
        () => typeof window.__FORGE_KG_PERF_VISIBLE_AT__ === "number"
      );
      return page.evaluate(() => window.__FORGE_KG_PERF_VISIBLE_AT__!);
    })
  );
  const returnedFromMobileDetails = await page.evaluate(
    () => window.matchMedia("(max-width: 1023px)").matches
  );
  if (returnedFromMobileDetails) {
    await expect(page.getByRole("dialog")).not.toBeVisible();
  } else {
    await expect(
      page.getByRole("button", { name: "Open page" })
    ).not.toBeVisible();
  }
  await page.evaluate(() => {
    window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.selectNode(null);
  });
  await page.waitForFunction(
    () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.focusNodeId === null
  );
  journeys.push(
    await collectJourney(page, "search", async () => {
      const isMobile = await page.evaluate(
        () => window.matchMedia("(max-width: 1023px)").matches
      );
      if (isMobile) {
        await page.getByRole("button", { name: "Open graph filters" }).click();
        await expect(
          page.getByRole("heading", { name: "Filter graph" })
        ).toBeVisible();
      }
      const searchQuery = fullStack ? `kgperf-${size}` : "benchmark target 3";
      const beforePresentationKey = await page.evaluate(
        () =>
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
            ?.renderedPresentationKey ?? null
      );
      const responsePromise = page.waitForResponse((response) => {
        if (!response.url().includes("/api/v1/knowledge-graph?")) return false;
        return new URL(response.url()).searchParams.get("q") === searchQuery;
      });
      const input = page.getByPlaceholder(
        "Type a graph search, then press Enter or the search button"
      );
      await input.fill(searchQuery);
      await input.evaluate((element) => {
        element.addEventListener(
          "keydown",
          (event) => {
            if ((event as KeyboardEvent).key === "Enter") {
              window.__FORGE_KG_PERF_INPUT_AT__ = performance.now();
            }
          },
          { capture: true, once: true }
        );
      });
      const visibleAtPromise = page
        .waitForFunction(
          ({ expected, before }) => {
            const performanceState =
              window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
            if (
              new URL(window.location.href).searchParams.get("q") !==
                expected ||
              performanceState?.requestedPresentationKey === before ||
              performanceState?.renderedPresentationKey !==
                performanceState?.requestedPresentationKey
            ) {
              return null;
            }
            return performanceState.lastRenderAt ?? null;
          },
          { expected: searchQuery, before: beforePresentationKey }
        )
        .then((handle) => handle.jsonValue());
      await input.press("Enter");
      const visibleAt = await visibleAtPromise;
      await responsePromise;
      await page.waitForFunction(() => {
        const performanceState = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
        return (
          Boolean(performanceState?.requestedPresentationKey) &&
          !performanceState?.requestedPresentationKey.startsWith(
            "optimistic:"
          ) &&
          performanceState?.renderedPresentationKey ===
            performanceState?.requestedPresentationKey
        );
      });
      return visibleAt;
    })
  );
  const resetSearchInput = page.getByPlaceholder(
    "Type a graph search, then press Enter or the search button"
  );
  const resetPresentationKey = await page.evaluate(
    () =>
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.renderedPresentationKey ??
      null
  );
  await resetSearchInput.fill("");
  await resetSearchInput.press("Enter");
  await page.waitForFunction(
    (before) =>
      !new URL(window.location.href).searchParams.has("q") &&
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.requestedPresentationKey !==
        before &&
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.renderedPresentationKey ===
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.requestedPresentationKey,
    resetPresentationKey
  );
  journeys.push(
    await collectJourney(page, "filter-change", async () => {
      const isMobile = await page.evaluate(
        () => window.matchMedia("(max-width: 1023px)").matches
      );
      const showingAll = await page.evaluate(
        () =>
          new URL(window.location.href).searchParams.get("display") === "all"
      );
      const toggle = isMobile
        ? page.getByRole("button", {
            name: showingAll ? "Use calm view" : "Show all types"
          })
        : page.getByRole("button", {
            name: showingAll ? "Calm view" : "All types",
            exact: true
          });
      const beforePresentationKey = await page.evaluate(
        () =>
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
            ?.renderedPresentationKey ?? null
      );
      await toggle.evaluate((element) => {
        element.addEventListener(
          "click",
          () => {
            window.__FORGE_KG_PERF_INPUT_AT__ = performance.now();
          },
          { capture: true, once: true }
        );
      });
      await toggle.click();
      await page.waitForFunction(
        ({ before, expected }) =>
          new URL(window.location.href).searchParams.get("display") ===
            expected &&
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
            ?.requestedPresentationKey !== before &&
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
            ?.renderedPresentationKey ===
            window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
              ?.requestedPresentationKey,
        { before: beforePresentationKey, expected: showingAll ? null : "all" }
      );
      return page.evaluate(
        () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.lastRenderAt!
      );
    })
  );

  const returnIsMobile = await page.evaluate(
    () => window.matchMedia("(max-width: 1023px)").matches
  );
  const returnPresentationKey = await page.evaluate(
    () =>
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.renderedPresentationKey ??
      null
  );
  const returnToCalmView = returnIsMobile
    ? page.getByRole("button", { name: "Use calm view" })
    : page.getByRole("button", { name: "Calm view", exact: true });
  await returnToCalmView.click();
  await page.waitForFunction(
    (before) =>
      !new URL(window.location.href).searchParams.has("display") &&
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.requestedPresentationKey !==
        before &&
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.renderedPresentationKey ===
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.requestedPresentationKey,
    returnPresentationKey
  );
  if (returnIsMobile) {
    const filterDialog = page.getByRole("dialog");
    await filterDialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(filterDialog).not.toBeVisible();
  }
  await page.waitForFunction(
    () => {
      const performanceState =
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
      return (
        typeof performanceState?.initialLayoutSettledAt === "number" &&
        performanceState.renderedSettledGeneration ===
          performanceState.layoutGeneration &&
        performanceState.renderedPresentationKey ===
          performanceState.requestedPresentationKey
      );
    },
    undefined,
    { timeout: size === "large" ? 15_000 : 10_000 }
  );

  const postJourneyGarbageCollected = await collectRetainedHeapGarbage(page);
  const runtime = await page.evaluate(() => ({
    longTasks: window.__FORGE_KG_PERF_COLLECTOR__?.longTasks ?? [],
    heap: (() => {
      const memory = (
        performance as Performance & {
          memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
          };
        }
      ).memory;
      return memory
        ? {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit
          }
        : null;
    })(),
    rendererMode: window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?.rendererMode,
    responsiveState: {
      innerWidth: window.innerWidth,
      mobileMediaMatches: window.matchMedia("(max-width: 1023px)").matches,
      pageIsMobile:
        window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.isMobile ?? null,
      presentationNodeBudget:
        window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.presentationNodeBudget ??
        null,
      presentationNodeCount:
        window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.presentationNodeCount ??
        null
    },
    renderedNodeCount:
      window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?.visibleNodeIds.length ?? 0,
    performanceSnapshot: window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ ?? null,
    layoutDurationMs: (() => {
      const snapshot = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
      return snapshot?.layoutStartedAt !== null &&
        snapshot?.layoutStartedAt !== undefined &&
        snapshot.initialLayoutSettledAt !== null &&
        snapshot.initialLayoutSettledAt !== undefined
        ? snapshot.initialLayoutSettledAt - snapshot.layoutStartedAt
        : null;
    })(),
    graphics: (() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return null;
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: extension
          ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
          : gl.getParameter(gl.VENDOR),
        renderer: extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION)
      };
    })()
  }));
  const postJourneyCdpMetrics = await readCdpPerformanceMetrics(page);
  const retainedHeapGrowth =
    preJourneyHeap && runtime.heap
      ? {
          bytes: runtime.heap.usedJSHeapSize - preJourneyHeap.usedJSHeapSize,
          percent:
            ((runtime.heap.usedJSHeapSize - preJourneyHeap.usedJSHeapSize) /
              Math.max(preJourneyHeap.usedJSHeapSize, 1)) *
            100
        }
      : null;
  return {
    size,
    expected: PERFORMANCE_GRAPH_SIZES[size],
    loadError: null,
    firstUsefulGraphMs,
    idleRefresh: {
      visibilityState: idleSample.visibilityState,
      medianMs: idleMedianMs,
      p95Ms: idleP95Ms,
      rejected: refreshRejected
    },
    requestTimings,
    fullStackResponseCounts,
    fullStackResponseDistribution,
    fullStackResponseIdentityHash,
    retainedHeapMeasurement: {
      preJourneyGarbageCollected,
      postJourneyGarbageCollected
    },
    preJourneyHeap,
    retainedHeapGrowth,
    preJourneyCdpMetrics,
    postJourneyCdpMetrics,
    benchmarkLayer: fullStack ? "full-stack" : "renderer-only",
    journeys,
    ...runtime
  };
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!resultRoot, "Run with FORGE_KG_PERF_RESULT_DIR set.");
  await installE2eStorageGuards(page, testInfo.testId);
  await installCollector(page);
});

test("records deterministic Knowledge Graph performance", async ({
  browser,
  context,
  page
}, testInfo) => {
  test.setTimeout(20 * 60_000);
  expect(Number.isInteger(repetitions) && repetitions >= 1).toBe(true);
  expect(configuredSizes.length).toBeGreaterThan(0);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  const tracePath = path.join(projectRoot, "condition-trace.zip");
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true
  });
  const measured: Array<Record<string, unknown>> = [];
  for (const size of configuredSizes) {
    await runFixtureJourney(page, size); // discarded warm-up
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      measured.push({
        repetition,
        ...(await runFixtureJourney(page, size))
      });
    }
  }
  if (fullStack) {
    for (const size of configuredSizes) {
      const identityHashes = measured
        .filter((run) => run.size === size)
        .map((run) => run.fullStackResponseIdentityHash);
      expect(identityHashes).toHaveLength(repetitions);
      expect(new Set(identityHashes).size).toBe(1);
    }
  }
  for (const run of measured) {
    expect(run.loadError).toBeNull();
    expect(
      (run.idleRefresh as { rejected?: boolean } | undefined)?.rejected
    ).toBe(false);
  }
  await context.tracing.stop({ path: tracePath });
  const result = {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    project: testInfo.project.name,
    browser: {
      name: testInfo.project.use.browserName ?? "chromium",
      version: browser.version()
    },
    viewport: testInfo.project.use.viewport,
    repetitions,
    positionMode,
    adaptiveMode,
    requireSigma,
    benchmarkLayer: fullStack ? "full-stack" : "renderer-only",
    tracePath,
    hardware: {
      platform: process.platform,
      architecture: process.arch,
      cpuCount: (await import("node:os")).cpus().length
    },
    summary: summarizeRuns(measured),
    measured
  };
  await writeFile(
    path.join(projectRoot, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
});
