import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  buildVisualStoryGraphFixture,
  type PerformanceGraphSize,
  VISUAL_STORY_FIXTURE_VERSION
} from "./knowledge-graph-performance-fixture";
import { installE2eStorageGuards, waitForForge } from "./helpers";

const resultRoot = process.env.FORGE_KG_VISUAL_RESULT_DIR?.trim();

type ResponseMode = "normal" | "empty" | "fail" | "delayed";

type VisualRouteController = {
  setSize: (size: PerformanceGraphSize) => void;
  setMode: (mode: ResponseMode) => void;
  releaseDelayedResponse: () => void;
};

declare global {
  interface Window {
    __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean;
    __FORGE_KG_ADAPTIVE_MODE__?: "off" | "on";
    __FORGE_KG_FORCE_FALLBACK__?: boolean;
    __FORGE_KG_VISUAL_ERRORS__?: string[];
    __FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?: {
      focusNodeId: string | null;
      presentationNodeCount: number;
      explorationAnchorNodeIds: string[];
      selectNodeById?: (nodeId: string | null) => void;
      activateFocusedNode?: () => void;
      refetchGraph?: () => void;
    };
    __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: {
      rendererMode: "sigma" | "fallback";
      camera: { x: number; y: number; ratio: number; angle: number };
      nodeScreenPositions: Record<
        string,
        { x: number; y: number; size: number }
      >;
    };
    __FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?: {
      retainedNodeCount: number;
      retainedEdgeCount: number;
      renderedNodeCount: number;
      renderedNodeIds: string[];
      forcedLabelNodeIds: string[];
      displayedLabelNodeIds: string[];
      renderedEdgeCount: number;
      adaptiveQuality: string;
      reducedMotion: boolean;
      requestedPresentationKey: string;
      renderedPresentationKey: string | null;
      layoutStartedAt: number | null;
      initialLayoutSettledAt: number | null;
      stableLayoutAt: number | null;
      settledFocusNodeId: string | null;
      focusSettledAt: number | null;
      layoutGeneration: number;
      committedPositionTick: number | null;
      workerSettledGeneration: number | null;
      workerSettledTick: number | null;
      renderedSettledGeneration: number | null;
      renderedSettledTick: number | null;
      renderedSettledFocusNodeId: string | null;
      focusCameraSettledNodeId: string | null;
      lastCameraAnimationDurationMs: number | null;
      focusNodeId: string | null;
    };
  }
}

function payloadHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function filterFixture(
  fixture: ReturnType<typeof buildVisualStoryGraphFixture>,
  query: string
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return fixture;
  const nodes = fixture.nodes.filter((node) =>
    `${node.title} ${node.subtitle} ${node.description} ${node.searchText ?? ""}`
      .toLowerCase()
      .includes(normalized)
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
}

function emptyFixture(
  fixture: ReturnType<typeof buildVisualStoryGraphFixture>
) {
  return {
    ...fixture,
    nodes: [],
    edges: [],
    facets: {
      ...fixture.facets,
      entityKinds: fixture.facets.entityKinds.map((entry) => ({
        ...entry,
        count: 0
      })),
      relationKinds: fixture.facets.relationKinds.map((entry) => ({
        ...entry,
        count: 0
      }))
    },
    counts: {
      ...fixture.counts,
      nodeCount: 0,
      edgeCount: 0,
      totalNodeCount: 0,
      totalEdgeCount: 0,
      filteredNodeCount: 0,
      filteredEdgeCount: 0,
      kinds: {},
      relationKinds: {},
      limited: false
    }
  };
}

async function installVisualGraphRoute(
  page: Page
): Promise<VisualRouteController> {
  let size: PerformanceGraphSize = "medium";
  let mode: ResponseMode = "normal";
  let releaseDelayed: (() => void) | null = null;
  let delayedGate = new Promise<void>((resolve) => {
    releaseDelayed = resolve;
  });

  await page.route("**/api/v1/knowledge-graph**", async (route) => {
    const fixture = buildVisualStoryGraphFixture(size);
    const url = new URL(route.request().url());
    if (mode === "fail") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Visual fixture refresh failed" }
        })
      });
      return;
    }
    if (mode === "delayed") await delayedGate;
    if (url.pathname.endsWith("/focus")) {
      const focusId = url.searchParams.get("entityId");
      const focusNode =
        fixture.nodes.find((node) => node.entityId === focusId) ??
        fixture.nodes[0]!;
      const neighborhoodEdges = fixture.edges.filter(
        (edge) => edge.source === focusNode.id || edge.target === focusNode.id
      );
      const neighborIds = new Set(
        neighborhoodEdges.flatMap((edge) => [edge.source, edge.target])
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          focus: {
            generatedAt: fixture.generatedAt,
            focusNode,
            firstRingNodes: fixture.nodes.filter((node) =>
              neighborIds.has(node.id)
            ),
            neighborhoodEdges,
            familyGroups: [],
            relationCounts: {
              structural: neighborhoodEdges.filter(
                (edge) => edge.family === "structural"
              ).length,
              contextual: neighborhoodEdges.filter(
                (edge) => edge.family === "contextual"
              ).length,
              taxonomy: neighborhoodEdges.filter(
                (edge) => edge.family === "taxonomy"
              ).length,
              workspace: neighborhoodEdges.filter(
                (edge) => edge.family === "workspace"
              ).length
            },
            secondRingCounts: {
              structural: 0,
              contextual: 0,
              taxonomy: 0,
              workspace: 0
            }
          }
        })
      });
      return;
    }
    const graph =
      mode === "empty"
        ? emptyFixture(fixture)
        : filterFixture(fixture, url.searchParams.get("q") ?? "");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ graph })
    });
  });

  return {
    setSize(nextSize) {
      size = nextSize;
    },
    setMode(nextMode) {
      mode = nextMode;
      if (nextMode === "delayed") {
        delayedGate = new Promise<void>((resolve) => {
          releaseDelayed = resolve;
        });
      }
    },
    releaseDelayedResponse() {
      releaseDelayed?.();
    }
  };
}

function circleIntersectionArea(
  leftRadius: number,
  rightRadius: number,
  distance: number
) {
  if (distance >= leftRadius + rightRadius) return 0;
  if (distance <= Math.abs(leftRadius - rightRadius)) {
    return Math.PI * Math.min(leftRadius, rightRadius) ** 2;
  }
  const leftAngle = Math.acos(
    (distance ** 2 + leftRadius ** 2 - rightRadius ** 2) /
      (2 * distance * leftRadius)
  );
  const rightAngle = Math.acos(
    (distance ** 2 + rightRadius ** 2 - leftRadius ** 2) /
      (2 * distance * rightRadius)
  );
  const triangle =
    0.5 *
    Math.sqrt(
      Math.max(
        0,
        (-distance + leftRadius + rightRadius) *
          (distance + leftRadius - rightRadius) *
          (distance - leftRadius + rightRadius) *
          (distance + leftRadius + rightRadius)
      )
    );
  return leftRadius ** 2 * leftAngle + rightRadius ** 2 * rightAngle - triangle;
}

