import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installE2eStorageGuards, waitForForge } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  await installE2eStorageGuards(page, testInfo.testId);
});

type GraphDiagnostics = {
  visibleNodeIds: string[];
  focusedNodeId: string | null;
  primaryFocusedNodeId?: string | null;
  draggedNodeId?: string | null;
  layoutGeneration: number;
  rendererMode?: "sigma" | "fallback";
  startupPhase?: string;
  startupInvariantSatisfied?: boolean;
  graphCentroid?: {
    x: number;
    y: number;
  };
  boundsCenter?: {
    x: number;
    y: number;
  };
  focusedNodePosition?: {
    x: number;
    y: number;
  } | null;
  cameraTarget?: {
    x: number;
    y: number;
    ratio: number;
  } | null;
  cameraFollowError?: {
    x: number;
    y: number;
    ratio: number;
  } | null;
  camera: {
    x: number;
    y: number;
    ratio: number;
  };
  centroidDistanceFromOrigin?: number;
  boundsCenterDistanceFromOrigin?: number;
  cameraDistanceFromOrigin?: number;
  cameraToCentroidDistance?: number;
  nodeScreenPositions: Record<
    string,
    {
      x: number;
      y: number;
      size: number;
    }
  >;
};

type GraphPageDiagnostics = {
  isMobile: boolean;
  mobileSheetOpen: boolean;
  focusNodeId: string | null;
  selectedView: "graph" | "hierarchy";
  displayMode: "default" | "all";
  presentationNodeBudget: number;
  presentationNodeCount: number;
  selectNodeById?: (nodeId: string | null) => void;
  activateFocusedNode?: () => void;
};

async function waitForDiagnostics(page: Page) {
  await page.waitForFunction(
    () =>
      Boolean(
        (
          window as Window & {
            __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: unknown;
          }
        ).__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__
      ),
    undefined,
    { timeout: 20_000 }
  );
}

async function readDiagnostics(page: Page) {
  return page.evaluate(() => {
    return (
      window as Window & {
        __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: GraphDiagnostics;
      }
    ).__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__;
  });
}

async function readPageDiagnostics(page: Page) {
  return page.evaluate(() => {
    return (
      window as Window & {
        __FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?: GraphPageDiagnostics;
      }
    ).__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__;
  });
}

async function clickVisibleNode(
  page: Page,
  strategy: "pointer" | "api" = "api"
) {
  const diagnostics = (await readDiagnostics(page)) as GraphDiagnostics;
  const targetId =
    diagnostics.visibleNodeIds.find(
      (nodeId) => nodeId !== diagnostics.focusedNodeId
    ) ?? diagnostics.visibleNodeIds[0];
  expect(targetId).toBeTruthy();
  if (strategy === "pointer") {
    const targetPosition = diagnostics.nodeScreenPositions[targetId!];
    expect(targetPosition).toBeTruthy();
    const canvasBox = await page
      .getByLabel("Knowledge graph canvas")
      .first()
      .boundingBox();
    expect(canvasBox).toBeTruthy();
    await page.mouse.click(
      canvasBox!.x + targetPosition.x,
      canvasBox!.y + targetPosition.y
    );
    return targetId!;
  }
  await page.evaluate((nodeId) => {
    (
      window as Window & {
        __FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?: {
          selectNodeById?: (nextNodeId: string | null) => void;
        };
        __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
          selectNode: (nextNodeId: string | null) => void;
          moveNodeBy?: (nodeId: string, deltaX: number, deltaY: number) => void;
        };
      }
    ).__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.selectNodeById?.(nodeId);
    (
      window as Window & {
        __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
          selectNode: (nextNodeId: string | null) => void;
          moveNodeBy?: (nodeId: string, deltaX: number, deltaY: number) => void;
        };
      }
    ).__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.selectNode(nodeId);
  }, targetId!);

  return targetId!;
}

