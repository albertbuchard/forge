import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: {
      host: "127.0.0.1:4317"
    }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

test("ai connectors can be created, run, and expose published outputs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-ai-proc-"));
  const originalFetch = globalThis.fetch;
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  globalThis.fetch = (async (_request, init) => {
    if (init?.method === "POST") {
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: "processor-output"
                }
              ]
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
    return new Response("not-found", { status: 404 });
  }) as typeof fetch;

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const connectionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/models/connections",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        label: "OpenAI API",
        provider: "openai-api",
        model: "gpt-5.4-mini",
        apiKey: "sk-test"
      }
    });
    assert.equal(connectionResponse.statusCode, 201);
    const connectionId = (
      connectionResponse.json() as { connection: { id: string } }
    ).connection.id;

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        modelSettings: {
          forgeAgent: {
            basicChat: {
              connectionId,
              model: "gpt-5.4-mini"
            }
          }
        }
      }
    });
    assert.equal(patchResponse.statusCode, 200);

    const connectorResponse = await app.inject({
      method: "POST",
      url: "/api/v1/ai-connectors",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        title: "Test connector",
        description: "Connector under test",
        kind: "functor",
        homeSurfaceId: "overview",
        graph: {
          nodes: [
            {
              id: "node_box",
              type: "box_input",
              position: { x: 80, y: 120 },
              data: {
                label: "Overview priorities",
                description: "Structured overview context",
                boxId: "overview:priorities",
                enabledToolKeys: []
              }
            },
            {
              id: "node_functor",
              type: "functor",
              position: { x: 360, y: 120 },
              data: {
                label: "Summarize",
                description: "Summarize the linked box",
                prompt: "Summarize the linked Forge context and return one line.",
                systemPrompt: "",
                enabledToolKeys: [],
                modelConfig: {
                  connectionId,
                  provider: "openai-api",
                  baseUrl: "https://api.openai.com/v1",
                  model: "gpt-5.4-mini",
                  thinking: null,
                  verbosity: null
                }
              }
            },
            {
              id: "node_output",
              type: "output",
              position: { x: 680, y: 120 },
              data: {
                label: "Output",
                description: "Published connector output",
                outputKey: "primary"
              }
            }
          ],
          edges: [
            {
              id: "edge_box_functor",
              source: "node_box",
              target: "node_functor",
              sourceHandle: null,
              targetHandle: null,
              label: null
            },
            {
              id: "edge_functor_output",
              source: "node_functor",
              target: "node_output",
              sourceHandle: null,
              targetHandle: null,
              label: null
            }
          ]
        }
      }
    });
    assert.equal(connectorResponse.statusCode, 201);
    const connectorBody = connectorResponse.json() as {
      connector: { id: string; slug: string; publishedOutputs: Array<{ id: string }> };
    };
    const connectorId = connectorBody.connector.id;
    const connectorSlug = connectorBody.connector.slug;
    assert.equal(connectorBody.connector.publishedOutputs.length, 1);

    const workbenchListResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/flows",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(workbenchListResponse.statusCode, 200);
    const workbenchListBody = workbenchListResponse.json() as {
      flows: Array<{ id: string }>;
    };
    assert.ok(workbenchListBody.flows.some((entry) => entry.id === connectorId));

    const catalogResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ai-connectors/catalog/boxes",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(catalogResponse.statusCode, 200);
    const catalogBody = catalogResponse.json() as {
      boxes: Array<{ boxId: string }>;
    };
    assert.ok(
      catalogBody.boxes.some((entry) => entry.boxId === "overview:priorities")
    );

    const workbenchCatalogResponse = await app.inject({
      method: "GET",
      url: "/api/v1/workbench/catalog/boxes",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(workbenchCatalogResponse.statusCode, 200);
    const workbenchCatalogBody = workbenchCatalogResponse.json() as {
      boxes: Array<{ boxId: string }>;
    };
    assert.ok(
      workbenchCatalogBody.boxes.some(
        (entry) => entry.boxId === "surface:overview:quick-capture"
      )
    );

    const runResponse = await app.inject({
      method: "POST",
      url: `/api/v1/ai-connectors/${connectorId}/run`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userInput: "run now"
      }
    });
    assert.equal(runResponse.statusCode, 200);
    const runBody = runResponse.json() as {
      connector: { id: string };
      run: { result: { primaryText: string } };
    };
    assert.equal(runBody.connector.id, connectorId);
    assert.match(runBody.run.result.primaryText, /processor-output/);

    const workbenchRunResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/run",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        flowId: connectorId,
        userInput: "debug run",
        debug: true
      }
    });
    assert.equal(workbenchRunResponse.statusCode, 200);
    const workbenchRunBody = workbenchRunResponse.json() as {
      flow: { id: string };
      run: { result: { primaryText: string; debugTrace?: { nodes: Array<{ nodeId: string }> } } };
    };
    assert.equal(workbenchRunBody.flow.id, connectorId);
    assert.match(workbenchRunBody.run.result.primaryText, /processor-output/);
    assert.ok((workbenchRunBody.run.result.debugTrace?.nodes.length ?? 0) >= 1);

    const workbenchFlowResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${connectorId}`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(workbenchFlowResponse.statusCode, 200);
    const workbenchFlowBody = workbenchFlowResponse.json() as {
      flow: { id: string };
      runs: Array<{ status: string }>;
    };
    assert.equal(workbenchFlowBody.flow.id, connectorId);
    assert.ok(workbenchFlowBody.runs.length >= 2);

    const outputResponse = await app.inject({
      method: "GET",
      url: `/api/v1/ai-connectors/${connectorId}/output`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(outputResponse.statusCode, 200);
    const outputBody = outputResponse.json() as {
      connector: { slug: string };
      output: { primaryText: string };
    };
    assert.equal(outputBody.connector.slug, connectorSlug);
    assert.match(outputBody.output.primaryText, /processor-output/);

    const runsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/ai-connectors/${connectorId}/runs`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(runsResponse.statusCode, 200);
    const runsBody = runsResponse.json() as {
      runs: Array<{ status: string; result: { primaryText: string } }>;
    };
    assert.ok(runsBody.runs.length >= 2);
    assert.equal(runsBody.runs[0]?.status, "completed");
    assert.match(runsBody.runs[0]?.result.primaryText ?? "", /processor-output/);

    const bySlugResponse = await app.inject({
      method: "GET",
      url: `/api/v1/ai-connectors/by-slug/${connectorSlug}`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(bySlugResponse.statusCode, 200);

    const workbenchBySlugResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/by-slug/${connectorSlug}`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(workbenchBySlugResponse.statusCode, 200);
    const workbenchBySlugBody = workbenchBySlugResponse.json() as {
      flow: { id: string };
    };
    assert.equal(workbenchBySlugBody.flow.id, connectorId);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("surface layouts round-trip through the surface layout routes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-surface-layout-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/surfaces/overview/layout",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        order: ["hero", "summary"],
        widgets: {
          hero: {
            hidden: false,
            titleVisible: false,
            descriptionVisible: false,
            fullWidth: true
          },
          summary: {
            hidden: true,
            titleVisible: true,
            descriptionVisible: true,
            fullWidth: false
          }
        }
      }
    });
    assert.equal(saveResponse.statusCode, 200);

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/v1/surfaces/overview/layout",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(getResponse.statusCode, 200);
    const body = getResponse.json() as {
      layout: {
        surfaceId: string;
        order: string[];
        widgets: {
          hero: {
            titleVisible: boolean;
            fullWidth: boolean;
          };
        };
      };
    };
    assert.equal(body.layout.surfaceId, "overview");
    assert.deepEqual(body.layout.order, ["hero", "summary"]);
    assert.equal(body.layout.widgets.hero.titleVisible, false);
    assert.equal(body.layout.widgets.hero.fullWidth, true);

    const resetResponse = await app.inject({
      method: "POST",
      url: "/api/v1/surfaces/overview/layout/reset",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(resetResponse.statusCode, 200);
  } finally {
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
