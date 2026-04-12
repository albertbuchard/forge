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

test("workbench flows can be created, run, and expose published outputs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-ai-proc-"));
  const previousMockEnv = process.env.FORGE_ENABLE_DEV_MOCKS;
  process.env.FORGE_ENABLE_DEV_MOCKS = "1";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

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
        label: "Workbench Mock",
        provider: "mock",
        model: "mock-echo"
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
      url: "/api/v1/workbench/flows",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        title: "Test connector",
        description: "Connector under test",
        kind: "functor",
        homeSurfaceId: "overview",
        publicInputs: [
          {
            key: "query",
            label: "Query",
            kind: "text",
            description: "Search text for the project search node.",
            required: true,
            bindings: [
              {
                nodeId: "node_box",
                targetKey: "query",
                targetKind: "input"
              }
            ]
          }
        ],
        graph: {
          nodes: [
            {
              id: "node_box",
              type: "box_input",
              position: { x: 80, y: 120 },
              data: {
                label: "Project search",
                description: "Structured project search context",
                boxId: "surface:projects:search-results",
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
                  provider: "mock",
                  baseUrl: "mock://workbench",
                  model: "mock-echo",
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
                outputKey: "answer"
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
      flow: { id: string; slug: string; publishedOutputs: Array<{ id: string }> };
    };
    const connectorId = connectorBody.flow.id;
    const connectorSlug = connectorBody.flow.slug;
    assert.equal(connectorBody.flow.publishedOutputs.length, 1);

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
      boxes: Array<{ id: string; output?: Array<{ key: string; kind: string }> }>;
    };
    assert.ok(
      workbenchCatalogBody.boxes.some(
        (entry) => entry.id === "surface:utility:quick-capture"
      )
    );
    const taskInboxEntry = workbenchCatalogBody.boxes.find(
      (entry) => entry.id === "surface:tasks:inbox"
    );
    assert.ok(taskInboxEntry);
    assert.deepEqual(
      taskInboxEntry.output?.map((entry) => entry.key),
      ["summary", "matches", "matchCount"]
    );

    const runResponse = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${connectorId}/run`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        inputs: {
          query: "project"
        }
      }
    });
    assert.equal(runResponse.statusCode, 200);
    const runBody = runResponse.json() as {
      flow: { id: string };
      run: { id: string; result: { primaryText: string; nodeResults: Array<{ nodeId: string }> } };
    };
    assert.equal(runBody.flow.id, connectorId);
    assert.match(runBody.run.result.primaryText, /Mock consumed linked inputs/);
    assert.ok(runBody.run.result.nodeResults.some((entry) => entry.nodeId === "node_functor"));

    const workbenchRunResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/run",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        flowId: connectorId,
        inputs: {
          query: "focus"
        },
        debug: true
      }
    });
    assert.equal(workbenchRunResponse.statusCode, 200);
    const workbenchRunBody = workbenchRunResponse.json() as {
      flow: { id: string };
      run: {
        id: string;
        result: {
          primaryText: string;
          debugTrace?: { nodes: Array<{ nodeId: string }> };
          nodeResults: Array<{ nodeId: string; outputMap: Record<string, { text: string }> }>;
        };
      };
    };
    assert.equal(workbenchRunBody.flow.id, connectorId);
    assert.match(workbenchRunBody.run.result.primaryText, /Mock consumed linked inputs/);
    assert.ok((workbenchRunBody.run.result.debugTrace?.nodes.length ?? 0) >= 1);
    assert.ok(workbenchRunBody.run.result.nodeResults.length >= 2);

    const runDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${connectorId}/runs/${workbenchRunBody.run.id}`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(runDetailResponse.statusCode, 200);
    const runDetailBody = runDetailResponse.json() as {
      run: { id: string; inputs: Record<string, unknown> };
    };
    assert.equal(runDetailBody.run.id, workbenchRunBody.run.id);
    assert.equal(runDetailBody.run.inputs.query, "focus");

    const runNodesResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${connectorId}/runs/${workbenchRunBody.run.id}/nodes`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(runNodesResponse.statusCode, 200);
    const runNodesBody = runNodesResponse.json() as {
      nodeResults: Array<{ nodeId: string; input: Array<{ targetHandle: string | null }> }>;
    };
    assert.ok(runNodesBody.nodeResults.some((entry) => entry.nodeId === "node_functor"));

    const functorNodeResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${connectorId}/runs/${workbenchRunBody.run.id}/nodes/node_functor`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(functorNodeResponse.statusCode, 200);
    const functorNodeBody = functorNodeResponse.json() as {
      nodeResult: {
        nodeId: string;
        outputMap: Record<string, { text: string }>;
      };
    };
    assert.equal(functorNodeBody.nodeResult.nodeId, "node_functor");
    assert.ok(functorNodeBody.nodeResult.outputMap.answer?.text);

    const latestNodeOutputResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${connectorId}/nodes/node_functor/output`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(latestNodeOutputResponse.statusCode, 200);
    const latestNodeOutputBody = latestNodeOutputResponse.json() as {
      nodeResult: { nodeId: string };
    };
    assert.equal(latestNodeOutputBody.nodeResult.nodeId, "node_functor");

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
      flow: { id: string; graph?: { nodes?: Array<{ type: string; data: { outputKey?: string } }> } };
      runs: Array<{ status: string }>;
    };
    assert.equal(workbenchFlowBody.flow.id, connectorId);
    assert.ok(workbenchFlowBody.runs.length >= 2);
    const outputNode = workbenchFlowBody.flow.graph?.nodes?.find(
      (node) => node.type === "output"
    );
    assert.equal(outputNode?.data.outputKey, "answer");

    const outputResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${connectorId}/output`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(outputResponse.statusCode, 200);
    const outputBody = outputResponse.json() as {
      flow: { slug: string };
      output: { primaryText: string; outputs?: Record<string, { text: string; json: Record<string, unknown> | null }> };
    };
    assert.equal(outputBody.flow.slug, connectorSlug);
    assert.match(outputBody.output.primaryText, /Mock consumed linked inputs/);
    const published = Object.values(outputBody.output.outputs ?? {})[0];
    assert.ok(published);
    assert.match(published?.text ?? "", /Mock consumed linked inputs/);

    const runsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${connectorId}/runs`,
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
    assert.match(runsBody.runs[0]?.result.primaryText ?? "", /Mock consumed linked inputs/);

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
    if (previousMockEnv === undefined) {
      delete process.env.FORGE_ENABLE_DEV_MOCKS;
    } else {
      process.env.FORGE_ENABLE_DEV_MOCKS = previousMockEnv;
    }
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("workbench mock chat flows keep conversation continuity and validate required inputs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-workbench-chat-"));
  const previousMockEnv = process.env.FORGE_ENABLE_DEV_MOCKS;
  process.env.FORGE_ENABLE_DEV_MOCKS = "1";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

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
        label: "Mock chat",
        provider: "mock",
        model: "mock-chat-memory"
      }
    });
    assert.equal(connectionResponse.statusCode, 201);
    const connectionId = (
      connectionResponse.json() as { connection: { id: string } }
    ).connection.id;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        title: "Mock chat flow",
        description: "Chat memory test",
        kind: "chat",
        publicInputs: [
          {
            key: "topic",
            label: "Topic",
            kind: "text",
            required: true,
            bindings: []
          }
        ],
        graph: {
          nodes: [
            {
              id: "chat_node",
              type: "chat",
              position: { x: 140, y: 120 },
              data: {
                label: "Chat",
                description: "Mock chat node",
                prompt: "Answer using the current conversation state.",
                inputs: [
                  {
                    key: "topic",
                    label: "Topic",
                    kind: "text"
                  }
                ],
                modelConfig: {
                  connectionId,
                  provider: "mock",
                  baseUrl: "mock://workbench",
                  model: "mock-chat-memory",
                  thinking: null,
                  verbosity: null
                }
              }
            },
            {
              id: "out",
              type: "output",
              position: { x: 420, y: 120 },
              data: {
                label: "Output",
                description: "Chat output",
                outputKey: "answer"
              }
            }
          ],
          edges: [
            {
              id: "chat_out",
              source: "chat_node",
              target: "out",
              sourceHandle: "answer",
              targetHandle: "answer",
              label: null
            }
          ]
        }
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const flowId = (createResponse.json() as { flow: { id: string } }).flow.id;

    const missingInputResponse = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/chat`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userInput: "hello"
      }
    });
    assert.equal(missingInputResponse.statusCode, 500);
    assert.equal(
      (missingInputResponse.json() as { error: string }).error,
      'Flow input "Topic" is required.'
    );

    const firstChatResponse = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/chat`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userInput: "hello",
        inputs: {
          topic: "habits"
        }
      }
    });
    assert.equal(firstChatResponse.statusCode, 200);
    const firstChatBody = firstChatResponse.json() as {
      conversation: { id: string } | null;
      run: { result: { primaryText: string } };
    };
    assert.ok(firstChatBody.conversation?.id);
    assert.match(firstChatBody.run.result.primaryText, /Starting a fresh conversation/);

    const secondChatResponse = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/chat`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userInput: "continue",
        conversationId: firstChatBody.conversation?.id ?? null,
        inputs: {
          topic: "habits"
        }
      }
    });
    assert.equal(secondChatResponse.statusCode, 200);
    const secondChatBody = secondChatResponse.json() as {
      run: { result: { primaryText: string } };
    };
    assert.match(secondChatBody.run.result.primaryText, /remember our earlier exchange/);
  } finally {
    if (previousMockEnv === undefined) {
      delete process.env.FORGE_ENABLE_DEV_MOCKS;
    } else {
      process.env.FORGE_ENABLE_DEV_MOCKS = previousMockEnv;
    }
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("workbench mock tool flows expose stable node results", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-workbench-tools-"));
  const previousMockEnv = process.env.FORGE_ENABLE_DEV_MOCKS;
  process.env.FORGE_ENABLE_DEV_MOCKS = "1";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

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
        label: "Mock tool",
        provider: "mock",
        model: "mock-tool-note"
      }
    });
    assert.equal(connectionResponse.statusCode, 201);
    const connectionId = (
      connectionResponse.json() as { connection: { id: string } }
    ).connection.id;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        title: "Mock tool flow",
        description: "Tool loop test",
        kind: "functor",
        graph: {
          nodes: [
            {
              id: "box_node",
              type: "box_input",
              position: { x: 60, y: 120 },
              data: {
                label: "Quick capture",
                description: "Provides note creation tool",
                boxId: "surface:utility:quick-capture"
              }
            },
            {
              id: "tool_node",
              type: "functor",
              position: { x: 340, y: 120 },
              data: {
                label: "Tool node",
                description: "Invokes a mock tool",
                prompt: "Create a note when helpful.",
                enabledToolKeys: ["forge.create_note"],
                modelConfig: {
                  connectionId,
                  provider: "mock",
                  baseUrl: "mock://workbench",
                  model: "mock-tool-note",
                  thinking: null,
                  verbosity: null
                }
              }
            },
            {
              id: "out",
              type: "output",
              position: { x: 620, y: 120 },
              data: {
                label: "Output",
                description: "Published output",
                outputKey: "answer"
              }
            }
          ],
          edges: [
            {
              id: "box_tool",
              source: "box_node",
              target: "tool_node",
              sourceHandle: "summary",
              targetHandle: "input",
              label: null
            },
            {
              id: "tool_out",
              source: "tool_node",
              target: "out",
              sourceHandle: "answer",
              targetHandle: "answer",
              label: null
            }
          ]
        }
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const flowId = (createResponse.json() as { flow: { id: string } }).flow.id;

    const runResponse = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        debug: true
      }
    });
    assert.equal(runResponse.statusCode, 200);
    const runBody = runResponse.json() as {
      run: {
        id: string;
        result: {
          primaryText: string;
          nodeResults: Array<{ nodeId: string; tools: string[]; logs: string[] }>;
        };
      };
    };
    assert.match(runBody.run.result.primaryText, /Created a mock note/);
    const toolNode = runBody.run.result.nodeResults.find((entry) => entry.nodeId === "tool_node");
    assert.ok(toolNode);
    assert.deepEqual(toolNode?.tools, ["forge.create_note"]);
    assert.ok(toolNode?.logs.some((entry) => entry.includes("Tool call forge.create_note")));
  } finally {
    if (previousMockEnv === undefined) {
      delete process.env.FORGE_ENABLE_DEV_MOCKS;
    } else {
      process.env.FORGE_ENABLE_DEV_MOCKS = previousMockEnv;
    }
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

test("legacy workbench flow contracts normalize stale primary handles and content kinds", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-workbench-legacy-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        title: "Legacy habit flow",
        description: "Old contract graph",
        kind: "functor",
        homeSurfaceId: "habits",
        graph: {
          nodes: [
            {
              id: "node_box",
              type: "box_input",
              position: { x: 80, y: 120 },
              data: {
                label: "Habits summary",
                description: "Legacy box",
                boxId: "surface:habits:summary",
                outputs: [
                  {
                    key: "primary",
                    label: "Primary",
                    kind: "content"
                  }
                ]
              }
            },
            {
              id: "node_functor",
              type: "functor",
              position: { x: 360, y: 120 },
              data: {
                label: "Legacy functor",
                description: "Legacy AI node",
                prompt: "Summarize",
                outputs: [
                  {
                    key: "primary",
                    label: "Primary",
                    kind: "content"
                  }
                ]
              }
            },
            {
              id: "node_output",
              type: "output",
              position: { x: 680, y: 120 },
              data: {
                label: "Output",
                description: "Legacy output",
                outputKey: "primary",
                inputs: [
                  {
                    key: "primary",
                    label: "Primary",
                    kind: "content"
                  }
                ]
              }
            }
          ],
          edges: [
            {
              id: "edge_box_functor",
              source: "node_box",
              target: "node_functor",
              sourceHandle: "primary",
              targetHandle: null,
              label: null
            },
            {
              id: "edge_functor_output",
              source: "node_functor",
              target: "node_output",
              sourceHandle: "primary",
              targetHandle: "primary",
              label: null
            }
          ]
        }
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const body = createResponse.json() as { flow: { id: string } };

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${body.flow.id}`,
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(getResponse.statusCode, 200);
    const flowBody = getResponse.json() as {
      flow: {
        graph: {
          nodes: Array<{ id: string; type: string; data: { outputs?: Array<{ key: string; kind: string }>; outputKey?: string; inputs?: Array<{ key: string; kind: string }> } }>;
          edges: Array<{ sourceHandle: string | null; targetHandle: string | null }>;
        };
      };
    };
    const functorNode = flowBody.flow.graph.nodes.find((node) => node.id === "node_functor");
    const outputNode = flowBody.flow.graph.nodes.find((node) => node.id === "node_output");
    assert.equal(functorNode?.data.outputs?.[0]?.key, "answer");
    assert.equal(functorNode?.data.outputs?.[0]?.kind, "markdown");
    assert.equal(outputNode?.data.outputKey, "result");
    assert.equal(outputNode?.data.inputs?.[0]?.key, "result");
    assert.equal(outputNode?.data.inputs?.[0]?.kind, "record");
    assert.deepEqual(
      flowBody.flow.graph.edges.map((edge) => ({
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle
      })),
      [
        { sourceHandle: "summary", targetHandle: "input" },
        { sourceHandle: "answer", targetHandle: "result" }
      ]
    );
  } finally {
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
