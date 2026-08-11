import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ForgeApiError } from "@/lib/api-error";
import { PsycheQuestionnaireBuilderPage } from "@/pages/psyche-questionnaire-builder-page";

const api = vi.hoisted(() => ({
  createQuestionnaire: vi.fn(async (_input: unknown) => ({
    instrument: { id: "questionnaire_created" }
  })),
  getQuestionnaire: vi.fn(),
  publishQuestionnaireDraft: vi.fn(),
  updateQuestionnaireDraft: vi.fn()
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
  getQuestionnaire: api.getQuestionnaire,
  publishQuestionnaireDraft: api.publishQuestionnaireDraft,
  updateQuestionnaireDraft: api.updateQuestionnaireDraft
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeInstrument(updatedAt: string, prompt = "Original prompt") {
  const version = {
    id: "questionnaire_version_2",
    instrumentId: "questionnaire_custom",
    versionNumber: 2,
    status: "draft",
    label: "Draft 2",
    isReadOnly: false,
    definition: {
      locale: "en",
      instructions: "Answer carefully.",
      completionNote: "",
      presentationMode: "single_question",
      responseStyle: "binary",
      itemIds: ["item_1"],
      items: [
        {
          id: "item_1",
          prompt,
          shortLabel: "",
          description: "",
          helperText: "",
          required: true,
          visibility: null,
          tags: [],
          options: [
            { key: "0", label: "No", value: 0, description: "" },
            { key: "1", label: "Yes", value: 1, description: "" }
          ]
        }
      ],
      sections: [
        {
          id: "section_1",
          title: "Section 1",
          description: "",
          visibility: null,
          itemIds: ["item_1"]
        }
      ],
      pageSize: null
    },
    scoring: {
      scores: [
        {
          key: "total",
          label: "Total",
          description: "",
          valueType: "number",
          expression: { kind: "sum", itemIds: ["item_1"] },
          dependsOnItemIds: ["item_1"],
          missingPolicy: { mode: "require_all" },
          bands: [],
          roundTo: null,
          unitLabel: ""
        }
      ]
    },
    provenance: {
      retrievalDate: "2026-08-11",
      sourceClass: "secondary_verified",
      scoringNotes: "Local scoring.",
      sources: [
        {
          label: "Local source",
          url: "https://example.com/source",
          citation: "Local source",
          notes: ""
        }
      ]
    },
    createdBy: "user_operator",
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt,
    publishedAt: null
  };
  return {
    id: "questionnaire_custom",
    key: "custom",
    slug: "custom",
    title: "Custom questionnaire",
    subtitle: "",
    description: "",
    aliases: [],
    symptomDomains: [],
    tags: [],
    sourceClass: "secondary_verified",
    availability: "custom",
    responseStyle: "binary",
    presentationMode: "single_question",
    itemCount: 1,
    isSelfReport: true,
    isSystem: false,
    isReadOnly: false,
    ownerUserId: "user_operator",
    currentVersionId: "questionnaire_version_1",
    currentVersionNumber: 1,
    latestRunId: null,
    latestRunAt: null,
    completedRunCount: 0,
    primarySourceUrl: "https://example.com/source",
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt,
    status: "active",
    currentVersion: null,
    draftVersion: version,
    versions: [version],
    history: [],
    latestDraftRunId: null
  };
}

function renderExistingBuilder() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={["/psyche/questionnaires/questionnaire_custom/edit"]}
      >
        <Routes>
          <Route
            path="/psyche/questionnaires/:instrumentId/edit"
            element={<PsycheQuestionnaireBuilderPage />}
          />
          <Route path="*" element={<div>Destination</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

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

  it("saves the visible form and publishes exactly the returned revision", async () => {
    const opened = makeInstrument("2026-08-11T10:00:00.000Z");
    const saved = makeInstrument(
      "2026-08-11T10:00:00.001Z",
      "Visible edited prompt"
    );
    api.getQuestionnaire.mockResolvedValue({ instrument: opened });
    api.updateQuestionnaireDraft.mockResolvedValue({ instrument: saved });
    api.publishQuestionnaireDraft.mockResolvedValue({
      instrument: { ...saved, draftVersion: null }
    });
    renderExistingBuilder();

    expect(
      await screen.findByDisplayValue("Custom questionnaire")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Structure" }));
    fireEvent.change(screen.getByDisplayValue("Original prompt"), {
      target: { value: "Visible edited prompt" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and publish version" })
    );

    await waitFor(() =>
      expect(api.updateQuestionnaireDraft).toHaveBeenCalledWith(
        "questionnaire_custom",
        expect.objectContaining({
          expectedDraftVersionId: "questionnaire_version_2",
          expectedDraftUpdatedAt: "2026-08-11T10:00:00.000Z",
          definition: expect.objectContaining({
            items: [
              expect.objectContaining({ prompt: "Visible edited prompt" })
            ]
          })
        })
      )
    );
    expect(api.publishQuestionnaireDraft).toHaveBeenCalledWith(
      "questionnaire_custom",
      {
        label: "Draft 2",
        expectedDraftVersionId: "questionnaire_version_2",
        expectedDraftUpdatedAt: "2026-08-11T10:00:00.001Z"
      }
    );
  });

  it("shows an explicit destructive reload choice after a revision conflict", async () => {
    const opened = makeInstrument("2026-08-11T10:00:00.000Z");
    const current = makeInstrument(
      "2026-08-11T10:00:00.002Z",
      "Other editor prompt"
    );
    api.getQuestionnaire
      .mockResolvedValueOnce({ instrument: opened })
      .mockResolvedValue({ instrument: current });
    api.updateQuestionnaireDraft.mockRejectedValue(
      new ForgeApiError({
        status: 409,
        code: "questionnaire_draft_revision_conflict",
        message: "This questionnaire draft changed after it was opened.",
        requestPath: "/api/v1/psyche/questionnaires/questionnaire_custom/draft"
      })
    );
    renderExistingBuilder();

    expect(
      await screen.findByDisplayValue("Custom questionnaire")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    const reload = await screen.findByRole("button", {
      name: "Reload current draft and discard my unsaved changes"
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This questionnaire draft changed after it was opened."
    );
    fireEvent.click(reload);
    fireEvent.click(screen.getByRole("button", { name: "Structure" }));
    expect(
      await screen.findByDisplayValue("Other editor prompt")
    ).toBeInTheDocument();
  });
});
