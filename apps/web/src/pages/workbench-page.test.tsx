import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchPage } from "@/pages/workbench-page";

const {
  createWorkbenchFlowMock,
  listWorkbenchBoxCatalogMock,
  listWorkbenchFlowsMock
} = vi.hoisted(() => ({
  createWorkbenchFlowMock: vi.fn(),
  listWorkbenchBoxCatalogMock: vi.fn(),
  listWorkbenchFlowsMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createWorkbenchFlow: createWorkbenchFlowMock,
  listWorkbenchBoxCatalog: listWorkbenchBoxCatalogMock,
  listWorkbenchFlows: listWorkbenchFlowsMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ titleText, badge }: { titleText: string; badge: string }) => (
    <div>
      <h1>{titleText}</h1>
      <div>{badge}</div>
    </div>
  )
}));

vi.mock("@/components/workbench/workbench-create-flow-dialog", () => ({
  WorkbenchCreateFlowDialog: ({ open }: { open: boolean }) =>
    open ? <div>Create flow guide</div> : null
}));

afterEach(cleanup);

function createFlow(index: number, endpointEnabled = true) {
  const suffix = String(index).padStart(2, "0");
  return {
    id: `flow_${suffix}`,
    slug: `flow-${suffix}`,
    title: `Flow ${suffix}`,
    description: `Flow ${suffix} description`,
    descriptionTruncated: false,
    kind: index % 2 === 0 ? ("chat" as const) : ("functor" as const),
    homeSurfaceId: index % 2 === 0 ? "wiki" : "projects",
    endpointEnabled,
    status: endpointEnabled ? ("enabled" as const) : ("disabled" as const),
    nodeCount: index,
    edgeCount: Math.max(0, index - 1),
    publicInputCount: 1,
    publishedOutputCount: 1,
    lastRunStatus: index === 1 ? ("completed" as const) : null,
    lastRunAt: index === 1 ? "2026-07-16T12:00:00.000Z" : null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z"
  };
}

function flowPage(
  flows: ReturnType<typeof createFlow>[],
  total: number,
  offset = 0
) {
  return {
    flows,
    total,
    limit: 24,
    offset,
    hasMore: offset + flows.length < total,
    facets: {
      kinds: [
        { value: "functor", label: "Functor", count: Math.ceil(total / 2) },
        { value: "chat", label: "Chat", count: Math.floor(total / 2) }
      ],
      homeSurfaces: [
        { value: "projects", label: "projects", count: Math.ceil(total / 2) },
        { value: "wiki", label: "wiki", count: Math.floor(total / 2) }
      ],
      statuses: [
        { value: "enabled", label: "Endpoint enabled", count: total - 1 },
        { value: "disabled", label: "Endpoint disabled", count: 1 }
      ]
    }
  };
}

function createBox(index: number, title = `Node box ${index}`) {
  return {
    id: `box_${index}`,
    boxId: `box_${index}`,
    surfaceId: "projects",
    routePath: "/projects",
    title,
    label: title,
    icon: null,
    description: `${title} description`,
    category: index % 2 === 0 ? "Planning" : "Knowledge",
    tags: index === 3 ? ["risk"] : ["catalog"],
    capabilityModes: ["content" as const],
    inputs: [
      {
        key: "query",
        label: "Query",
        kind: "text" as const,
        description: "The exact search query.",
        required: true,
        expandableKeys: [],
        shape: []
      }
    ],
    params: [],
    output: [
      {
        key: "summary",
        label: "Summary",
        kind: "summary" as const,
        required: false,
        expandableKeys: [],
        shape: []
      }
    ],
    outputs: [
      {
        key: "summary",
        label: "Summary",
        kind: "summary" as const,
        required: false,
        expandableKeys: [],
        shape: []
      }
    ],
    tools: [
      {
        key: "search_projects",
        label: "Search projects",
        description: "Search the project catalog.",
        accessMode: "read" as const
      }
    ],
    toolAdapters: [],
    source: "forge" as const,
    sourceFlowId: null,
    sourceFlowEnabled: null
  };
}

