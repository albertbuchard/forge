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
import type { ModeGuideDraft } from "@/components/psyche/mode-guide-model";
import { PsycheModeGuidePage } from "@/pages/psyche-mode-guide-page";

const { createModeGuideSessionMock, listModeGuideSessionsMock } = vi.hoisted(
  () => ({
    createModeGuideSessionMock: vi.fn(),
    listModeGuideSessionsMock: vi.fn()
  })
);

vi.mock("@/lib/api", () => ({
  createModeGuideSession: createModeGuideSessionMock,
  listModeGuideSessions: listModeGuideSessionsMock
}));

vi.mock("@/components/flows/question-flow-dialog", () => ({
  FlowChoiceGrid: () => null,
  FlowField: ({ children }: { children: React.ReactNode }) => children,
  QuestionFlowDialog: ({
    open,
    value,
    onChange,
    onSubmit
  }: {
    open: boolean;
    value: ModeGuideDraft;
    onChange: (value: ModeGuideDraft) => void;
    onSubmit: () => Promise<void>;
  }) =>
    open ? (
      <div role="dialog" aria-label="Mode guide test flow">
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              summary: "I felt shut out and went quiet.",
              interpretationStance: "uncertain",
              nextResponse: "pause",
              saveDecision: "defer"
            })
          }
        >
          Choose defer
        </button>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              summary: "I felt shut out and went quiet.",
              copingResponse: "detach",
              childState: "vulnerable",
              interpretationStance: "partly",
              correction: "I was also trying not to escalate.",
              nextResponse: "set_boundary",
              saveDecision: "save"
            })
          }
        >
          Choose corrected save
        </button>
        <button type="button" onClick={() => void onSubmit()}>
          Finish flow
        </button>
      </div>
    ) : null
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <nav>Psyche navigation</nav>
}));

vi.mock("@/components/psyche/use-psyche-focus-target", () => ({
  psycheFocusClass: () => "",
  usePsycheFocusTarget: () => undefined
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    actions
  }: {
    title: string;
    description: string;
    actions?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  )
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
      <MemoryRouter initialEntries={["/psyche/modes/guide"]}>
        <PsycheModeGuidePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openGuide() {
  const buttons = await screen.findAllByRole("button", {
    name: "Start guided reflection"
  });
  fireEvent.click(buttons[0]);
}

beforeEach(() => {
  listModeGuideSessionsMock.mockResolvedValue({ sessions: [] });
  createModeGuideSessionMock.mockResolvedValue({
    session: {
      id: "guide-saved",
      summary: "I felt shut out and went quiet.",
      answers: [],
      results: [],
      createdAt: "2026-07-11T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z"
    }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PsycheModeGuidePage", () => {
  it("defers without an API write", async () => {
    renderPage();
    await openGuide();

    fireEvent.click(screen.getByRole("button", { name: "Choose defer" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish flow" }));

    expect(createModeGuideSessionMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/closed without saving a Psyche record/i)
    ).toBeInTheDocument();
  });

  it("saves a corrected hypothesis only after explicit consent", async () => {
    renderPage();
    await openGuide();

    fireEvent.click(
      screen.getByRole("button", { name: "Choose corrected save" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Finish flow" }));

    await waitFor(() => expect(createModeGuideSessionMock).toHaveBeenCalled());
    expect(createModeGuideSessionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        summary: "I felt shut out and went quiet.",
        answers: expect.arrayContaining([
          { questionKey: "coping_response", value: "detach" },
          { questionKey: "interpretation_stance", value: "partly" },
          {
            questionKey: "user_correction",
            value: "I was also trying not to escalate."
          },
          { questionKey: "next_response", value: "set_boundary" }
        ])
      })
    );
    expect(
      await screen.findByText(/remains a tentative reading/i)
    ).toBeInTheDocument();
  });
});
