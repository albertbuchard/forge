import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

function createFlow(id: string, title: string) {
  return {
    id,
    title,
    description: `${title} description`,
    kind: "functor",
    homeSurfaceId: "projects",
    graph: { nodes: [], edges: [] }
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
    tools: [],
    toolAdapters: []
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WorkbenchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkbenchFlowsMock.mockResolvedValue({
      flows: [createFlow("flow_1", "Project brief")]
    });
    listWorkbenchBoxCatalogMock.mockResolvedValue({
      boxes: Array.from({ length: 25 }, (_, index) => createBox(index + 1))
    });
  });

  it("browses a bounded node-box catalog and searches typed contracts", async () => {
    renderPage();

    expect(await screen.findByText("Project brief")).toBeInTheDocument();
    const flowsButton = screen.getByRole("button", { name: "Flows" });
    const boxesButton = screen.getByRole("button", { name: "Node boxes" });
    expect(flowsButton).toHaveAttribute("aria-pressed", "true");
    expect(boxesButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(boxesButton);
    expect(flowsButton).toHaveAttribute("aria-pressed", "false");
    expect(boxesButton).toHaveAttribute("aria-pressed", "true");

    expect(await screen.findByText("Node box 1")).toBeInTheDocument();
    expect(screen.queryByText("Node box 25")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(screen.getByText("Node box 25")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search box title, route, tags, or typed ports"
      ),
      { target: { value: "risk" } }
    );
    expect(screen.getByText("Node box 3")).toBeInTheDocument();
    expect(screen.queryByText("Node box 1")).not.toBeInTheDocument();
  }, 10_000);

  it("opens guided creation without writing a placeholder flow", async () => {
    renderPage();

    await screen.findByText("Project brief");
    fireEvent.click(screen.getByRole("button", { name: "New chat flow" }));

    expect(screen.getByText("Create flow guide")).toBeInTheDocument();
    expect(createWorkbenchFlowMock).not.toHaveBeenCalled();
  });

  it("shows a retryable catalog error and recovers from it", async () => {
    listWorkbenchBoxCatalogMock
      .mockRejectedValueOnce(new Error("Workbench is offline"))
      .mockResolvedValueOnce({ boxes: [createBox(1, "Recovered box")] });
    renderPage();

    await screen.findByText("Project brief");
    fireEvent.click(screen.getByRole("button", { name: "Node boxes" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByText("Recovered box")).toBeInTheDocument()
    );
  });
});
