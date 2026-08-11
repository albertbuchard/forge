import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PsycheQuestionnaireBuilderPage } from "@/pages/psyche-questionnaire-builder-page";

const api = vi.hoisted(() => ({
  createQuestionnaire: vi.fn(async (_input: unknown) => ({
    instrument: { id: "questionnaire_created" }
  }))
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <div>Psyche navigation</div>
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/lib/api", () => ({
  cloneQuestionnaire: vi.fn(),
  createQuestionnaire: api.createQuestionnaire,
  ensureQuestionnaireDraft: vi.fn(),
  getQuestionnaire: vi.fn(),
  publishQuestionnaireDraft: vi.fn(),
  updateQuestionnaireDraft: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PsycheQuestionnaireBuilderPage", () => {
  it("authors structure, scoring, and provenance through the guided draft flow", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/psyche/questionnaires/new"]}>
          <PsycheQuestionnaireBuilderPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "My reusable questionnaire" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Structure" }));
    expect(
      screen.getByLabelText("Participant instructions")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add question to Section 2" })
    );
    fireEvent.change(screen.getByDisplayValue("New question"), {
      target: { value: "A second scored question" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Scoring" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Include all 2 questions in total"
      })
    );
    fireEvent.change(screen.getByLabelText("Scoring provenance notes"), {
      target: { value: "Scoring follows the cited source." }
    });

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(api.createQuestionnaire).toHaveBeenCalledOnce());
    const input = api.createQuestionnaire.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      title: "My reusable questionnaire",
      definition: {
        itemIds: ["item_1", "item_2"],
        sections: [
          { id: "section_1", itemIds: ["item_1"] },
          { id: "section_2", itemIds: ["item_2"] }
        ]
      },
      scoring: {
        scores: [
          {
            key: "total",
            expression: { kind: "sum", itemIds: ["item_1", "item_2"] },
            dependsOnItemIds: ["item_1", "item_2"]
          }
        ]
      },
      provenance: { scoringNotes: "Scoring follows the cited source." }
    });
  });

  it("contains malformed imported JSON in the advanced editor", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PsycheQuestionnaireBuilderPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Structure" }));
    fireEvent.click(screen.getByText("Advanced definition JSON"));
    fireEvent.change(screen.getByLabelText("Advanced definition JSON"), {
      target: { value: "{}" }
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Definition JSON is invalid"
    );
    expect(screen.getByLabelText("Advanced definition JSON")).toHaveValue("{}");
  });
});
