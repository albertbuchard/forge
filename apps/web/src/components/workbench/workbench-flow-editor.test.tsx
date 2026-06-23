import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConnector, AiConnectorRun, ForgeBoxCatalogEntry } from "@/lib/types";
import { WorkbenchFlowEditor } from "@/components/workbench/workbench-flow-editor";

const mockRunNodesQuery = vi.fn();
const mockRunNodeQuery = vi.fn();

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Background: () => null,
  Handle: () => <div />,
  Position: {
    Left: "left",
    Right: "right",
    Top: "top",
    Bottom: "bottom"
  },
  addEdge: (edge: unknown, current: unknown[]) => [...current, edge],
  applyEdgeChanges: (_changes: unknown, current: unknown[]) => current,
  applyNodeChanges: (_changes: unknown, current: unknown[]) => current
}));

vi.mock("@/components/flows/question-flow-dialog", () => ({
  FlowField: ({
    label,
    description,
    children
  }: {
    label: string;
    description?: string;
    children: React.ReactNode;
  }) => (
    <label>
      <div>{label}</div>
      {description ? <div>{description}</div> : null}
      {children}
    </label>
  ),
  QuestionFlowDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div>{title}</div> : null
}));

vi.mock("@/components/workbench/workbench-provider", () => ({
  useWorkbenchNodeDefinition: () => null
}));

vi.mock("@/store/api/forge-api", () => ({
  useGetWorkbenchFlowRunNodesQuery: (...args: unknown[]) => mockRunNodesQuery(...args),
  useGetWorkbenchFlowRunNodeQuery: (...args: unknown[]) => mockRunNodeQuery(...args)
}));

