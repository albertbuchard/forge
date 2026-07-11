import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WikiIngestHistoryPage } from "@/pages/wiki-ingest-history-page";

const { getWikiSettingsMock, listWikiIngestJobsMock } = vi.hoisted(() => ({
  getWikiSettingsMock: vi.fn(),
  listWikiIngestJobsMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  deleteWikiIngestJob: vi.fn(),
  getWikiSettings: getWikiSettingsMock,
  listWikiIngestJobs: listWikiIngestJobsMock
}));

vi.mock("@/components/wiki/wiki-ingest-modal", () => ({
  WikiIngestModal: () => null
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title, badge }: { title: string; badge: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <div>{badge}</div>
    </header>
  )
}));

function job(index: number, errorMessage = "") {
  const failed = Boolean(errorMessage);
  return {
    job: {
      id: `job_${index}`,
      spaceId: "space_1",
      llmProfileId: null,
      status: failed ? "failed" : "completed",
      phase: failed ? "failed" : "review",
      progressPercent: 100,
      totalFiles: 1,
      processedFiles: 1,
      createdPageCount: failed ? 0 : 1,
      createdEntityCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      latestMessage: failed ? errorMessage : "Ready for review",
      sourceKind: "url",
      sourceLocator: `https://example.com/${index}`,
      mimeType: "text/html",
      titleHint: `Ingest ${index}`,
      summary: "",
      pageNoteId: null,
      createdByActor: null,
      errorMessage,
      createdAt: "2026-07-11T08:00:00.000Z",
      updatedAt: "2026-07-11T08:00:00.000Z",
      completedAt: "2026-07-11T08:00:01.000Z"
    },
    items: [],
    logs: [],
    assets: [],
    candidates: []
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WikiIngestHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WikiIngestHistoryPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reports persisted totals separately from loaded matches and shows terminal errors", async () => {
    getWikiSettingsMock.mockResolvedValue({
      settings: {
        spaces: [
          {
            id: "space_1",
            slug: "personal",
            label: "Personal",
            description: "",
            ownerUserId: null,
            visibility: "personal",
            createdAt: "2026-07-11T08:00:00.000Z",
            updatedAt: "2026-07-11T08:00:00.000Z"
          }
        ],
        llmProfiles: [],
        embeddingProfiles: []
      }
    });
    listWikiIngestJobsMock.mockResolvedValue({
      jobs: [
        job(
          0,
          "Wiki URL ingest cannot access private, loopback, link-local, or reserved network addresses."
        ),
        ...Array.from({ length: 39 }, (_, index) => job(index + 1))
      ],
      total: 73
    });

    renderPage();

    expect(
      await screen.findByText("40 matching loaded · 40 of 73 jobs loaded")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot access private, loopback, link-local/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Load older jobs" })
    ).toBeInTheDocument();
  });
});
