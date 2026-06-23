import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PsycheQuestionnaireRunPage } from "@/pages/psyche-questionnaire-run-page";
import type {
  QuestionnaireAnswerInput,
  QuestionnaireRunDetail
} from "@/lib/questionnaire-types";

const {
  navigateMock,
  startQuestionnaireRunMock,
  patchQuestionnaireRunMock,
  completeQuestionnaireAssessmentMock
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  startQuestionnaireRunMock: vi.fn(),
  patchQuestionnaireRunMock: vi.fn(),
  completeQuestionnaireAssessmentMock: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/lib/api", () => ({
  startQuestionnaireRun: startQuestionnaireRunMock,
  patchQuestionnaireRun: patchQuestionnaireRunMock,
  completeQuestionnaireAssessment: completeQuestionnaireAssessmentMock
}));

function buildAuditRunDetail(
  answers: QuestionnaireRunDetail["answers"] = [],
  progressIndex = 0
): QuestionnaireRunDetail {
  const now = "2026-04-06T10:00:00.000Z";
  return {
    run: {
      id: "run_audit",
      instrumentId: "instrument_audit",
      versionId: "version_audit_v1",
      userId: "user_operator",
      status: "draft",
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      progressIndex
    },
    instrument: {
      id: "instrument_audit",
      key: "audit",
      slug: "audit",
      title: "AUDIT",
      subtitle: "Alcohol Use Disorders Identification Test",
      description: "Alcohol screening questionnaire",
      aliases: [],
      symptomDomains: ["alcohol"],
      tags: ["screening"],
      sourceClass: "open_noncommercial",
      availability: "open",
      responseStyle: "mixed_frequency",
      presentationMode: "single_question",
      itemCount: 10,
      isSelfReport: true,
      isSystem: true,
      isReadOnly: true,
      ownerUserId: null,
      currentVersionId: "version_audit_v1",
      currentVersionNumber: 1,
      latestRunId: null,
      latestRunAt: null,
      completedRunCount: 0,
      primarySourceUrl: "https://example.com/audit",
      createdAt: now,
      updatedAt: now
    },
    version: {
      id: "version_audit_v1",
      instrumentId: "instrument_audit",
      versionNumber: 1,
      status: "published",
      label: "v1",
      isReadOnly: true,
      definition: {
        locale: "en",
        instructions: "Answer the alcohol screening questions.",
        completionNote: "",
        presentationMode: "single_question",
        responseStyle: "mixed_frequency",
        itemIds: [
          "audit_1",
          "audit_2"
        ],
        items: [
          {
            id: "audit_1",
            prompt: "How often do you have a drink containing alcohol?",
            shortLabel: "",
            description: "",
            helperText: "",
            required: true,
            visibility: null,
            tags: [],
            options: [
              { key: "never", label: "Never", value: 0, description: "" },
              {
                key: "monthly_or_less",
                label: "Monthly or less",
                value: 1,
                description: ""
              }
            ]
          },
          {
            id: "audit_2",
            prompt:
              "How many drinks containing alcohol do you have on a typical day when you are drinking?",
            shortLabel: "",
            description: "",
            helperText: "",
            required: true,
            visibility: { script: "audit_1 > 0" },
            tags: [],
            options: [
              { key: "one_or_two", label: "1 or 2", value: 0, description: "" }
            ]
          }
        ],
        sections: [
          {
            id: "audit",
            title: "AUDIT",
            description: "",
            visibility: null,
            itemIds: ["audit_1", "audit_2"]
          }
        ],
        pageSize: null
      },
      scoring: {
        scores: [
          {
            key: "audit_total",
            label: "Total",
            description: "",
            valueType: "number",
            expression: { kind: "sum", itemIds: ["audit_1", "audit_2"] },
            dependsOnItemIds: ["audit_1", "audit_2"],
            missingPolicy: { mode: "require_all" },
            bands: [],
            roundTo: null,
            unitLabel: ""
          }
        ]
      },
      provenance: {
        retrievalDate: "2026-04-06",
        sourceClass: "open_noncommercial",
        scoringNotes: "",
        sources: [
          {
            label: "WHO",
            url: "https://example.com/audit",
            citation: "AUDIT",
            notes: ""
          }
        ]
      },
      createdBy: "system",
      createdAt: now,
      updatedAt: now,
      publishedAt: now
    },
    answers,
    scores: [],
    history: []
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/psyche/questionnaires/instrument_audit/take"]}>
        <Routes>
          <Route
            path="/psyche/questionnaires/:instrumentId/take"
            element={<PsycheQuestionnaireRunPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PsycheQuestionnaireRunPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides conditional AUDIT follow-up questions after selecting never", async () => {
    startQuestionnaireRunMock.mockResolvedValue(buildAuditRunDetail());
    patchQuestionnaireRunMock.mockImplementation(async (_runId, input) => {
      const patchAnswers = input.answers ?? [];
      return buildAuditRunDetail(
        patchAnswers.map((answer: QuestionnaireAnswerInput) => ({
          itemId: answer.itemId,
          optionKey: answer.optionKey ?? null,
          valueText: answer.valueText,
          numericValue: answer.numericValue ?? null,
          answer: answer.answer,
          createdAt: "2026-04-06T10:00:00.000Z",
          updatedAt: "2026-04-06T10:00:00.000Z"
        })),
        input.progressIndex ?? 0
      );
    });
    completeQuestionnaireAssessmentMock.mockResolvedValue(
      buildAuditRunDetail(
        [
          {
            itemId: "audit_1",
            optionKey: "never",
            valueText: "Never",
            numericValue: 0,
            answer: { label: "Never", value: 0 },
            createdAt: "2026-04-06T10:00:00.000Z",
            updatedAt: "2026-04-06T10:00:00.000Z"
          }
        ],
        0
      )
    );

    renderPage();

    expect(
      await screen.findByText("How often do you have a drink containing alcohol?")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "How many drinks containing alcohol do you have on a typical day when you are drinking?"
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText("Step 1 of 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Never" }));

    await waitFor(() => {
      expect(patchQuestionnaireRunMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Step 1 of 1")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "How many drinks containing alcohol do you have on a typical day when you are drinking?"
      )
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Finish and score" })
    ).toBeInTheDocument();
  });
});
