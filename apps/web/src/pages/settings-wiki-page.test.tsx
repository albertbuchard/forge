import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWikiPage } from "@/pages/settings-wiki-page";

const {
  createWikiSpaceMock,
  getWikiHealthMock,
  getWikiSettingsMock,
  reindexWikiMock,
  syncWikiVaultMock
} = vi.hoisted(() => ({
  createWikiSpaceMock: vi.fn(),
  getWikiHealthMock: vi.fn(),
  getWikiSettingsMock: vi.fn(),
  reindexWikiMock: vi.fn(),
  syncWikiVaultMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createWikiSpace: createWikiSpaceMock,
  getWikiHealth: getWikiHealthMock,
  getWikiSettings: getWikiSettingsMock,
  reindexWiki: reindexWikiMock,
  syncWikiVault: syncWikiVaultMock
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <nav>Settings navigation</nav>
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    titleText,
    actions
  }: {
    titleText: string;
    actions: ReactNode;
  }) => (
    <header>
      <h1>{titleText}</h1>
      {actions}
    </header>
  )
}));

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
        <SettingsWikiPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsWikiPage", () => {
  beforeEach(() => {
    getWikiSettingsMock.mockResolvedValue({
      settings: {
        spaces: [
          {
            id: "space_1",
            slug: "personal",
            label: "Personal",
            description: "Private memory",
            ownerUserId: "user_operator",
            visibility: "personal",
            createdAt: "2026-07-11T08:00:00.000Z",
            updatedAt: "2026-07-11T08:00:00.000Z"
          }
        ],
        llmProfiles: [],
        embeddingProfiles: []
      }
    });
    getWikiHealthMock.mockResolvedValue({
      health: {
        space: { id: "space_1" },
        indexPath: "",
        rawDirectoryPath: "",
        pageCount: 12,
        wikiPageCount: 10,
        evidencePageCount: 2,
        assetCount: 3,
        rawSourceCount: 1,
        unresolvedLinks: [
          {
            sourceNoteId: "note_1",
            sourceSlug: "source",
            sourceTitle: "Source page",
            rawTarget: "missing-page",
            updatedAt: "2026-07-11T08:00:00.000Z"
          }
        ],
        orphanPages: [],
        missingSummaries: [],
        enabledEmbeddingProfiles: [],
        enabledLlmProfiles: []
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows bounded wiki health and explains no-model maintenance behavior", async () => {
    renderPage();

    expect(await screen.findByText("Index health")).toBeInTheDocument();
    expect(await screen.findByText("Source page")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Text search, entity search, and link health remain available/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reindex embeddings" })
    ).toBeDisabled();
    await waitFor(() =>
      expect(getWikiHealthMock).toHaveBeenCalledWith({ spaceId: "space_1" })
    );
  });

  it("keeps reindexing disabled when configured profiles are all disabled", async () => {
    getWikiSettingsMock.mockResolvedValue({
      settings: {
        spaces: [
          {
            id: "space_1",
            slug: "personal",
            label: "Personal",
            description: "Private memory",
            ownerUserId: "user_operator",
            visibility: "personal",
            createdAt: "2026-07-11T08:00:00.000Z",
            updatedAt: "2026-07-11T08:00:00.000Z"
          }
        ],
        llmProfiles: [],
        embeddingProfiles: [
          {
            id: "embedding_disabled",
            label: "Disabled embeddings",
            provider: "openai-compatible",
            baseUrl: "https://api.openai.com/v1",
            model: "text-embedding-3-small",
            secretId: null,
            dimensions: null,
            chunkSize: 1200,
            chunkOverlap: 200,
            enabled: false,
            metadata: {},
            createdAt: "2026-07-11T08:00:00.000Z",
            updatedAt: "2026-07-11T08:00:00.000Z"
          }
        ]
      }
    });

    renderPage();

    expect(
      await screen.findByRole("button", { name: "Reindex embeddings" })
    ).toBeDisabled();
    expect(
      screen.getByText(/No embedding profile is enabled/)
    ).toBeInTheDocument();
  });
});
