import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PsycheQuestionnairesPage } from "@/pages/psyche-questionnaires-page";

afterEach(() => {
  vi.clearAllMocks();
});

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <div>Psyche nav</div>
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/lib/api", () => ({
  listQuestionnaires: vi.fn(async () => ({
    instruments: [
      {
        id: "q_phq",
        key: "phq_9",
        slug: "phq-9",
        title: "PHQ-9",
        subtitle: "Patient Health Questionnaire",
        description: "Depression screener",
        aliases: ["Patient Health Questionnaire-9"],
        symptomDomains: ["depression"],
        tags: ["core"],
        sourceClass: "free_use",
        availability: "open",
        responseStyle: "four_point_frequency",
        presentationMode: "single_question",
        itemCount: 9,
        isSelfReport: true,
        isSystem: true,
        isReadOnly: true,
        ownerUserId: null,
        currentVersionId: "v1",
        currentVersionNumber: 1,
        latestRunId: null,
        latestRunAt: null,
        completedRunCount: 0,
        primarySourceUrl: "https://example.com/phq",
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z"
      },
      {
        id: "q_ysq",
        key: "ysq_r",
        slug: "ysq-r",
        title: "YSQ-R",
        subtitle: "Young Schema Questionnaire Revised",
        description: "Schema questionnaire",
        aliases: ["Young Schema Questionnaire - Revised"],
        symptomDomains: ["schemas"],
        tags: ["schema"],
        sourceClass: "free_clinician",
        availability: "free_clinician",
        responseStyle: "six_point_schema_rating",
        presentationMode: "batched_likert",
        itemCount: 116,
        isSelfReport: true,
        isSystem: true,
        isReadOnly: true,
        ownerUserId: null,
        currentVersionId: "v1",
        currentVersionNumber: 1,
        latestRunId: null,
        latestRunAt: null,
        completedRunCount: 0,
        primarySourceUrl: "https://example.com/ysq",
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z"
      }
    ]
  }))
}));

describe("PsycheQuestionnairesPage", () => {
  it("filters the questionnaire library with search text and facet chips", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false
        }
      }
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PsycheQuestionnairesPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("PHQ-9")).toBeInTheDocument();
    expect(screen.getByText("YSQ-R")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search title, alias, domain, source, or filter chip"
      ),
      { target: { value: "schema" } }
    );

    expect(await screen.findByText("YSQ-R")).toBeInTheDocument();
    expect(screen.queryByText("PHQ-9")).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search title, alias, domain, source, or filter chip"
      ),
      { target: { value: "depression" } }
    );

    fireEvent.click(await screen.findByText("Domain: depression"));

    expect(await screen.findByText("PHQ-9")).toBeInTheDocument();
    expect(screen.queryByText("YSQ-R")).not.toBeInTheDocument();
  });
});
