import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import type { QuestionnaireRunDetail } from "@/lib/questionnaire-types";
import {
  buildQuestionnaireRunExport,
  PsycheQuestionnaireRunDetailPage
} from "@/pages/psyche-questionnaire-run-detail-page";

const { getQuestionnaireRunMock } = vi.hoisted(() => ({
  getQuestionnaireRunMock: vi.fn()
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    actions
  }: {
    title: string;
    description: string;
    actions?: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </div>
  )
}));

vi.mock("@/lib/api", () => ({
  getQuestionnaireRun: getQuestionnaireRunMock
}));

const completedRun: QuestionnaireRunDetail = {
  run: {
    id: "run_audit_completed",
    instrumentId: "instrument_audit",
    versionId: "version_audit_v1",
    userId: "user_operator",
    status: "completed",
    startedAt: "2026-08-10T09:00:00.000Z",
    updatedAt: "2026-08-10T09:05:00.000Z",
    completedAt: "2026-08-10T09:05:00.000Z",
    progressIndex: 2
  },
  instrument: {
    id: "instrument_audit",
    key: "audit",
    slug: "audit",
    title: "AUDIT result",
    subtitle: "Alcohol use screening",
    description: "Recorded screening result",
    aliases: [],
    symptomDomains: ["alcohol"],
    tags: ["screening"],
    sourceClass: "open_noncommercial",
    availability: "open",
    responseStyle: "mixed_frequency",
    presentationMode: "single_question",
    itemCount: 3,
    isSelfReport: true,
    isSystem: true,
    isReadOnly: true,
    ownerUserId: null,
    currentVersionId: "version_audit_v2",
    currentVersionNumber: 2,
    latestRunId: "run_audit_completed",
    latestRunAt: "2026-08-10T09:05:00.000Z",
    completedRunCount: 1,
    primarySourceUrl: "https://example.com/current",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z"
  },
  version: {
    id: "version_audit_v1",
    instrumentId: "instrument_audit",
    versionNumber: 1,
    status: "published",
    label: "Published baseline",
    isReadOnly: true,
    definition: {
      locale: "en",
      instructions: "Answer the stored version.",
      completionNote: "",
      presentationMode: "single_question",
      responseStyle: "mixed_frequency",
      itemIds: ["audit_1", "audit_2", "audit_3"],
      items: [
        {
          id: "audit_1",
          prompt: "How often do you drink alcohol?",
          shortLabel: "",
          description: "",
          helperText: "",
          required: true,
          visibility: null,
          tags: [],
          options: [
            { key: "never", label: "Never", value: 0, description: "" },
            { key: "monthly", label: "Monthly", value: 1, description: "" }
          ]
        },
        {
          id: "audit_2",
          prompt: "How many drinks on a drinking day?",
          shortLabel: "",
          description: "",
          helperText: "",
          required: true,
          visibility: { script: "audit_1 > 0" },
          tags: [],
          options: [
            { key: "one_two", label: "1 or 2", value: 0, description: "" }
          ]
        },
        {
          id: "audit_3",
          prompt: "Was support offered?",
          shortLabel: "",
          description: "",
          helperText: "",
          required: false,
          visibility: null,
          tags: [],
          options: [
            { key: "yes", label: "Yes", value: 1, description: "" },
            { key: "no", label: "No", value: 0, description: "" }
          ]
        }
      ],
      sections: [
        {
          id: "audit",
          title: "AUDIT",
          description: "",
          visibility: null,
          itemIds: ["audit_1", "audit_2", "audit_3"]
        }
      ],
      pageSize: null
    },
    scoring: {
      scores: [
        {
          key: "audit_total",
          label: "Total score",
          description: "Stored total",
          valueType: "number",
          expression: { kind: "sum", itemIds: ["audit_1", "audit_2"] },
          dependsOnItemIds: ["audit_1", "audit_2"],
          missingPolicy: { mode: "require_all" },
          bands: [],
          roundTo: null,
          unitLabel: "points"
        }
      ]
    },
    provenance: {
      retrievalDate: "2026-04-06",
      sourceClass: "open_noncommercial",
      scoringNotes: "Sum only questions shown by the recorded flow.",
      sources: [
        {
          label: "WHO source",
          url: "https://example.com/audit-v1",
          citation: "AUDIT source edition",
          notes: ""
        },
        {
          label: "Unsafe source",
          url: "https://user:secret@example.com/private",
          citation: "Stored legacy source",
          notes: ""
        }
      ]
    },
    createdBy: "system",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-01T00:00:00.000Z"
  },
  answers: [
    {
      itemId: "audit_1",
      optionKey: "never",
      valueText: "Never",
      numericValue: 0,
      answer: { label: "Never", value: 0 },
      createdAt: "2026-08-10T09:01:00.000Z",
      updatedAt: "2026-08-10T09:01:00.000Z"
    }
  ],
  scores: [
    {
      scoreKey: "audit_total",
      label: "Total score",
      valueNumeric: 0,
      valueText: null,
      bandLabel: "Low risk",
      severity: "low",
      details: {
        dependsOnItemIds: ["audit_1", "audit_2"],
        missingPolicy: { mode: "require_all" }
      },
      createdAt: "2026-08-10T09:05:00.000Z"
    }
  ],
  history: []
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={["/psyche/questionnaire-runs/run_audit_completed"]}
      >
        <Routes>
          <Route
            path="/psyche/questionnaire-runs/:runId"
            element={<PsycheQuestionnaireRunDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PsycheQuestionnaireRunDetailPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("shows exact version, provenance, score, stored answer, and distinct missing states", async () => {
    getQuestionnaireRunMock.mockResolvedValue(completedRun);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "AUDIT result" })
    ).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getByText("Published baseline")).toBeInTheDocument();
    expect(
      screen.getByText("Sum only questions shown by the recorded flow.")
    ).toBeInTheDocument();
    expect(screen.getByText("Total score")).toBeInTheDocument();
    expect(screen.getByText("Low risk")).toBeInTheDocument();
    expect(
      screen.getByText(/Stored answer: Never · Numeric value 0/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not shown by questionnaire flow")
    ).toBeInTheDocument();
    expect(screen.getByText("No answer stored")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "WHO source" })).toHaveAttribute(
      "href",
      "https://example.com/audit-v1"
    );
    expect(
      screen.queryByRole("link", { name: "Unsafe source" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Unsafe source")).toBeInTheDocument();
  });

  it("downloads the exact run evidence while redacting unsafe legacy source URLs", async () => {
    const longAnswer = "A".repeat(90_000);
    const exportDetail: QuestionnaireRunDetail = {
      ...completedRun,
      instrument: {
        ...completedRun.instrument,
        primarySourceUrl: "https://admin:password@example.com/current"
      },
      answers: [
        ...completedRun.answers,
        {
          itemId: "audit_3",
          optionKey: null,
          valueText: longAnswer,
          numericValue: null,
          answer: { freeText: longAnswer },
          createdAt: "2026-08-10T09:02:00.000Z",
          updatedAt: "2026-08-10T09:02:00.000Z"
        }
      ]
    };
    const exported = buildQuestionnaireRunExport(exportDetail);
    expect(exported.schemaVersion).toBe(1);
    expect(exported.run.id).toBe("run_audit_completed");
    expect(exported.version.id).toBe("version_audit_v1");
    expect(exported.instrument.primarySourceUrl).toBeNull();
    expect(exported.instrument.primarySourceUrlStatus).toBe("redacted_unsafe");
    expect(exported.answers[1]?.valueText).toHaveLength(90_000);
    expect(exported.scores).toEqual(completedRun.scores);
    expect(exported.version.provenance.sources).toEqual([
      expect.objectContaining({
        label: "WHO source",
        url: "https://example.com/audit-v1",
        urlStatus: "available"
      }),
      expect.objectContaining({
        label: "Unsafe source",
        url: null,
        urlStatus: "redacted_unsafe"
      })
    ]);
    expect(JSON.stringify(exported)).not.toContain("user:secret");
    expect(JSON.stringify(exported)).not.toContain("admin:password");

    const createObjectURL = vi.fn(() => "blob:questionnaire-result");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    getQuestionnaireRunMock.mockResolvedValue(exportDetail);
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Download result JSON" })
    );

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:questionnaire-result");
    anchorClick.mockRestore();
  });
});
