import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PsycheSchemasBeliefsPage } from "@/pages/psyche-schemas-beliefs-page";

const { createBeliefMock, useForgeShellMock, useQueryMock } = vi.hoisted(
  () => ({
    createBeliefMock: vi.fn(),
    useForgeShellMock: vi.fn(),
    useQueryMock: vi.fn()
  })
);

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query"
  );
  return {
    ...actual,
    useQuery: useQueryMock
  };
});

vi.mock("@/lib/api", () => ({
  createBehavior: vi.fn(),
  createBelief: createBeliefMock,
  createMode: vi.fn(),
  createPsycheValue: vi.fn(),
  createTriggerReport: vi.fn(),
  listBehaviors: vi.fn(),
  listBeliefs: vi.fn(),
  listModes: vi.fn(),
  listPsycheValues: vi.fn(),
  listSchemaCatalog: vi.fn(),
  listTriggerReports: vi.fn(),
  patchBelief: vi.fn()
}));

function createQueryResult(data: Record<string, unknown>) {
  return {
    data,
    error: null,
    isLoading: false,
    refetch: vi.fn()
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/psyche/schemas-beliefs?create=1"]}>
        <PsycheSchemasBeliefsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PsycheSchemasBeliefsPage belief formulation consent", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      snapshot: {
        users: [],
        dashboard: { notesSummaryByEntity: {} }
      }
    });
    useQueryMock.mockImplementation((options: { queryKey: string[] }) => {
      switch (options.queryKey[0]) {
        case "forge-psyche-schema-catalog":
          return createQueryResult({ schemas: [] });
        case "forge-psyche-beliefs":
          return createQueryResult({ beliefs: [] });
        case "forge-psyche-behaviors":
          return createQueryResult({ behaviors: [] });
        case "forge-psyche-modes":
          return createQueryResult({ modes: [] });
        case "forge-psyche-values":
          return createQueryResult({ values: [] });
        case "forge-psyche-reports":
          return createQueryResult({ reports: [] });
        default:
          return createQueryResult({});
      }
    });
    createBeliefMock.mockResolvedValue({ belief: { id: "belief-1" } });
  });

  it("preserves wording and mixed evidence, and requires renewed consent after edits", async () => {
    renderPage();

    const statement =
      "When they go quiet, I think: 'I've done something wrong.'";
    fireEvent.change(
      await screen.findByPlaceholderText(
        "If they go quiet, I am already being left."
      ),
      { target: { value: `  ${statement}  ` } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const sharedEvent = "They did not reply that evening";
    fireEvent.change(
      await screen.findByPlaceholderText(/They stopped replying/),
      {
        target: { value: `${sharedEvent}\nI felt tense immediately` }
      }
    );
    fireEvent.change(screen.getByPlaceholderText(/They later explained/), {
      target: {
        value: `${sharedEvent}\nThey explained the next morning that work ran late`
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(statement)).toBeInTheDocument();
    expect(
      screen.getByText(/Grip and evidence remain your current assessment/i)
    ).toBeInTheDocument();

    const alternative =
      "Maybe their silence is about their evening, not a verdict on me.";
    const alternativeInput = await screen.findByPlaceholderText(
      "Silence can mean many things. I can check the facts before deciding I am being left."
    );
    fireEvent.change(alternativeInput, { target: { value: alternative } });

    fireEvent.click(screen.getByRole("button", { name: "Create belief" }));
    expect(
      await screen.findByText(/consent to its current wording before saving/i)
    ).toBeInTheDocument();
    expect(createBeliefMock).not.toHaveBeenCalled();

    const consent = screen.getByRole("checkbox", {
      name: /I consent to save this as my formulation/i
    });
    fireEvent.click(consent);
    expect(consent).toBeChecked();

    fireEvent.change(alternativeInput, {
      target: { value: `${alternative} I can ask before deciding.` }
    });
    expect(consent).not.toBeChecked();

    fireEvent.click(consent);
    fireEvent.click(screen.getByRole("button", { name: "Create belief" }));

    await waitFor(() => {
      expect(createBeliefMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statement,
          confidence: 60,
          evidenceFor: [sharedEvent, "I felt tense immediately"],
          evidenceAgainst: [
            sharedEvent,
            "They explained the next morning that work ran late"
          ],
          flexibleAlternative: `${alternative} I can ask before deciding.`
        })
      );
    });
  });
});
