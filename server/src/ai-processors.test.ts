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

test("ai processors can be created, linked, and run through the route endpoint", async () => {
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

    const processorResponse = await app.inject({
      method: "POST",
      url: "/api/v1/surfaces/workbench/ai-processors",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        title: "Test processor",
        promptFlow: "Write the final answer.",
        contextInput: "Use the linked widget data.",
        agentIds: ["agt_forge_default"]
      }
    });
    assert.equal(processorResponse.statusCode, 201);
    const processorBody = processorResponse.json() as {
      processor: { id: string; slug: string };
    };
    const processorId = processorBody.processor.id;
    const processorSlug = processorBody.processor.slug;

    const linkResponse = await app.inject({
      method: "POST",
      url: "/api/v1/ai-processor-links",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        surfaceId: "workbench",
        sourceWidgetId: "time",
        targetProcessorId: processorId,
        accessMode: "read",
        capabilityMode: "content",
        metadata: {
          widgetType: "time"
        }
      }
    });
    assert.equal(linkResponse.statusCode, 201);

    const graphResponse = await app.inject({
      method: "GET",
      url: "/api/v1/surfaces/workbench/ai-processors",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(graphResponse.statusCode, 200);
    const graph = graphResponse.json() as {
      graph: { processors: Array<{ id: string }>; links: Array<{ id: string }> };
    };
    assert.equal(graph.graph.processors.length, 1);
    assert.equal(graph.graph.links.length, 1);

    const runResponse = await app.inject({
      method: "POST",
      url: `/api/v1/aiproc/${processorSlug}/run`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        input: "run now"
      }
    });
    assert.equal(runResponse.statusCode, 200);
    const runBody = runResponse.json() as {
      output: { concatenated: string; byAgent: Record<string, string> };
    };
    assert.match(runBody.output.concatenated, /processor-output/);
    assert.ok(
      Object.values(runBody.output.byAgent).includes("processor-output")
    );

    const cycleResponse = await app.inject({
      method: "POST",
      url: "/api/v1/ai-processor-links",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        surfaceId: "workbench",
        sourceWidgetId: `aiproc:${processorId}`,
        targetProcessorId: processorId,
        accessMode: "read",
        capabilityMode: "processor",
        metadata: {}
      }
    });
    assert.equal(cycleResponse.statusCode, 500);
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
        layouts: {
          lg: [{ i: "hero", x: 0, y: 0, w: 12, h: 2 }],
          md: [{ i: "hero", x: 0, y: 0, w: 10, h: 2 }],
          sm: [{ i: "hero", x: 0, y: 0, w: 6, h: 2 }],
          xs: [{ i: "hero", x: 0, y: 0, w: 4, h: 2 }],
          xxs: [{ i: "hero", x: 0, y: 0, w: 2, h: 2 }]
        },
        widgets: {
          hero: {
            hidden: false,
            titleVisible: false,
            descriptionVisible: false,
            density: "dense"
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
        widgets: {
          hero: {
            titleVisible: boolean;
            density: string;
          };
        };
      };
    };
    assert.equal(body.layout.surfaceId, "overview");
    assert.equal(body.layout.widgets.hero.titleVisible, false);
    assert.equal(body.layout.widgets.hero.density, "dense");

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