function boxPage(
  boxes: ReturnType<typeof createBox>[],
  total: number,
  offset = 0
) {
  return {
    boxes,
    total,
    limit: 24,
    offset,
    hasMore: offset + boxes.length < total,
    facets: {
      categories: [
        { value: "Planning", label: "Planning", count: Math.floor(total / 2) },
        { value: "Knowledge", label: "Knowledge", count: Math.ceil(total / 2) }
      ],
      surfaces: [{ value: "projects", label: "projects", count: total }],
      sources: [
        { value: "forge", label: "Forge boxes", count: total },
        { value: "flow_output", label: "Flow outputs", count: 0 }
      ]
    }
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderPage(initialEntry = "/workbench") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <WorkbenchPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WorkbenchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkbenchFlowsMock.mockResolvedValue(
      flowPage([createFlow(1), createFlow(2, false)], 2)
    );
    listWorkbenchBoxCatalogMock.mockResolvedValue(boxPage([createBox(1)], 1));
  });

  it("loads only the active catalog and pages compact flow summaries", async () => {
    listWorkbenchFlowsMock.mockImplementation(
      ({ offset = 0 }: { offset?: number }) => {
        const allFlows = Array.from({ length: 49 }, (_, index) =>
          createFlow(index + 1, index !== 1)
        );
        return Promise.resolve(
          flowPage(allFlows.slice(offset, offset + 24), 49, offset)
        );
      }
    );
    renderPage();

    expect(await screen.findByText("Flow 01")).toBeInTheDocument();
    expect(listWorkbenchFlowsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 24, offset: 0 })
    );
    expect(listWorkbenchBoxCatalogMock).not.toHaveBeenCalled();
    expect(screen.getByText("49 flows")).toBeInTheDocument();
    expect(screen.queryByText("Flow 25")).not.toBeInTheDocument();
    expect(screen.getByText("Endpoint disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load 24 more" }));
    expect(await screen.findByText("Flow 48")).toBeInTheDocument();
    expect(screen.queryByText("Flow 49")).not.toBeInTheDocument();
    expect(listWorkbenchFlowsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 24 })
    );

    fireEvent.click(screen.getByRole("button", { name: "Load 1 more" }));
    expect(await screen.findByText("Flow 49")).toBeInTheDocument();
    expect(listWorkbenchFlowsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 48 })
    );
  });

  it("uses keyboard-operable tabs and loads the box catalog lazily", async () => {
    renderPage();

    await screen.findByText("Flow 01");
    const flowsTab = screen.getByRole("tab", { name: "Flows" });
    const boxesTab = screen.getByRole("tab", { name: "Node boxes" });
    expect(flowsTab).toHaveAttribute("aria-selected", "true");
    expect(boxesTab).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(flowsTab, { key: "ArrowRight" });
    expect(await screen.findByText("Node box 1")).toBeInTheDocument();
    expect(boxesTab).toHaveAttribute("aria-selected", "true");
    expect(listWorkbenchBoxCatalogMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Forge box")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Inspect full contract"));
    expect(screen.getByText("The exact search query.")).toBeInTheDocument();
    expect(screen.getByText("search_projects")).toBeInTheDocument();
  });

  it("keeps search and facet state in the URL and sends it to the API", async () => {
    renderPage();
    await screen.findByText("Flow 01");

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search flow title, description, node label, or home surface"
      ),
      { target: { value: "needle" } }
    );
    await waitFor(() =>
      expect(listWorkbenchFlowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "needle" })
      )
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent("q=needle");

    const searchInput = screen.getByPlaceholderText(
      "Search flow title, description, node label, or home surface"
    );
    fireEvent.change(searchInput, { target: { value: "" } });
    fireEvent.focus(searchInput);
    fireEvent.click(await screen.findByRole("option", { name: /Chat/ }));
    await waitFor(() =>
      expect(listWorkbenchFlowsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "", kinds: ["chat"] })
      )
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "filter=kind%3Achat"
    );
    expect(screen.getByTestId("location-search")).not.toHaveTextContent("q=");
  });

  it("restores a deep-linked box catalog without loading flows", async () => {
    renderPage("/workbench?catalog=boxes&q=risk&filter=source%3Aflow_output");

    expect(await screen.findByText("Node box 1")).toBeInTheDocument();
    expect(listWorkbenchFlowsMock).not.toHaveBeenCalled();
    expect(listWorkbenchBoxCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "risk", sources: ["flow_output"] })
    );
    expect(screen.getByRole("tab", { name: "Node boxes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("preserves loaded results when the next page fails and retries it", async () => {
    listWorkbenchFlowsMock.mockImplementation(
      ({ offset = 0 }: { offset?: number }) => {
        if (offset === 0) {
          return Promise.resolve(
            flowPage(
              Array.from({ length: 24 }, (_, index) => createFlow(index + 1)),
              25,
              0
            )
          );
        }
        if (listWorkbenchFlowsMock.mock.calls.length === 2) {
          return Promise.reject(new Error("Next page unavailable"));
        }
        return Promise.resolve(flowPage([createFlow(25)], 25, 24));
      }
    );
    renderPage();

    expect(await screen.findByText("Flow 01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load 1 more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Existing results are unchanged"
    );
    expect(screen.getByText("Flow 01")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry next page" }));
    expect(await screen.findByText("Flow 25")).toBeInTheDocument();
  });

  it("shows a retryable initial catalog failure and recovers", async () => {
    listWorkbenchFlowsMock
      .mockRejectedValueOnce(new Error("Workbench is offline"))
      .mockResolvedValueOnce(flowPage([createFlow(1)], 1));
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No flows available")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Flow 01")).toBeInTheDocument();
  });

  it("opens guided creation without writing a placeholder flow", async () => {
    renderPage();

    await screen.findByText("Flow 01");
    fireEvent.click(screen.getByRole("button", { name: "New chat flow" }));
    expect(screen.getByText("Create flow guide")).toBeInTheDocument();
    expect(createWorkbenchFlowMock).not.toHaveBeenCalled();
  });
});