function measureGeometry({
  positions,
  renderedNodeIds,
  availableNodeIds,
  protectedNodeIds,
  width,
  height
}: {
  positions: Record<string, { x: number; y: number; size: number }>;
  renderedNodeIds: string[];
  availableNodeIds: string[];
  protectedNodeIds: string[];
  width: number;
  height: number;
}) {
  const protectedIds = new Set(protectedNodeIds);
  const nodes = renderedNodeIds
    .map((id) => ({ id, ...positions[id]! }))
    .filter(
      (node) =>
        node &&
        node.x + node.size >= 0 &&
        node.x - node.size <= width &&
        node.y + node.size >= 0 &&
        node.y - node.size <= height
    );
  let overlapCount = 0;
  let protectedOverlapCount = 0;
  let overlapArea = 0;
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < nodes.length;
      rightIndex += 1
    ) {
      const right = nodes[rightIndex]!;
      const distance = Math.hypot(right.x - left.x, right.y - left.y);
      if (distance >= left.size + right.size + 2) continue;
      overlapCount += 1;
      if (protectedIds.has(left.id) || protectedIds.has(right.id)) {
        protectedOverlapCount += 1;
      }
      overlapArea += circleIntersectionArea(left.size, right.size, distance);
    }
  }
  const totalNodeArea = nodes.reduce(
    (total, node) => total + Math.PI * node.size ** 2,
    0
  );
  return {
    measuredNodeCount: nodes.length,
    missingRenderedProtectedNodeIds: protectedNodeIds.filter(
      (nodeId) => !renderedNodeIds.includes(nodeId)
    ),
    missingProtectedNodeIds: protectedNodeIds.filter(
      (nodeId) => !availableNodeIds.includes(nodeId)
    ),
    overlapCount,
    protectedOverlapCount,
    overlapAreaPx2: Number(overlapArea.toFixed(4)),
    totalNodeAreaPx2: Number(totalNodeArea.toFixed(4)),
    overlapAreaRatio: Number(
      (totalNodeArea > 0 ? overlapArea / totalNodeArea : 0).toFixed(6)
    )
  };
}

async function waitForVisualGraph(page: Page) {
  await waitForForge(page);
  try {
    await page.waitForFunction(
      () =>
        typeof window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
          ?.initialLayoutSettledAt === "number" &&
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
          ?.workerSettledGeneration ===
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.layoutGeneration &&
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
          ?.renderedSettledGeneration ===
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.layoutGeneration &&
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.renderedSettledTick ===
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.workerSettledTick &&
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.committedPositionTick ===
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.workerSettledTick &&
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
          ?.renderedSettledFocusNodeId === null &&
        window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
          ?.renderedPresentationKey ===
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
            ?.requestedPresentationKey,
      undefined,
      { timeout: 20_000 }
    );
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      performance: window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ ?? null,
      errors: window.__FORGE_KG_VISUAL_ERRORS__ ?? []
    }));
    throw new Error(
      `Visual graph did not settle: ${JSON.stringify(snapshot)}`,
      { cause: error }
    );
  }
}

async function waitForFocusedVisualGraph(page: Page, focusNodeId: string) {
  await page.waitForFunction(
    (nodeId) => {
      const snapshot = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__;
      return (
        snapshot?.focusNodeId === nodeId &&
        snapshot.settledFocusNodeId === nodeId &&
        typeof snapshot.focusSettledAt === "number" &&
        typeof snapshot.initialLayoutSettledAt === "number" &&
        snapshot.workerSettledGeneration === snapshot.layoutGeneration &&
        snapshot.renderedSettledGeneration === snapshot.layoutGeneration &&
        snapshot.renderedSettledTick === snapshot.workerSettledTick &&
        snapshot.committedPositionTick === snapshot.workerSettledTick &&
        snapshot.renderedSettledFocusNodeId === nodeId &&
        snapshot.focusCameraSettledNodeId === nodeId &&
        snapshot.renderedPresentationKey === snapshot.requestedPresentationKey
      );
    },
    focusNodeId,
    { timeout: 20_000 }
  );
}

