import { expect, test, type Page } from "@playwright/test";

type GraphDiagnostics = {
  visibleNodeIds: string[];
  focusedNodeId: string | null;
  draggedNodeId?: string | null;
  layoutGeneration: number;
  rendererMode?: "sigma" | "fallback";
  camera: {
    x: number;
    y: number;
    ratio: number;
  };
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
};

async function waitForDiagnostics(page: Page) {
  await page.waitForFunction(
    () =>
      Boolean(
        (window as Window & {
          __FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__?: unknown;
        }).__FORGE_KNOWLEDGE_GRAPH_DIAGNOSTICS__
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

async function clickVisibleNode(page: Page) {
  const diagnostics = (await readDiagnostics(page)) as GraphDiagnostics;
  const targetId =
    diagnostics.visibleNodeIds.find((nodeId) => nodeId !== diagnostics.focusedNodeId) ??
    diagnostics.visibleNodeIds[0];
  expect(targetId).toBeTruthy();
  await page.evaluate((nodeId) => {
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
  test.skip(testInfo.project.name !== "chromium", "Desktop-only graph stability test");

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
  await waitForDiagnostics(page);
  await page.waitForTimeout(3200);

  const before = (await readDiagnostics(page)) as GraphDiagnostics;
  expect(before.visibleNodeIds.length).toBeGreaterThan(0);
  expect(before.rendererMode).toBeTruthy();

  await page.waitForTimeout(6000);

  const after = (await readDiagnostics(page)) as GraphDiagnostics;
  expect(after.layoutGeneration).toBe(before.layoutGeneration);
  expect(consoleErrors.join("\n")).not.toContain("UsageGraphError");
  expect(consoleErrors.join("\n")).not.toContain("An error occurred in the <ForwardRef");
  expect(consoleErrors.join("\n")).not.toContain("Too many active WebGL contexts");
  expect(consoleErrors.join("\n")).not.toContain("Sigma: Container has no width");
  expect(pageErrors.join("\n")).not.toContain("UsageGraphError");
  expect(pageErrors.join("\n")).not.toContain("Sigma: Container has no width");
});

test("desktop knowledge graph recenters around the clicked node and updates focus state", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop-only graph interaction test");

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForDiagnostics(page);

  const before = (await readDiagnostics(page)) as GraphDiagnostics;
  const clickedNodeId = await clickVisibleNode(page);

  await expect
    .poll(async () => new URL(page.url()).searchParams.get("focus"))
    .toBeTruthy();
  await expect
    .poll(async () => (await readDiagnostics(page))?.focusedNodeId)
    .toBe(clickedNodeId);

  const after = (await readDiagnostics(page)) as GraphDiagnostics;
  expect(after.visibleNodeIds.length).toBeGreaterThan(0);
  expect(after.camera.ratio).toBeLessThanOrEqual(before.camera.ratio);
  expect(after.layoutGeneration).toBe(before.layoutGeneration);
  expect(after.focusedNodeId).toBe(clickedNodeId);
});

test("mobile knowledge graph keeps first tap in focus mode and opens details on the second tap", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7", "Mobile-only graph interaction test");

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
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
  await page.waitForFunction(
    (nodeId) =>
      window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.focusNodeId === nodeId &&
      typeof window.__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.selectNode === "function",
    clickedNodeId
  );

  await page.evaluate((nodeId) => {
    (
      window as Window & {
        __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
          selectNode: (nextNodeId: string | null) => void;
        };
      }
    ).__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.selectNode(nodeId);
  }, clickedNodeId);

  await expect
    .poll(async () => (await readPageDiagnostics(page))?.mobileSheetOpen)
    .toBe(true);
});

test("desktop graph test api can move a node without rebuilding the layout shell", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop-only graph interaction test");

  await page.addInitScript(() => {
    (
      window as Window & { __FORGE_ENABLE_GRAPH_DIAGNOSTICS__?: boolean }
    ).__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
  });

  await page.goto("knowledge-graph?limit=40&graphDiagnostics=1");
  await waitForDiagnostics(page);

  const before = (await readDiagnostics(page)) as GraphDiagnostics;
  const targetId = before.visibleNodeIds[0];
  expect(targetId).toBeTruthy();
  const beforePosition = before.nodeScreenPositions[targetId!];
  expect(beforePosition).toBeTruthy();

  await page.evaluate(([nodeId, deltaX, deltaY]) => {
    (
      window as Window & {
        __FORGE_KNOWLEDGE_GRAPH_TEST_API__?: {
          moveNodeBy?: (nextNodeId: string, moveX: number, moveY: number) => void;
        };
      }
    ).__FORGE_KNOWLEDGE_GRAPH_TEST_API__?.moveNodeBy?.(nodeId, deltaX, deltaY);
  }, [targetId!, 5, -3] as const);

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