const BASE_FLOW: AiConnector = {
  id: "flow_test",
  slug: "flow-test",
  title: "Workbench Test Flow",
  description: "Flow under test",
  kind: "functor",
  homeSurfaceId: "overview",
  endpointEnabled: true,
  graph: {
    nodes: [
      {
        id: "node_box",
        type: "box_input",
        position: { x: 60, y: 120 },
        data: {
          label: "Project search",
          description: "Structured project search context",
          boxId: "surface:projects:search-results",
          enabledToolKeys: []
        }
      },
      {
        id: "node_output",
        type: "output",
        position: { x: 360, y: 120 },
        data: {
          label: "Output",
          description: "Published output",
          outputKey: "summary",
          enabledToolKeys: [],
          inputs: [
            {
              key: "result",
              label: "Published result",
              kind: "record",
              required: false,
              expandableKeys: [],
              shape: []
            }
          ],
          outputs: []
        }
      }
    ],
    edges: [
      {
        id: "edge_1",
        source: "node_box",
        target: "node_output",
        sourceHandle: "summary",
        targetHandle: "result",
        label: null
      }
    ]
  },
  publicInputs: [
    {
      key: "topic",
      label: "Topic",
      description: "The topic to search for.",
      kind: "text",
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
  publishedOutputs: [
    {
      id: "flow_test_out_1",
      nodeId: "node_output",
      label: "Output",
      apiPath: "/api/v1/workbench/flows/flow_test/output"
    }
  ],
  lastRun: null,
  legacyProcessorId: null,
  createdAt: "2026-04-10T10:00:00.000Z",
  updatedAt: "2026-04-10T10:00:00.000Z"
};

const BASE_BOXES: ForgeBoxCatalogEntry[] = [
  {
    id: "surface:projects:search-results",
    boxId: "surface:projects:search-results",
    surfaceId: "projects",
    routePath: "/projects",
    title: "Projects search",
    label: "Projects search",
    icon: null,
    description: "Project search results",
    category: "Projects",
    tags: ["project", "search"],
    capabilityModes: ["content"],
    inputs: [
      {
        key: "query",
        label: "Query",
        kind: "text",
        required: false,
        expandableKeys: [],
        shape: []
      }
    ],
    params: [],
    output: [
      {
        key: "summary",
        label: "Summary",
        kind: "summary",
        required: false,
        expandableKeys: [],
        shape: []
      }
    ],
    tools: [],
    outputs: [
      {
        key: "summary",
        label: "Summary",
        kind: "summary",
        required: false,
        expandableKeys: [],
        shape: []
      }
    ],
    toolAdapters: [],
    snapshotResolverKey: undefined
  }
];

function renderEditor(input?: {
  flow?: AiConnector;
  runs?: AiConnectorRun[];
  onRun?: ReturnType<typeof vi.fn>;
  onChat?: ReturnType<typeof vi.fn>;
}) {
  const onRun = input?.onRun ?? vi.fn().mockResolvedValue(undefined);
  const onChat = input?.onChat ?? vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <WorkbenchFlowEditor
        flow={input?.flow ?? BASE_FLOW}
        boxes={BASE_BOXES}
        modelConnections={[]}
        runs={input?.runs ?? []}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onRun={onRun}
        onChat={onChat}
      />
    </MemoryRouter>
  );
  return { onRun, onChat };
}

describe("WorkbenchFlowEditor", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockRunNodesQuery.mockReturnValue({
      data: {
        nodeResults: [
          {
            nodeId: "node_box",
            nodeType: "box",
            label: "Project search",
            outputMap: {
              summary: {
                text: "Project summary",
                json: {
                  summary: "Project summary"
                }
              }
            }
          }
        ]
      },
      isFetching: false
    });
    mockRunNodeQuery.mockReturnValue({
      data: {
        nodeResult: {
          nodeId: "node_box",
          nodeType: "box",
          label: "Project search",
          input: [],
          payload: {
            summary: "Project summary"
          },
          outputMap: {
            summary: {
              text: "Project summary",
              json: {
                summary: "Project summary"
              }
            }
          },
          tools: [],
          logs: []
        }
      }
    });
  });

  it("renders typed public inputs in the Run modal and submits them through onRun", async () => {
    const { onRun } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Run flow" }));

    expect(await screen.findByText("Flow inputs")).toBeInTheDocument();
    const topicInput = screen.getByPlaceholderText("Topic");
    fireEvent.change(topicInput, { target: { value: "missed habits" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(onRun).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: {
            topic: "missed habits"
          }
        })
      )
    );
  });

  it("surfaces required public input validation before running", async () => {
    const { onRun } = renderEditor();

    fireEvent.click(screen.getAllByRole("button", { name: "Run flow" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));

    const validationMessages = await screen.findAllByText((_, element) =>
      element?.textContent?.includes('Flow input "Topic" must match the text type.') ?? false
    );
    expect(validationMessages.length).toBeGreaterThan(0);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("shows stable node results inside the run inspector", async () => {
    renderEditor({
      runs: [
        {
          id: "run_1",
          connectorId: "flow_test",
          mode: "run",
          status: "completed",
          userInput: "",
          inputs: {
            topic: "missed habits"
          },
          context: {},
          conversationId: null,
          result: {
            primaryText: "Project summary",
            outputs: {
              answer: {
                label: "Answer",
                text: "Project summary",
                json: {
                  summary: "Project summary"
                }
              }
            },
            nodeResults: [
              {
                nodeId: "node_box",
                nodeType: "box",
                label: "Project search",
                input: [],
                primaryText: "Project summary",
                payload: {
                  summary: "Project summary"
                },
                outputMap: {
                  summary: {
                    text: "Project summary",
                    json: {
                      summary: "Project summary"
                    }
                  }
                },
                tools: [],
                logs: [],
                error: null,
                timingMs: 12
              }
            ]
          },
          error: null,
          createdAt: "2026-04-10T10:05:00.000Z",
          completedAt: "2026-04-10T10:05:01.000Z"
        }
      ]
    });

    fireEvent.click(screen.getByRole("button", { name: /Latest run · completed/i }));

    expect(await screen.findByText("Run inspector")).toBeInTheDocument();
    expect(await screen.findByText("Node results")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Project search/i }));
    expect(await screen.findByText("Output map")).toBeInTheDocument();
    expect(await screen.findAllByText("Project summary")).not.toHaveLength(0);
  });
});
