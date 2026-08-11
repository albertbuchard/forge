import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  FlashcardPreview,
  MAX_FLASHCARD_MESSAGE_CHARACTERS,
  PsycheFlashcardsPage,
  getFlashcardMessageClassName
} from "@/pages/psyche-flashcards-page";
import { flashcardSchema } from "@/lib/psyche-schemas";
import type { Flashcard, PsycheOverviewPayload } from "@/lib/psyche-types";

const {
  getPsycheOverviewMock,
  listFlashcardsMock,
  patchFlashcardMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  getPsycheOverviewMock: vi.fn(),
  listFlashcardsMock: vi.fn(),
  patchFlashcardMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createFlashcard: vi.fn(),
  deleteFlashcard: vi.fn(),
  getPsycheOverview: getPsycheOverviewMock,
  listFlashcards: listFlashcardsMock,
  patchFlashcard: patchFlashcardMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <h1>{title}</h1>
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => null
}));

vi.mock("@/components/psyche/use-psyche-focus-target", () => ({
  psycheFocusClass: () => "",
  usePsycheFocusTarget: () => undefined
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseCard: Flashcard = {
  id: "flashcard_recovery",
  domainId: "domain_psyche",
  title: "Recovery move",
  message: "This urge is a wave. Pause and choose the next useful action.",
  triggerSentence: "I need relief now.",
  triggerSituation: "Late evening after a difficult conversation.",
  tags: ["recovery"],
  backgroundColor: "#f8fafc",
  textColor: "#111827",
  accentColor: "#6ee7b7",
  typography: "serif",
  imageUrl: "https://example.test/shore.jpg",
  imageAlt: "A quiet shoreline after sunset",
  layout: "centered",
  visualStyle: "calm",
  linkedValueIds: ["value_recovery"],
  linkedBehaviorIds: [],
  linkedPatternIds: [],
  linkedBeliefIds: ["belief_out_of_scope"],
  linkedModeIds: [],
  linkedReportIds: [],
  createdAt: "2026-08-11T08:00:00.000Z",
  updatedAt: "2026-08-11T08:00:00.000Z",
  userId: "user_operator",
  user: null
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PsycheFlashcardsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PSY-08 flashcard retrieval", () => {
  it("fits long text, keeps both retrieval cues, and gives the image a useful name", () => {
    const longMessage = `Pause. ${"unbroken".repeat(48)}`;
    render(
      <FlashcardPreview card={{ ...baseCard, message: longMessage }} />
    );

    const message = screen.getByText(longMessage);
    expect(message).toHaveClass("break-words", "[overflow-wrap:anywhere]");
    expect(message).toHaveClass("text-lg", "sm:text-xl");
    expect(screen.getByText("Urge or cue:")).toBeInTheDocument();
    expect(screen.getByText("I need relief now.")).toBeInTheDocument();
    expect(screen.getByText("Situation:")).toBeInTheDocument();
    expect(
      screen.getByText("Late evening after a difficult conversation.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "A quiet shoreline after sunset" })
    ).toBeInTheDocument();
    expect(getFlashcardMessageClassName("Short recovery move")).toContain(
      "clamp"
    );
  });

  it("enforces the concise authoring envelope in the browser contract", () => {
    expect(
      flashcardSchema.parse({
        ...baseCard,
        message: "A".repeat(MAX_FLASHCARD_MESSAGE_CHARACTERS)
      }).message
    ).toHaveLength(MAX_FLASHCARD_MESSAGE_CHARACTERS);
    expect(() =>
      flashcardSchema.parse({
        ...baseCard,
        message: "A".repeat(MAX_FLASHCARD_MESSAGE_CHARACTERS + 1)
      })
    ).toThrow();
  });

  it("shows authorized linked records while hiding unavailable identifiers", async () => {
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: { users: [] }
    });
    listFlashcardsMock.mockResolvedValue({ flashcards: [baseCard] });
    getPsycheOverviewMock.mockResolvedValue({
      overview: {
        values: [
          {
            id: "value_recovery",
            title: "Recovery",
            valuedDirection: "Choose repair over avoidance"
          }
        ],
        patterns: [],
        behaviors: [],
        beliefs: [],
        modes: [],
        reports: []
      } as unknown as PsycheOverviewPayload
    });

    renderPage();

    const recoveryLink = await screen.findByRole("link", {
      name: "Values: Recovery"
    });
    expect(recoveryLink).toHaveAttribute(
      "href",
      "/psyche/values?focus=value_recovery#values-atlas"
    );
    expect(
      screen.getByText("1 linked record is unavailable in this view")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("belief_out_of_scope")).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByText(baseCard.message).closest("button")!);
    expect(
      await screen.findByRole("combobox", { name: "Link values…" })
    ).toBeInTheDocument();
    expect(screen.getByText("Unavailable linked record")).toBeInTheDocument();
    expect(screen.queryByText("belief_out_of_scope")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(baseCard.message)).toHaveAttribute(
      "maxlength",
      String(MAX_FLASHCARD_MESSAGE_CHARACTERS)
    );
  });

  it("allows an unrelated edit to a readable legacy long card", async () => {
    const legacyCard = { ...baseCard, message: "L".repeat(601) };
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: { users: [] }
    });
    listFlashcardsMock.mockResolvedValue({ flashcards: [legacyCard] });
    getPsycheOverviewMock.mockResolvedValue({
      overview: {
        values: [],
        patterns: [],
        behaviors: [],
        beliefs: [],
        modes: [],
        reports: []
      } as unknown as PsycheOverviewPayload
    });
    patchFlashcardMock.mockResolvedValue({ flashcard: legacyCard });

    renderPage();
    fireEvent.click((await screen.findByText(legacyCard.message)).closest("button")!);
    fireEvent.change(screen.getByDisplayValue("recovery"), {
      target: { value: "recovery, grounding" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save flashcard" }));

    await waitFor(() => expect(patchFlashcardMock).toHaveBeenCalledOnce());
    const patch = patchFlashcardMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(patch).not.toHaveProperty("message");
    expect(patch).toMatchObject({ tags: ["recovery", "grounding"] });
  });
});
