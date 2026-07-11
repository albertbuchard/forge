import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PsycheValuesPage } from "@/pages/psyche-values-page";

const {
  createPsycheValueMock,
  listPsycheValuesMock,
  patchPsycheValueMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  createPsycheValueMock: vi.fn(),
  listPsycheValuesMock: vi.fn(),
  patchPsycheValueMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createPsycheValue: createPsycheValueMock,
  listPsycheValues: listPsycheValuesMock,
  patchPsycheValue: patchPsycheValueMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ actions }: { actions?: React.ReactNode }) => (
    <header>{actions}</header>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => null
}));

vi.mock("@/components/psyche/orbit-map", () => ({
  OrbitMap: ({ action }: { action?: React.ReactNode }) => (
    <section>{action}</section>
  )
}));

vi.mock("@/components/psyche/atlas-panel", () => ({
  AtlasPanel: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  )
}));

vi.mock("@/components/psyche/use-psyche-focus-target", () => ({
  psycheFocusClass: () => "",
  usePsycheFocusTarget: () => undefined
}));

vi.mock("@/components/ui/user-select-field", () => ({
  UserSelectField: () => null
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/psyche/values"]}>
        <PsycheValuesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openCreateFlow() {
  const addButtons = await screen.findAllByRole("button", {
    name: "Add value"
  });
  fireEvent.click(addButtons[0]);
  await screen.findByText("Start with the words that feel true");
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  window.localStorage.clear();
  listPsycheValuesMock.mockResolvedValue({ values: [] });
  createPsycheValueMock.mockResolvedValue({ value: { id: "value-new" } });
  useForgeShellMock.mockReturnValue({
    selectedUserIds: [],
    snapshot: {
      users: [],
      goals: [],
      tasks: [],
      dashboard: { projects: [], notesSummaryByEntity: {} }
    }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("PsycheValuesPage guided value flow", () => {
  it("asks each required direction question when it becomes relevant", async () => {
    renderPage();
    await openCreateFlow();

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(
      screen.queryByLabelText(/which way do you want to move/i)
    ).not.toBeInTheDocument();
    expect(continueButton).toBeDisabled();
    expect(
      screen.getByText(
        "Use your own words to name what matters before continuing."
      )
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText(/^What matters here\?/), {
      target: { value: "Care without abandoning myself" }
    });

    const directionInput = screen.getByLabelText(
      /^When this gets difficult, which way do you want to move\?/
    );
    expect(continueButton).toBeDisabled();
    expect(
      screen.getByText(
        "Choose the direction you want to move when this gets difficult."
      )
    ).toBeVisible();

    fireEvent.change(directionInput, {
      target: { value: "Toward honesty and warmth, with a clear boundary" }
    });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    expect(
      await screen.findByText("Turn that direction into something you can live")
    ).toBeInTheDocument();
  });

  it("preserves multi-line action wording while typing and saves only stated actions", async () => {
    renderPage();
    await openCreateFlow();

    fireEvent.change(screen.getByLabelText(/^What matters here\?/), {
      target: { value: "Care, even when I am angry" }
    });
    fireEvent.change(
      screen.getByLabelText(
        /^When this gets difficult, which way do you want to move\?/
      ),
      { target: { value: "Speak plainly without becoming cruel" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const actionsInput = await screen.findByLabelText(
      /^What is one small action that would point this way\?/
    );
    const authoredActions =
      "Pause before replying in my exact words\n   \nAsk one honest question  ";
    fireEvent.change(actionsInput, { target: { value: authoredActions } });
    expect(actionsInput).toHaveValue(authoredActions);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create value" }));

    await waitFor(() => expect(createPsycheValueMock).toHaveBeenCalledTimes(1));
    expect(createPsycheValueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Care, even when I am angry",
        valuedDirection: "Speak plainly without becoming cruel",
        committedActions: [
          "Pause before replying in my exact words",
          "Ask one honest question"
        ]
      })
    );
  });
});