test("knowledge graph loads without renderer crashes and stays stable while idle", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop-only graph stability test"
  );

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForForge(page);
  await waitForDiagnostics(page);
  await page.waitForTimeout(3200);

  const before = (await readDiagnostics(page)) as GraphDiagnostics;
  expect(before.visibleNodeIds.length).toBeGreaterThan(0);
  expect(before.rendererMode).toBeTruthy();

  await page.waitForTimeout(6000);

  const after = (await readDiagnostics(page)) as GraphDiagnostics;
  expect(after.layoutGeneration).toBe(before.layoutGeneration);
  expect(Math.abs(after.graphCentroid?.x ?? 0)).toBeLessThan(6);
  expect(Math.abs(after.graphCentroid?.y ?? 0)).toBeLessThan(6);
  expect(consoleErrors.join("\n")).not.toContain("UsageGraphError");
  expect(consoleErrors.join("\n")).not.toContain(
    "An error occurred in the <ForwardRef"
  );
  expect(consoleErrors.join("\n")).not.toContain(
    "Too many active WebGL contexts"
  );
  expect(consoleErrors.join("\n")).not.toContain(
    "Sigma: Container has no width"
  );
  expect(pageErrors.join("\n")).not.toContain("UsageGraphError");
  expect(pageErrors.join("\n")).not.toContain("Sigma: Container has no width");
});

test("knowledge graph starts centered and reports a satisfied startup invariant", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop-only startup diagnostics test"
  );

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForForge(page);
  await waitForDiagnostics(page);

  await expect
    .poll(async () => (await readDiagnostics(page))?.startupPhase)
    .toMatch(/startup_verified|first_frame|worker_started/);

  const diagnostics = (await readDiagnostics(page)) as GraphDiagnostics;
  expect(diagnostics.visibleNodeIds.length).toBeGreaterThan(0);
  const centeredCameraCoordinate =
    diagnostics.rendererMode === "sigma" ? 0.5 : 0;
  expect(diagnostics.camera.x).toBeCloseTo(centeredCameraCoordinate, 3);
  expect(diagnostics.camera.y).toBeCloseTo(centeredCameraCoordinate, 3);
  expect(diagnostics.startupInvariantSatisfied).toBe(true);
  expect(Math.abs(diagnostics.graphCentroid?.x ?? 0)).toBeLessThan(0.6);
  expect(Math.abs(diagnostics.graphCentroid?.y ?? 0)).toBeLessThan(0.6);
  expect(diagnostics.centroidDistanceFromOrigin ?? 99).toBeLessThan(0.6);
  const centeredCameraDistanceFromOrigin =
    diagnostics.rendererMode === "sigma" ? Math.SQRT1_2 : 0;
  expect(diagnostics.cameraDistanceFromOrigin).toBeCloseTo(
    centeredCameraDistanceFromOrigin,
    3
  );
});

test("desktop focus keeps the focused node anchored on screen while the neighborhood settles", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop-only graph interaction test"
  );

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForForge(page);
  await waitForDiagnostics(page);

  const focusedNodeId = await clickVisibleNode(page);
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
        ?.renderedSettledFocusNodeId === nodeId &&
      window.__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
        ?.focusCameraSettledNodeId === nodeId &&
      Boolean(
        window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?.nodeScreenPositions[
          nodeId
        ]
      ),
    focusedNodeId
  );
  const focused = (await readDiagnostics(page)) as GraphDiagnostics;
  const focusedScreenPosition = focused.nodeScreenPositions[focusedNodeId];
  expect(focusedScreenPosition).toBeTruthy();

  await page.waitForTimeout(900);
  await page.waitForFunction(
    (nodeId) =>
      Boolean(
        window.__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?.nodeScreenPositions[
          nodeId
        ]
      ),
    focusedNodeId
  );

  const settled = (await readDiagnostics(page)) as GraphDiagnostics;
  const settledScreenPosition = settled.nodeScreenPositions[focusedNodeId];
  expect(settledScreenPosition).toBeTruthy();
  expect(
    Math.abs(settledScreenPosition.x - focusedScreenPosition.x)
  ).toBeLessThan(28);
  expect(
    Math.abs(settledScreenPosition.y - focusedScreenPosition.y)
  ).toBeLessThan(28);
  expect(Math.abs(settled.graphCentroid?.x ?? 0)).toBeLessThan(6);
  expect(Math.abs(settled.graphCentroid?.y ?? 0)).toBeLessThan(6);
});