async function captureState({
  page,
  projectRoot,
  name,
  fixtureSize,
  protectedNodeIds = []
}: {
  page: Page;
  projectRoot: string;
  name: string;
  fixtureSize: PerformanceGraphSize;
  protectedNodeIds?: string[];
}) {
  const screenshotPath = path.join(projectRoot, `${name}-screenshot.png`);
  const screenshot = await page.screenshot({ path: screenshotPath });
  const accessibility = await page.locator("body").ariaSnapshot();
  const browserState = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
    performance: window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__ ?? null,
    diagnostics: window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__ ?? null,
    page: window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__ ?? null,
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth
  }));
  const geometry =
    browserState.performance && browserState.diagnostics
      ? measureGeometry({
          positions: browserState.diagnostics.nodeScreenPositions,
          renderedNodeIds: browserState.performance.renderedNodeIds,
          availableNodeIds: [
            ...browserState.performance.renderedNodeIds,
            ...(browserState.page?.explorationAnchorNodeIds ?? [])
          ],
          protectedNodeIds,
          width: browserState.viewport.width,
          height: browserState.viewport.height
        })
      : null;
  const fixture = buildVisualStoryGraphFixture(fixtureSize);
  const protectedLabels = Object.fromEntries(
    fixture.nodes
      .filter((node) => protectedNodeIds.includes(node.id))
      .map((node) => [node.id, node.title])
  );
  const accessibleProtectedLabelIds = await page.evaluate((labels) => {
    const visibleExactText = (title: string) =>
      [...document.querySelectorAll("body *")].some((element) => {
        if (
          element.children.length > 0 ||
          element.textContent?.trim() !== title
        ) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      });
    return Object.entries(labels)
      .filter(([, title]) => visibleExactText(title))
      .map(([nodeId]) => nodeId);
  }, protectedLabels);
  const displayedLabelNodeIds = new Set(
    browserState.performance?.displayedLabelNodeIds ?? []
  );
  const accessibleLabelIds = new Set(accessibleProtectedLabelIds);
  const protectedLabelSuppliers = Object.fromEntries(
    protectedNodeIds.map((nodeId) => [
      nodeId,
      [
        ...(displayedLabelNodeIds.has(nodeId) ? ["canvas-displayed"] : []),
        ...(accessibleLabelIds.has(nodeId) ? ["accessible-context"] : [])
      ]
    ])
  );
  const protectedMissingLabelIds = protectedNodeIds.filter(
    (nodeId) => protectedLabelSuppliers[nodeId]?.length === 0
  );
  const receipt = {
    schemaVersion: 1,
    name,
    fixtureVersion: VISUAL_STORY_FIXTURE_VERSION,
    fixtureSize,
    fixturePayloadHash: payloadHash(fixture),
    capturedAt: new Date().toISOString(),
    screenshotPath,
    screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
    protectedNodeIds,
    protectedLabels,
    protectedLabelSuppliers,
    protectedMissingLabelIds,
    geometry,
    browserState
  };
  await writeFile(
    path.join(projectRoot, `${name}-diagnostics.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, `${name}-accessibility.txt`),
    `${accessibility}\n`,
    "utf8"
  );
  return receipt;
}

async function navigateFixture(
  page: Page,
  size: PerformanceGraphSize,
  extra: Record<string, string> = {}
) {
  const query = new URLSearchParams({
    limit: "2000",
    graphDiagnostics: "1",
    visualFixture: VISUAL_STORY_FIXTURE_VERSION,
    size,
    ...extra
  });
  await page.goto(`knowledge-graph?${query.toString()}`, {
    waitUntil: "domcontentloaded"
  });
}

test.use({ trace: "off" });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!resultRoot, "Run with FORGE_KG_VISUAL_RESULT_DIR set.");
  await installE2eStorageGuards(page, testInfo.testId);
  await page.addInitScript(() => {
    window.__FORGE_KG_VISUAL_ERRORS__ = [];
    window.addEventListener("error", (event) => {
      window.__FORGE_KG_VISUAL_ERRORS__?.push(
        event.error instanceof Error
          ? `${event.error.name}: ${event.error.message}`
          : event.message
      );
    });
    window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
    window.__FORGE_KG_ADAPTIVE_MODE__ = "off";
  });
});

test("captures the governed Knowledge Graph visual states", async ({
  page
}, testInfo) => {
  test.setTimeout(4 * 60_000);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  const controller = await installVisualGraphRoute(page);
  const receipts: unknown[] = [];

  for (const size of ["small", "medium", "large"] as const) {
    controller.setSize(size);
    controller.setMode("normal");
    await navigateFixture(page, size);
    await waitForVisualGraph(page);
    receipts.push(
      await captureState({
        page,
        projectRoot,
        name: `${size}-overview`,
        fixtureSize: size
      })
    );
  }

  controller.setSize("large");
  await navigateFixture(page, "large", { display: "all" });
  await waitForVisualGraph(page);
  receipts.push(
    await captureState({
      page,
      projectRoot,
      name: "large-dense-all-types",
      fixtureSize: "large"
    })
  );

  controller.setSize("medium");
  await navigateFixture(page, "medium");
  await waitForVisualGraph(page);
  const rootId = "goal:medium-goal-0000";
  await page.evaluate((nodeId) => {
    window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.selectNodeById?.(nodeId);
  }, rootId);
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId &&
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.focusNodeId === nodeId,
    rootId
  );
  await waitForFocusedVisualGraph(page, rootId);
  await expect(
    page.getByRole("button", { name: "Back to overview" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reflow", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Show every shown-node link|All shown links/
    })
  ).toBeVisible();
  const localContextIds = [
    rootId,
    "project:medium-project-0001",
    "task:medium-task-0002",
    "strategy:medium-strategy-0003",
    "psyche_value:medium-value-0015"
  ];
  receipts.push(
    await captureState({
      page,
      projectRoot,
      name: "medium-local-context",
      fixtureSize: "medium",
      protectedNodeIds: localContextIds
    })
  );

  for (const [name, nodeId] of [
    ["medium-branch-project", "project:medium-project-0001"],
    ["medium-branch-task", "task:medium-task-0002"],
    ["medium-branch-return", rootId]
  ] as const) {
    await page.evaluate((id) => {
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.selectNodeById?.(id);
    }, nodeId);
    await page.waitForFunction(
      (id) => window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === id,
      nodeId
    );
    await waitForFocusedVisualGraph(page, nodeId);
    receipts.push(
      await captureState({
        page,
        projectRoot,
        name,
        fixtureSize: "medium",
        protectedNodeIds: localContextIds
      })
    );
  }

  await page.getByRole("button", { name: "Back to overview" }).click();
  await page.waitForFunction(
    () => window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === null
  );
  await waitForVisualGraph(page);
  receipts.push(
    await captureState({
      page,
      projectRoot,
      name: "medium-returned-overview",
      fixtureSize: "medium"
    })
  );

  controller.setMode("normal");
  await navigateFixture(page, "medium", { q: "definitely-no-match-kg" });
  await expect(
    page.getByRole("heading", { name: "No knowledge matches this view" })
  ).toBeVisible();
  receipts.push(
    await captureState({
      page,
      projectRoot,
      name: "medium-no-match",
      fixtureSize: "medium"
    })
  );

  controller.setMode("empty");
  await navigateFixture(page, "medium", { empty: "1" });
  await expect(
    page.getByRole("heading", { name: "Your knowledge graph is ready to grow" })
  ).toBeVisible();
  receipts.push(
    await captureState({
      page,
      projectRoot,
      name: "medium-empty",
      fixtureSize: "medium"
    })
  );

  await writeFile(
    path.join(projectRoot, "visual-state-index.json"),
    `${JSON.stringify(receipts, null, 2)}\n`,
    "utf8"
  );
});

test("captures the collapsed and virtualized hierarchy without toolbar overlap", async ({
  page
}, testInfo) => {
  test.setTimeout(90_000);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  const controller = await installVisualGraphRoute(page);
  controller.setSize("large");
  await navigateFixture(page, "large", {
    view: "hierarchy",
    display: "all"
  });
  await waitForForge(page);

  const hierarchy = page.getByRole("region", { name: "Knowledge hierarchy" });
  await expect(hierarchy).toBeVisible();
  const readFlowControlIntersectionCount = () =>
    hierarchy.evaluate((region) => {
      const controls = region.querySelector<HTMLElement>(
        ".knowledge-graph-hierarchy-controls"
      );
      if (!controls) return -1;
      const controlsBox = controls.getBoundingClientRect();
      const flowBox = region
        .querySelector<HTMLElement>(".knowledge-graph-hierarchy-flow")
        ?.getBoundingClientRect();
      return Array.from(
        region.querySelectorAll<HTMLElement>(
          ".react-flow__node, :scope > div:first-child button"
        )
      ).filter((element) => {
        const rawBox = element.getBoundingClientRect();
        const isFlowNode = element.classList.contains("react-flow__node");
        const box =
          isFlowNode && flowBox
            ? {
                left: Math.max(rawBox.left, flowBox.left),
                right: Math.min(rawBox.right, flowBox.right),
                top: Math.max(rawBox.top, flowBox.top),
                bottom: Math.min(rawBox.bottom, flowBox.bottom)
              }
            : rawBox;
        if (box.right <= box.left || box.bottom <= box.top) return false;
        return !(
          controlsBox.right <= box.left + 1 ||
          box.right <= controlsBox.left + 1 ||
          controlsBox.bottom <= box.top + 1 ||
          box.bottom <= controlsBox.top + 1
        );
      }).length;
    });
  const readBottomOccluderTop = () =>
    page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>("body *")
      )
        .filter((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return (
            style.position === "fixed" &&
            box.bottom >= window.innerHeight - 1 &&
            box.width >= window.innerWidth * 0.75 &&
            box.height >= 48
          );
        })
        .map((element) => element.getBoundingClientRect().top);
      return Math.min(window.innerHeight, ...candidates);
    });
  await expect(page.getByText("2500 knowledge items available")).toBeVisible();
  const collapsedRenderedDomNodes = await hierarchy
    .locator(".react-flow__node")
    .count();
  expect(collapsedRenderedDomNodes).toBeGreaterThan(0);
  expect(collapsedRenderedDomNodes).toBeLessThanOrEqual(6);
  expect(await hierarchy.locator(".react-flow__edge").count()).toBe(0);
  expect(await readFlowControlIntersectionCount()).toBe(0);

  const topControlBox = await (
    testInfo.project.name === "pixel-7"
      ? page.getByRole("button", { name: "Open graph filters" })
      : page.getByPlaceholder(
          "Type a graph search, then press Enter or the search button"
        )
  ).boundingBox();
  const hierarchyToolbar = await hierarchy
    .locator(":scope > div")
    .first()
    .boundingBox();
  expect(topControlBox).toBeTruthy();
  expect(hierarchyToolbar).toBeTruthy();
  expect(topControlBox!.y + topControlBox!.height).toBeLessThanOrEqual(
    hierarchyToolbar!.y
  );
  await page.screenshot({
    path: path.join(projectRoot, "large-hierarchy-collapsed.png"),
    fullPage: false
  });

  const collapsedDirectionControl = page.getByRole("button", {
    name: /Direction, \d+ items, collapsed/
  });
  await collapsedDirectionControl.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel(/Direction, \d+ items, expanded/)).toBeVisible();
  const collapsedGroupExpandedWithEnter = await page
    .getByLabel(/Direction, \d+ items, expanded/)
    .isVisible();
  const oneLaneCardMetrics = await hierarchy
    .locator('.react-flow__node:not([data-id^="lane:"])')
    .evaluateAll((elements) => {
      const visible = elements
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);
      return {
        count: visible.length,
        minimumWidthPx: Math.min(...visible.map((box) => box.width)),
        minimumHeightPx: Math.min(...visible.map((box) => box.height))
      };
    });
  expect(oneLaneCardMetrics.count).toBeGreaterThan(0);
  expect(oneLaneCardMetrics.minimumWidthPx).toBeGreaterThanOrEqual(
    testInfo.project.name === "pixel-7" ? 210 : 180
  );
  expect(oneLaneCardMetrics.minimumHeightPx).toBeGreaterThanOrEqual(70);
  const oneLaneOpenTarget = await hierarchy
    .getByRole("button", { name: /^Open .+ in Forge$/ })
    .first()
    .boundingBox();
  expect(oneLaneOpenTarget).toBeTruthy();
  expect(oneLaneOpenTarget!.width).toBeGreaterThanOrEqual(44);
  expect(oneLaneOpenTarget!.height).toBeGreaterThanOrEqual(44);
  const oneLaneCanvasBox = await hierarchy
    .locator(".knowledge-graph-canvas")
    .boundingBox();
  expect(oneLaneCanvasBox).toBeTruthy();
  expect(oneLaneOpenTarget!.y).toBeGreaterThanOrEqual(oneLaneCanvasBox!.y);
  expect(oneLaneOpenTarget!.y + oneLaneOpenTarget!.height).toBeLessThanOrEqual(
    Math.min(
      oneLaneCanvasBox!.y + oneLaneCanvasBox!.height,
      await readBottomOccluderTop()
    )
  );
  expect(await readFlowControlIntersectionCount()).toBe(0);
  await page.screenshot({
    path: path.join(projectRoot, "large-hierarchy-one-lane.png"),
    fullPage: false
  });

  const expandAllLatenciesMs: number[] = [];
  for (let repetition = 0; repetition < 5; repetition += 1) {
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(
      page.getByText("2500 knowledge items available")
    ).toBeVisible();
    await expect
      .poll(async () => hierarchy.locator(".react-flow__node").count())
      .toBeLessThanOrEqual(6);
    expect(
      await hierarchy.locator(".react-flow__node").count()
    ).toBeGreaterThan(0);
    const startedAt = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(
      page.getByText("2500 of 2500 knowledge items shown")
    ).toBeVisible();
    await expect
      .poll(async () => hierarchy.locator(".react-flow__node").count())
      .toBeGreaterThan(6);
    expandAllLatenciesMs.push(
      (await page.evaluate(() => performance.now())) - startedAt
    );
  }
  await expect
    .poll(async () => hierarchy.locator(".react-flow__node").count())
    .toBeLessThan(500);
  const expandedViewportScale = await hierarchy
    .locator(".react-flow__viewport")
    .evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a
    );
  const readableExpandedCards = await hierarchy
    .locator('.react-flow__node:not([data-id^="lane:"])')
    .evaluateAll(
      (elements) =>
        elements.filter(
          (element) => element.getBoundingClientRect().width >= 90
        ).length
    );
  expect(expandedViewportScale).toBeGreaterThanOrEqual(0.3);
  expect(readableExpandedCards).toBeGreaterThan(0);

  const frameSamplePromise = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const intervals: number[] = [];
        let previous = performance.now();
        const finishAt = previous + 1_200;
        const sample = (now: number) => {
          intervals.push(now - previous);
          previous = now;
          if (now >= finishAt) resolve(intervals.slice(1));
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
  );
  const hierarchyCanvas = await hierarchy
    .locator(".knowledge-graph-canvas")
    .boundingBox();
  expect(hierarchyCanvas).toBeTruthy();
  await page.mouse.move(
    hierarchyCanvas!.x + hierarchyCanvas!.width / 2,
    hierarchyCanvas!.y + hierarchyCanvas!.height / 2
  );
  for (let step = 0; step < 5; step += 1) {
    await page.mouse.wheel(0, step % 2 === 0 ? -180 : 140);
  }
  const hierarchyFrameIntervalsMs = await frameSamplePromise;
  const sortedHierarchyFrameIntervalsMs = [...hierarchyFrameIntervalsMs].sort(
    (left, right) => left - right
  );
  const hierarchyFrameP95Ms =
    sortedHierarchyFrameIntervalsMs[
      Math.min(
        sortedHierarchyFrameIntervalsMs.length - 1,
        Math.floor(sortedHierarchyFrameIntervalsMs.length * 0.95)
      )
    ] ?? 0;
  const hierarchyFramesWithin25MsPercent =
    (hierarchyFrameIntervalsMs.filter((interval) => interval <= 25).length /
      Math.max(1, hierarchyFrameIntervalsMs.length)) *
    100;
  expect(hierarchyFrameP95Ms).toBeLessThanOrEqual(25);
  expect(hierarchyFramesWithin25MsPercent).toBeGreaterThanOrEqual(95);

  const sideHandleEvidence = await page.evaluate(() => {
    const handles = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[aria-label="Knowledge hierarchy"] .react-flow__node .react-flow__handle-left, [aria-label="Knowledge hierarchy"] .react-flow__node .react-flow__handle-right'
      )
    );
    return handles.slice(0, 40).map((handle) => {
      const node = handle.closest<HTMLElement>(".react-flow__node")!;
      const handleBox = handle.getBoundingClientRect();
      const nodeBox = node.getBoundingClientRect();
      const side = handle.classList.contains("react-flow__handle-left")
        ? "left"
        : "right";
      const expectedX = side === "left" ? nodeBox.left : nodeBox.right;
      return {
        side,
        horizontalErrorPx: Math.abs(
          handleBox.left + handleBox.width / 2 - expectedX
        ),
        verticalOffsetRatio:
          Math.abs(
            handleBox.top +
              handleBox.height / 2 -
              (nodeBox.top + nodeBox.height / 2)
          ) / Math.max(1, nodeBox.height)
      };
    });
  });
  expect(sideHandleEvidence.length).toBeGreaterThan(0);
  expect(
    Math.max(...sideHandleEvidence.map((entry) => entry.horizontalErrorPx))
  ).toBeLessThan(4);
  expect(
    Math.max(...sideHandleEvidence.map((entry) => entry.verticalOffsetRatio))
  ).toBeLessThan(0.08);

  const accessibility = await new AxeBuilder({ page })
    .include('[aria-label="Knowledge hierarchy"]')
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? "")
    )
  ).toEqual([]);
  const flowControlsBox = await hierarchy
    .locator(".knowledge-graph-hierarchy-controls")
    .boundingBox();
  const viewSwitchBox = await page
    .getByRole("button", { name: "Hierarchy", exact: true })
    .locator("..")
    .boundingBox();
  expect(flowControlsBox).toBeTruthy();
  expect(viewSwitchBox).toBeTruthy();
  const flowControlTheme = await hierarchy
    .locator(".knowledge-graph-hierarchy-control-button")
    .first()
    .evaluate((button) => {
      const buttonStyle = getComputedStyle(button);
      const tokenProbe = document.createElement("span");
      tokenProbe.style.backgroundColor = "var(--ui-surface-1)";
      tokenProbe.style.color = "var(--ui-ink-medium)";
      button.append(tokenProbe);
      const tokenProbeStyle = getComputedStyle(tokenProbe);
      const expectedBackground = tokenProbeStyle.backgroundColor;
      const expectedColor = tokenProbeStyle.color;
      tokenProbe.remove();
      const icon = button.querySelector("svg");
      const attribution = document.querySelector<HTMLElement>(
        ".knowledge-graph-hierarchy-flow .react-flow__attribution"
      );
      const attributionLink = attribution?.querySelector("a");
      return {
        background: buttonStyle.backgroundColor,
        expectedBackground,
        color: buttonStyle.color,
        expectedColor,
        iconStroke: icon ? getComputedStyle(icon).stroke : null,
        attributionColor: attribution
          ? getComputedStyle(attribution).color
          : null,
        attributionLinkColor: attributionLink
          ? getComputedStyle(attributionLink).color
          : null
      };
    });
  expect(flowControlTheme.background).toBe(flowControlTheme.expectedBackground);
  expect(flowControlTheme.color).toBe(flowControlTheme.expectedColor);
  expect(flowControlTheme.iconStroke).toBe(flowControlTheme.color);
  expect(flowControlTheme.attributionLinkColor).toBe(
    flowControlTheme.attributionColor
  );
  const flowControlsOverlapViewSwitch = !(
    flowControlsBox!.x + flowControlsBox!.width <= viewSwitchBox!.x ||
    viewSwitchBox!.x + viewSwitchBox!.width <= flowControlsBox!.x ||
    flowControlsBox!.y + flowControlsBox!.height <= viewSwitchBox!.y ||
    viewSwitchBox!.y + viewSwitchBox!.height <= flowControlsBox!.y
  );
  expect(flowControlsOverlapViewSwitch).toBe(false);
  expect(await readFlowControlIntersectionCount()).toBe(0);
  await page.screenshot({
    path: path.join(projectRoot, "large-hierarchy-expanded-virtualized.png"),
    fullPage: false
  });
  controller.setSize("medium");
  const mediumFixture = buildVisualStoryGraphFixture("medium");
  const focusedNodeId = "goal:medium-goal-0000";
  const focusedNodeTitle = mediumFixture.nodes.find(
    (node) => node.id === focusedNodeId
  )!.title;
  const expectedFocusPanelLinkedItemIds = new Set(
    mediumFixture.edges.flatMap((edge) => {
      if (edge.source === focusedNodeId) return [edge.target];
      if (edge.target === focusedNodeId) return [edge.source];
      return [];
    })
  );
  const expectedFocusedChildIds = [
    "project:medium-project-0001",
    "task:medium-task-0002"
  ];
  const expectedFocusedEdgeIds = [
    "fixture:medium:story:goal-project",
    "fixture:medium:story:goal-task",
    "fixture:medium:story:project-task"
  ];
  await navigateFixture(page, "medium", {
    view: "hierarchy",
    display: "all",
    focus: focusedNodeId
  });
  await waitForForge(page);
  const visibleFocusPanelLinkedItemIds = await page.evaluate(() =>
    [
      ...new Set(
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-focus-item-id]")
        )
          .filter((item) => {
            const box = item.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          })
          .map((item) => item.dataset.focusItemId!)
      )
    ].sort()
  );
  await expect(page.getByText("Selected hierarchy")).toBeVisible();
  await expect(
    hierarchy.getByText(focusedNodeTitle, { exact: true }).first()
  ).toBeVisible();
  const focusedStructuralChildCountLabel =
    page.getByText(/\d+ direct children/);
  await expect(focusedStructuralChildCountLabel).toBeVisible();
  const focusedStructuralChildCount = Number(
    (await focusedStructuralChildCountLabel.textContent())?.match(/\d+/)?.[0] ??
      0
  );
  expect(focusedStructuralChildCount).toBe(expectedFocusedChildIds.length);
  if (visibleFocusPanelLinkedItemIds.length > 0) {
    expect(visibleFocusPanelLinkedItemIds).toEqual(
      [...expectedFocusPanelLinkedItemIds].sort()
    );
  }
  await expect(
    page.getByText(
      new RegExp(`${expectedFocusPanelLinkedItemIds.size} unique linked item`)
    )
  ).toBeVisible();
  const focusedHierarchyNode = hierarchy.locator(
    `.react-flow__node[data-id="${focusedNodeId}"]`
  );
  await expect(focusedHierarchyNode).toBeVisible();
  const focusedHierarchyBox = await focusedHierarchyNode.boundingBox();
  const renderedEntityTopValues = await hierarchy
    .locator('.react-flow__node:not([data-id^="lane:"])')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top)
    );
  expect(focusedHierarchyBox).toBeTruthy();
  expect(focusedHierarchyBox!.y).toBeLessThanOrEqual(
    Math.min(...renderedEntityTopValues) + 1
  );
  const focusedViewportEvidence = await hierarchy.evaluate((region, nodeId) => {
    const canvas = region.querySelector<HTMLElement>(
      ".knowledge-graph-canvas"
    )!;
    const canvasBox = canvas.getBoundingClientRect();
    const renderedNodes = Array.from(
      region.querySelectorAll<HTMLElement>(
        '.react-flow__node:not([data-id^="lane:"])'
      )
    );
    const visibleNodes = renderedNodes.filter((element) => {
      const box = element.getBoundingClientRect();
      return (
        box.right > canvasBox.left &&
        box.left < canvasBox.right &&
        box.bottom > canvasBox.top &&
        box.top < canvasBox.bottom &&
        box.width >= 90
      );
    });
    const fullyVisibleLabels = Array.from(
      region.querySelectorAll<SVGGraphicsElement>(".react-flow__edge-text")
    ).filter((element) => {
      const box = element.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.left >= canvasBox.left &&
        box.right <= canvasBox.right &&
        box.top >= canvasBox.top &&
        box.bottom <= canvasBox.bottom
      );
    });
    const renderedNodeBoxes = renderedNodes
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    let cardIntersectionCount = 0;
    for (
      let leftIndex = 0;
      leftIndex < renderedNodeBoxes.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < renderedNodeBoxes.length;
        rightIndex += 1
      ) {
        const left = renderedNodeBoxes[leftIndex]!;
        const right = renderedNodeBoxes[rightIndex]!;
        const intersects = !(
          left.right <= right.left + 1 ||
          right.right <= left.left + 1 ||
          left.bottom <= right.top + 1 ||
          right.bottom <= left.top + 1
        );
        if (intersects) cardIntersectionCount += 1;
      }
    }
    return {
      renderedNodeIds: renderedNodes
        .map((element) => element.dataset.id!)
        .sort(),
      visibleNodeCount: visibleNodes.length,
      visibleNodeIds: visibleNodes.map((element) => element.dataset.id!).sort(),
      visibleNeighborCount: visibleNodes.filter(
        (element) => element.dataset.id !== nodeId
      ).length,
      cardIntersectionCount,
      fullyVisibleRelationshipLabelCount: fullyVisibleLabels.length,
      visibleStructuralEdgeCount:
        region.querySelectorAll(".react-flow__edge").length,
      visibleStructuralEdgeIds: Array.from(
        region.querySelectorAll<HTMLElement>(".react-flow__edge")
      )
        .map((element) =>
          (element.dataset.testid ?? "").replace(/^rf__edge-/, "")
        )
        .sort()
    };
  }, focusedNodeId);
  expect(focusedViewportEvidence.visibleNeighborCount).toBeGreaterThanOrEqual(
    1
  );
  expect(focusedViewportEvidence.cardIntersectionCount).toBe(0);
  expect(focusedViewportEvidence.fullyVisibleRelationshipLabelCount).toBe(0);
  expect(focusedViewportEvidence.visibleStructuralEdgeCount).toBe(
    expectedFocusedEdgeIds.length
  );
  expect(focusedViewportEvidence.renderedNodeIds).toEqual(
    [focusedNodeId, ...expectedFocusedChildIds].sort()
  );
  expect(focusedViewportEvidence.visibleStructuralEdgeIds).toEqual(
    [...expectedFocusedEdgeIds].sort()
  );
  expect(await readFlowControlIntersectionCount()).toBe(0);
  const focusedCardMinimumWidthPx = await hierarchy
    .locator('.react-flow__node:not([data-id^="lane:"])')
    .evaluateAll((elements) =>
      Math.min(
        ...elements
          .map((element) => element.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
          .map((box) => box.width)
      )
    );
  expect(focusedCardMinimumWidthPx).toBeGreaterThanOrEqual(
    testInfo.project.name === "pixel-7" ? 210 : 180
  );
  const focusedOpenTarget = await hierarchy
    .getByRole("button", { name: /^Open .+ in Forge$/ })
    .first()
    .boundingBox();
  expect(focusedOpenTarget).toBeTruthy();
  expect(focusedOpenTarget!.width).toBeGreaterThanOrEqual(44);
  expect(focusedOpenTarget!.height).toBeGreaterThanOrEqual(44);
  const focusedCanvasBox = await hierarchy
    .locator(".knowledge-graph-canvas")
    .boundingBox();
  expect(focusedCanvasBox).toBeTruthy();
  expect(focusedOpenTarget!.y).toBeGreaterThanOrEqual(focusedCanvasBox!.y);
  expect(focusedOpenTarget!.y + focusedOpenTarget!.height).toBeLessThanOrEqual(
    Math.min(
      focusedCanvasBox!.y + focusedCanvasBox!.height,
      await readBottomOccluderTop()
    )
  );
  await page.screenshot({
    path: path.join(projectRoot, "medium-hierarchy-focused-parity.png"),
    fullPage: false
  });

  const pointerChildNodeId = "project:medium-project-0001";
  const pointerGrandchildNodeId = "task:medium-task-0002";
  await hierarchy
    .locator(`.react-flow__node[data-id="${pointerChildNodeId}"]`)
    .locator("button")
    .first()
    .click();
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId,
    pointerChildNodeId
  );
  const pointerFocusedChild = hierarchy.locator(
    `.react-flow__node[data-id="${pointerChildNodeId}"]`
  );
  await expect(pointerFocusedChild).toBeVisible();
  const pointerFocusedChildBox = await pointerFocusedChild.boundingBox();
  const pointerFocusedTopValues = await hierarchy
    .locator('.react-flow__node:not([data-id^="lane:"])')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top)
    );
  expect(pointerFocusedChildBox).toBeTruthy();
  expect(pointerFocusedChildBox!.y).toBeLessThanOrEqual(
    Math.min(...pointerFocusedTopValues) + 1
  );
  await expect(
    hierarchy.locator(`.react-flow__node[data-id="${pointerGrandchildNodeId}"]`)
  ).toBeVisible();
  await expect(
    hierarchy.locator(
      '[data-testid="rf__edge-fixture:medium:story:project-task"]'
    )
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Up to parent" }).click();
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId,
    focusedNodeId
  );
  await expect(
    hierarchy.locator(`.react-flow__node[data-id="${focusedNodeId}"]`)
  ).toBeVisible();
  await page.getByRole("button", { name: "Full hierarchy" }).click();
  await page.waitForFunction(
    () => window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === null
  );
  await expect(page.getByText(/\d+ knowledge items available/)).toBeVisible();
  await expect(hierarchy.locator(".react-flow__edge")).toHaveCount(0);
  const keyboardDirectionControl = page.getByRole("button", {
    name: /Direction, \d+ items, collapsed/
  });
  await keyboardDirectionControl.focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel(/Direction, \d+ items, expanded/)).toBeVisible();
  const collapsedGroupExpandedWithSpace = await page
    .getByLabel(/Direction, \d+ items, expanded/)
    .isVisible();
  const keyboardEntityControl = hierarchy.getByRole("button", {
    name: new RegExp(`^${focusedNodeTitle}, goal`)
  });
  await keyboardEntityControl.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId,
    focusedNodeId
  );
  const keyboardFocusedNode = hierarchy.locator(
    `.react-flow__node[data-id="${focusedNodeId}"]`
  );
  await expect(keyboardFocusedNode).toBeVisible();
  const keyboardFocusedBox = await keyboardFocusedNode.boundingBox();
  const keyboardRenderedTopValues = await hierarchy
    .locator('.react-flow__node:not([data-id^="lane:"])')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top)
    );
  expect(keyboardFocusedBox).toBeTruthy();
  expect(keyboardFocusedBox!.y).toBeLessThanOrEqual(
    Math.min(...keyboardRenderedTopValues) + 1
  );
  const openFocusedEntityControl = hierarchy.getByRole("button", {
    name: `Open ${focusedNodeTitle} in Forge`
  });
  await openFocusedEntityControl.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.url()).not.toContain("knowledge-graph");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForForge(page);
  await expect(hierarchy).toBeVisible();
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId,
    focusedNodeId
  );
  await writeFile(
    path.join(projectRoot, "large-hierarchy-receipt.json"),
    `${JSON.stringify(
      {
        totalKnowledgeItems: 2500,
        collapsedRenderedDomNodes,
        renderedDomNodes: await hierarchy.locator(".react-flow__node").count(),
        expandAllLatenciesMs,
        medianExpandAllLatencyMs: [...expandAllLatenciesMs].sort(
          (left, right) => left - right
        )[2],
        hierarchyFrameP95Ms,
        hierarchyFramesWithin25MsPercent,
        expandedViewportScale,
        readableExpandedCards,
        toolbarGapPx:
          hierarchyToolbar!.y - (topControlBox!.y + topControlBox!.height),
        flowControlsOverlapViewSwitch,
        sideHandleEvidence,
        seriousOrCriticalAccessibilityViolations: 0,
        pointerJourney: {
          childSelectionRefocusedHierarchy: true,
          childBranchRefreshed: true,
          parentReturnRestoredFocus: true,
          fullHierarchyClearedFocus: true
        },
        keyboardJourney: {
          collapsedGroupExpandedWithEnter,
          collapsedGroupExpandedWithSpace,
          entitySelectedWithEnter: true,
          selectedNodeIsTopmostAfterKeyboardSelection: true,
          entityOpenedWithEnter: true,
          browserBackRestoredFocusedHierarchy: true
        },
        focusedParity: {
          nodeId: focusedNodeId,
          nodeTitle: focusedNodeTitle,
          expectedFocusPanelLinkedItemCount:
            expectedFocusPanelLinkedItemIds.size,
          expectedStructuralChildCount: focusedStructuralChildCount,
          selectedNodeIsTopmostRenderedEntity: true,
          ...focusedViewportEvidence
        },
        readableStateMetrics: {
          oneLane: oneLaneCardMetrics,
          focusedCardMinimumWidthPx,
          oneLaneOpenTarget,
          focusedOpenTarget
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
});

test("preserves focused graph context through entity navigation and delayed browser back", async ({
  page
}, testInfo) => {
  test.setTimeout(90_000);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  const controller = await installVisualGraphRoute(page);
  controller.setSize("medium");
  await navigateFixture(page, "medium");
  await waitForVisualGraph(page);

  const focusedNodeId = "task:medium-task-0002";
  await page.evaluate((nodeId) => {
    window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.selectNodeById?.(nodeId);
  }, focusedNodeId);
  await waitForFocusedVisualGraph(page, focusedNodeId);
  const before = await page.evaluate(() => ({
    camera: window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__!.camera,
    focusNodeId: window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__!.focusNodeId,
    renderedPresentationKey:
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.renderedPresentationKey
  }));

  if (
    await page.evaluate(() => window.matchMedia("(max-width: 1023px)").matches)
  ) {
    await page.evaluate(() => {
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.activateFocusedNode?.();
    });
  }

  await page.getByRole("button", { name: "Open page" }).last().click();
  await expect.poll(() => page.url()).not.toContain("knowledge-graph");
  controller.setMode("delayed");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForForge(page);
  await expect(page.getByLabel("Knowledge graph canvas").first()).toBeVisible();
  await waitForFocusedVisualGraph(page, focusedNodeId);

  const after = await page.evaluate(() => ({
    camera: window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__!.camera,
    focusNodeId: window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__!.focusNodeId,
    renderedPresentationKey:
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.renderedPresentationKey
  }));
  expect(after.focusNodeId).toBe(focusedNodeId);
  expect(Math.abs(after.camera.x - before.camera.x)).toBeLessThanOrEqual(0.02);
  expect(Math.abs(after.camera.y - before.camera.y)).toBeLessThanOrEqual(0.02);
  expect(
    Math.abs(after.camera.ratio - before.camera.ratio) /
      Math.max(before.camera.ratio, 0.001)
  ).toBeLessThanOrEqual(0.03);
  await expect(
    page.getByRole("button", { name: "Back to overview" })
  ).toBeVisible();

  controller.releaseDelayedResponse();
  controller.setMode("normal");
  await writeFile(
    path.join(projectRoot, "medium-route-return-receipt.json"),
    `${JSON.stringify(
      {
        focusedNodeId,
        graphStayedVisibleBeforeDelayedResponseRelease: true,
        before,
        after
      },
      null,
      2
    )}\n`,
    "utf8"
  );
});

test("traverses goal to project to task to note with history and reduced-motion parity", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  const controller = await installVisualGraphRoute(page);
  controller.setSize("medium");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await navigateFixture(page, "medium");
  await waitForVisualGraph(page);

  const fixture = buildVisualStoryGraphFixture("medium");
  const traversal = [
    {
      nodeId: "goal:medium-goal-0000",
      edgeId: null,
      relationKind: null,
      relationLabel: null,
      previousNodeId: null
    },
    {
      nodeId: "project:medium-project-0001",
      edgeId: "fixture:medium:story:goal-project",
      relationKind: "goal_project",
      relationLabel: "Goal to project",
      previousNodeId: "goal:medium-goal-0000"
    },
    {
      nodeId: "task:medium-task-0002",
      edgeId: "fixture:medium:story:project-task",
      relationKind: "project_task",
      relationLabel: "Project to task",
      previousNodeId: "project:medium-project-0001"
    },
    {
      nodeId: "note:medium-note-0006",
      edgeId: "fixture:medium:story:task-note",
      relationKind: "entity_link",
      relationLabel: "Entity link",
      previousNodeId: "task:medium-task-0002"
    }
  ] as const;
  const nodeById = new Map(fixture.nodes.map((node) => [node.id, node]));
  for (const step of traversal.slice(1)) {
    const edge = fixture.edges.find(
      (candidate) => candidate.id === step.edgeId
    );
    expect(edge).toMatchObject({
      source: step.previousNodeId,
      target: step.nodeId,
      relationKind: step.relationKind
    });
  }

  const normalSteps: Array<{
    nodeId: string;
    title: string;
    url: string;
    camera: { x: number; y: number; ratio: number; angle: number };
    presentationNodeCount: number;
    transitionDurationMs: number;
    renderedPresentationKey: string;
  }> = [];
  const isPhone = testInfo.project.name === "pixel-7";
  const activateVisibleRelationship = async (nextStep: {
    nodeId: string;
    relationLabel: string;
  }) => {
    const relationHeading = page
      .getByText(nextStep.relationLabel, { exact: true })
      .last();
    if (!(await relationHeading.isVisible())) {
      await page.getByRole("button", { name: "Open details" }).click();
    }
    await expect(relationHeading).toBeVisible();
    const targetTitle = nodeById.get(nextStep.nodeId)!.title;
    const targetControl = relationHeading
      .locator("..")
      .getByRole("button")
      .filter({ hasText: targetTitle })
      .first();
    await expect(targetControl).toBeVisible();
    await targetControl.focus();
    await page.keyboard.press("Enter");
    await waitForFocusedVisualGraph(page, nextStep.nodeId);
  };
  const graphCanvas = page.getByRole("application", {
    name: /Knowledge graph canvas/
  });
  await graphCanvas.focus();
  await page.keyboard.press("Home");
  await waitForFocusedVisualGraph(page, traversal[0].nodeId);
  for (const [index, step] of traversal.entries()) {
    await waitForFocusedVisualGraph(page, step.nodeId);
    await page.getByRole("button", { name: "Open details" }).click();
    const openPageControl = page
      .getByRole("button", { name: "Open page" })
      .last();
    await expect(openPageControl).toBeVisible();
    if (step.relationLabel && step.previousNodeId) {
      await expect(
        page.getByText(step.relationLabel, { exact: true }).last()
      ).toBeVisible();
      await expect(
        page
          .getByText(nodeById.get(step.previousNodeId)!.title, { exact: false })
          .last()
      ).toBeVisible();
    }
    await captureState({
      page,
      projectRoot,
      name: `medium-traversal-${index}-${nodeById.get(step.nodeId)!.entityKind}`,
      fixtureSize: "medium",
      protectedNodeIds: [
        step.nodeId,
        ...(step.previousNodeId ? [step.previousNodeId] : [])
      ]
    });
    const snapshot = await page.evaluate(() => {
      const performanceState = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!;
      return {
        camera: performanceState.camera!,
        presentationNodeCount:
          window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__!.presentationNodeCount,
        layoutStartedAt: performanceState.layoutStartedAt!,
        focusSettledAt: performanceState.focusSettledAt!,
        renderedPresentationKey: performanceState.renderedPresentationKey!
      };
    });
    expect(snapshot.focusSettledAt - snapshot.layoutStartedAt).toBeLessThan(
      2_000
    );
    normalSteps.push({
      nodeId: step.nodeId,
      title: nodeById.get(step.nodeId)!.title,
      url: page.url(),
      camera: snapshot.camera,
      presentationNodeCount: snapshot.presentationNodeCount,
      transitionDurationMs: snapshot.focusSettledAt - snapshot.layoutStartedAt,
      renderedPresentationKey: snapshot.renderedPresentationKey
    });
    const nextStep = traversal[index + 1];
    if (nextStep) {
      await activateVisibleRelationship({
        nodeId: nextStep.nodeId,
        relationLabel: nextStep.relationLabel!
      });
    } else if (isPhone) {
      await page.getByRole("button", { name: "Close" }).last().click();
      await page.waitForFunction(
        (nodeId) =>
          window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.focusNodeId === nodeId,
        step.nodeId
      );
      await expect(
        page.getByLabel("Knowledge graph canvas").first()
      ).toBeVisible();
    }
  }

  if (isPhone) {
    await page.getByRole("button", { name: "Back to overview" }).click();
  } else {
    await page.getByRole("button", { name: "Close" }).last().click();
  }
  await page.waitForFunction(
    () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.focusNodeId === null
  );
  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForForge(page);
  await waitForFocusedVisualGraph(page, normalSteps.at(-1)!.nodeId);

  const historyReturns: Array<{
    nodeId: string;
    url: string;
    camera: { x: number; y: number; ratio: number; angle: number };
  }> = [];
  for (const expectedStep of [...normalSteps].reverse()) {
    if (expectedStep.nodeId === normalSteps.at(-1)!.nodeId) {
      const camera = await page.evaluate(
        () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.camera!
      );
      historyReturns.push({
        nodeId: expectedStep.nodeId,
        url: page.url(),
        camera
      });
      continue;
    }
    await page.goBack({ waitUntil: "domcontentloaded" });
    await waitForForge(page);
    await waitForFocusedVisualGraph(page, expectedStep.nodeId);
    const camera = await page.evaluate(
      () => window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!.camera!
    );
    expect(
      Math.abs(camera.x - expectedStep.camera.x),
      `${expectedStep.nodeId} restored camera x`
    ).toBeLessThanOrEqual(0.02);
    expect(
      Math.abs(camera.y - expectedStep.camera.y),
      `${expectedStep.nodeId} restored camera y`
    ).toBeLessThanOrEqual(0.02);
    expect(
      Math.abs(camera.ratio - expectedStep.camera.ratio) /
        Math.max(expectedStep.camera.ratio, 0.001),
      `${expectedStep.nodeId} restored camera ratio`
    ).toBeLessThanOrEqual(0.03);
    historyReturns.push({
      nodeId: expectedStep.nodeId,
      url: page.url(),
      camera
    });
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedSteps: Array<{
    nodeId: string;
    presentationNodeCount: number;
    reducedMotion: boolean;
    transitionDurationMs: number;
    cameraAnimationDurationMs: number;
  }> = [];
  for (const step of traversal.slice(1)) {
    await activateVisibleRelationship({
      nodeId: step.nodeId,
      relationLabel: step.relationLabel
    });
    const snapshot = await page.evaluate(() => {
      const performanceState = window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__!;
      return {
        presentationNodeCount:
          window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__!.presentationNodeCount,
        reducedMotion: performanceState.reducedMotion,
        cameraAnimationDurationMs:
          performanceState.lastCameraAnimationDurationMs!,
        transitionDurationMs:
          performanceState.focusSettledAt! - performanceState.layoutStartedAt!
      };
    });
    expect(snapshot.reducedMotion).toBe(true);
    expect(snapshot.cameraAnimationDurationMs).toBe(0);
    expect(snapshot.presentationNodeCount).toBe(
      normalSteps.find((candidate) => candidate.nodeId === step.nodeId)!
        .presentationNodeCount
    );
    expect(snapshot.transitionDurationMs).toBeLessThan(2_000);
    reducedSteps.push({ nodeId: step.nodeId, ...snapshot });
  }
  await page.getByRole("button", { name: "Open details" }).click();
  await expect(
    page.getByText("Entity link", { exact: true }).last()
  ).toBeVisible();
  await captureState({
    page,
    projectRoot,
    name: "medium-traversal-reduced-motion-note",
    fixtureSize: "medium",
    protectedNodeIds: ["task:medium-task-0002", "note:medium-note-0006"]
  });
  await writeFile(
    path.join(projectRoot, "medium-three-step-traversal-receipt.json"),
    `${JSON.stringify(
      {
        fixtureVersion: VISUAL_STORY_FIXTURE_VERSION,
        fixturePayloadHash: payloadHash(fixture),
        exactEdges: traversal.slice(1).map((step) => ({
          id: step.edgeId,
          source: step.previousNodeId,
          target: step.nodeId,
          relationKind: step.relationKind,
          accessibleLabel: step.relationLabel
        })),
        normalSteps,
        historyReturns,
        reducedSteps,
        informationParity: reducedSteps.every(
          (step) =>
            step.presentationNodeCount ===
            normalSteps.find((candidate) => candidate.nodeId === step.nodeId)
              ?.presentationNodeCount
        ),
        reducedMotionUsesImmediateCameraTransitions: reducedSteps.every(
          (step) => step.cameraAnimationDurationMs === 0
        )
      },
      null,
      2
    )}\n`,
    "utf8"
  );
});

test("captures the Knowledge Graph loading state", async ({
  page
}, testInfo) => {
  test.setTimeout(60_000);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  const controller = await installVisualGraphRoute(page);
  controller.setSize("medium");
  await page.goto("overview", { waitUntil: "domcontentloaded" });
  await waitForForge(page);
  controller.setMode("delayed");
  await navigateFixture(page, "medium", { state: "loading" });
  await page.waitForTimeout(750);
  await captureState({
    page,
    projectRoot,
    name: "medium-loading",
    fixtureSize: "medium"
  });
  controller.releaseDelayedResponse();
  await page.waitForTimeout(250);
});

test("captures the Knowledge Graph stale refresh state", async ({
  page
}, testInfo) => {
  test.setTimeout(60_000);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  const controller = await installVisualGraphRoute(page);
  controller.setSize("medium");
  controller.setMode("normal");
  await navigateFixture(page, "medium", { state: "stale-ready" });
  await waitForVisualGraph(page);
  controller.setMode("fail");
  await page.evaluate(() => {
    window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.refetchGraph?.();
  });
  await expect(
    page.getByText(
      "The latest graph refresh failed. The previous bounded graph is still visible."
    )
  ).toBeVisible({ timeout: 15_000 });
  await captureState({
    page,
    projectRoot,
    name: "medium-stale-refresh-error",
    fixtureSize: "medium"
  });
});

test("captures the Knowledge Graph renderer fallback", async ({
  page
}, testInfo) => {
  test.setTimeout(60_000);
  const projectRoot = path.join(resultRoot!, testInfo.project.name);
  await mkdir(projectRoot, { recursive: true });
  await page.addInitScript(() => {
    window.__FORGE_KG_FORCE_FALLBACK__ = true;
  });
  const controller = await installVisualGraphRoute(page);
  controller.setSize("medium");
  controller.setMode("normal");
  await navigateFixture(page, "medium", { state: "fallback" });
  await waitForForge(page);
  await expect(page.getByLabel("Knowledge graph canvas")).toBeVisible();
  await page.waitForTimeout(1_500);
  await captureState({
    page,
    projectRoot,
    name: "medium-renderer-fallback",
    fixtureSize: "medium"
  });
});