test("mobile knowledge graph keeps first tap in focus mode and opens details on the second tap", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "pixel-7",
    "Mobile-only graph interaction test"
  );

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForForge(page);
  await waitForDiagnostics(page);

  const clickedNodeId = await clickVisibleNode(page);

  await expect
    .poll(async () => (await readPageDiagnostics(page))?.isMobile)
    .toBe(true);

  await expect
    .poll(async () => (await readDiagnostics(page))?.focusedNodeId)
    .toBe(clickedNodeId);
  await expect
    .poll(async () => new URL(page.url()).searchParams.get("focus"))
    .toBeTruthy();
  await expect
    .poll(async () => (await readPageDiagnostics(page))?.mobileSheetOpen)
    .toBe(false);
  await expect(page.getByTestId("knowledge-graph-desktop-toolbar")).toHaveCount(
    0
  );
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId &&
      typeof window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.activateFocusedNode ===
        "function",
    clickedNodeId
  );
  await page.evaluate(() => {
    (
      window as Window & {
        __FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?: {
          activateFocusedNode?: () => void;
        };
      }
    ).__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.activateFocusedNode?.();
  });

  await expect
    .poll(async () => (await readPageDiagnostics(page))?.mobileSheetOpen)
    .toBe(true);
});

test("mobile disclosure control meets its touch target without horizontal overflow", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "pixel-7",
    "Pixel 7 responsive control test"
  );

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForForge(page);
  await page.getByRole("button", { name: "Open graph filters" }).click();

  const disclosureButton = page.getByRole("button", {
    name: "Show all types"
  });
  const box = await disclosureButton.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);

  await disclosureButton.click();
  await expect
    .poll(async () => (await readPageDiagnostics(page))?.displayMode)
    .toBe("all");
  const pageState = await readPageDiagnostics(page);
  expect(pageState?.isMobile).toBe(true);
  expect(pageState?.presentationNodeBudget).toBe(280);
});

test("knowledge graph honors reduced motion in camera and layout presentation", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });
  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForForge(page);
  await page.waitForFunction(
    () =>
      (
        window as Window & {
          __FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?: {
            reducedMotion?: boolean;
            positionPublishIntervalTicks?: number;
          };
        }
      ).__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?.reducedMotion === true
  );
  const presentation = await page.evaluate(
    () =>
      (
        window as Window & {
          __FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__?: {
            reducedMotion?: boolean;
            positionPublishIntervalTicks?: number;
          };
        }
      ).__FORGE_KNOWLEDGE_GRAPH_PERFORMANCE__
  );
  expect(presentation?.positionPublishIntervalTicks).toBe(10);
});

test("knowledge graph has no serious or critical accessibility violations", async ({
  page
}) => {
  await page.goto("knowledge-graph?limit=40");
  await waitForForge(page);
  await expect(page.getByLabel("Knowledge graph canvas")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[data-testid="knowledge-graph-page"]')
    .analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical"
  );
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target)
    }))
  ).toEqual([]);
});

test("desktop graph test api can move a node without rebuilding the layout shell", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop-only graph interaction test"
  );

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForForge(page);
  await waitForDiagnostics(page);

  const before = (await readDiagnostics(page)) as GraphDiagnostics;
  const targetId = before.visibleNodeIds[0];
  expect(targetId).toBeTruthy();
  const beforePosition = before.nodeScreenPositions[targetId!];
  expect(beforePosition).toBeTruthy();

  await page.evaluate(
    ([nodeId, deltaX, deltaY]) => {
      (
        window as Window & {
          __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
            moveNodeBy?: (
              nextNodeId: string,
              moveX: number,
              moveY: number
            ) => void;
          };
        }
      ).__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.moveNodeBy?.(
        nodeId,
        deltaX,
        deltaY
      );
    },
    [targetId!, 5, -3] as const
  );

  await expect
    .poll(async () => {
      const current = (await readDiagnostics(page)) as GraphDiagnostics;
      const position = current.nodeScreenPositions[targetId!];
      return (
        Math.abs(position.x - beforePosition.x) +
        Math.abs(position.y - beforePosition.y)
      );
    })
    .toBeGreaterThan(0.5);

  const after = (await readDiagnostics(page)) as GraphDiagnostics;
  const afterPosition = after.nodeScreenPositions[targetId!];
  expect(after.layoutGeneration).toBe(before.layoutGeneration);
  expect(afterPosition).toBeTruthy();
});
