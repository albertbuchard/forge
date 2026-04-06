import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { WikiEditorPage } from "@/pages/wiki-editor-page";
import { WikiPage } from "@/pages/wiki-page";
import { ForgeApiError } from "@/lib/api-error";

const {
  deleteWikiPageMock,
  getWikiHomeMock,
  getWikiPageBySlugMock,
  getWikiPageMock,
  getWikiSettingsMock,
  getWikiTreeMock,
  listWikiPagesMock,
  patchWikiPageMock,
  createWikiPageMock,
  searchWikiMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  deleteWikiPageMock: vi.fn(),
  getWikiHomeMock: vi.fn(),
  getWikiPageBySlugMock: vi.fn(),
  getWikiPageMock: vi.fn(),
  getWikiSettingsMock: vi.fn(),
  getWikiTreeMock: vi.fn(),
  listWikiPagesMock: vi.fn(),
  patchWikiPageMock: vi.fn(),
  createWikiPageMock: vi.fn(),
  searchWikiMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  deleteWikiPage: deleteWikiPageMock,
  getWikiHome: getWikiHomeMock,
  getWikiPage: getWikiPageMock,
  getWikiPageBySlug: getWikiPageBySlugMock,
  getWikiSettings: getWikiSettingsMock,
  getWikiTree: getWikiTreeMock,
  listWikiPages: listWikiPagesMock,
  patchWikiPage: patchWikiPageMock,
  createWikiPage: createWikiPageMock,
  searchWiki: searchWikiMock
}));

vi.mock("@/components/shell/app-shell", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/shell/app-shell")>(
      "@/components/shell/app-shell"
    );
  return {
    ...actual,
    useForgeShell: useForgeShellMock
  };
});

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: () => <div>Entity multi select</div>
}));

vi.mock("@/components/wiki/wiki-ingest-modal", () => ({
  WikiIngestModal: () => null
}));

describe("wiki missing-page routing", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderRoute(initialEntry: string) {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false
        }
      }
    });

    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/wiki/page/:slug" element={<WikiPage />} />
            <Route path="/wiki/new" element={<WikiEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("redirects an unresolved wiki link into a prefilled new page draft", async () => {
    getWikiSettingsMock.mockResolvedValue({
      settings: {
        spaces: [
          {
            id: "wiki_space_shared",
            slug: "shared",
            label: "Shared Forge Memory",
            description: "",
            visibility: "shared",
            ownerUserId: null,
            createdAt: "2026-04-06T00:00:00.000Z",
            updatedAt: "2026-04-06T00:00:00.000Z"
          }
        ],
        llmProfiles: [],
        embeddingProfiles: []
      }
    });
    getWikiTreeMock.mockResolvedValue({ tree: [] });
    listWikiPagesMock.mockResolvedValue({ pages: [] });
    searchWikiMock.mockResolvedValue({ results: [] });
    getWikiPageBySlugMock.mockRejectedValue(
      new ForgeApiError({
        status: 404,
        code: "not_found",
        message: "Wiki page not found",
        requestPath: "/api/v1/wiki/by-slug/Albert%20Buchard"
      })
    );
    useForgeShellMock.mockReturnValue({
      snapshot: {
        goals: [],
        dashboard: { projects: [] },
        tasks: [],
        strategies: [],
        habits: [],
        tags: []
      }
    });

    renderRoute("/wiki/page/Albert%20Buchard?spaceId=wiki_space_shared");

    expect(await screen.findByDisplayValue("Albert Buchard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("albert-buchard")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/# Albert Buchard/)
    ).toBeInTheDocument();
  });

  it("slugifies punctuation-heavy missing link titles for the new page draft", async () => {
    getWikiSettingsMock.mockResolvedValue({
      settings: {
        spaces: [
          {
            id: "wiki_space_shared",
            slug: "shared",
            label: "Shared Forge Memory",
            description: "",
            visibility: "shared",
            ownerUserId: null,
            createdAt: "2026-04-06T00:00:00.000Z",
            updatedAt: "2026-04-06T00:00:00.000Z"
          }
        ],
        llmProfiles: [],
        embeddingProfiles: []
      }
    });
    getWikiTreeMock.mockResolvedValue({ tree: [] });
    listWikiPagesMock.mockResolvedValue({ pages: [] });
    searchWikiMock.mockResolvedValue({ results: [] });
    getWikiPageBySlugMock.mockRejectedValue(
      new ForgeApiError({
        status: 404,
        code: "not_found",
        message: "Wiki page not found",
        requestPath:
          "/api/v1/wiki/by-slug/Cakes%20(Albert,%20Gab,%20Julia)"
      })
    );
    useForgeShellMock.mockReturnValue({
      snapshot: {
        goals: [],
        dashboard: { projects: [] },
        tasks: [],
        strategies: [],
        habits: [],
        tags: []
      }
    });

    renderRoute(
      "/wiki/page/Cakes%20(Albert,%20Gab,%20Julia)?spaceId=wiki_space_shared"
    );

    expect(
      await screen.findByDisplayValue("Cakes (Albert, Gab, Julia)")
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("cakes-albert-gab-julia")
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/# Cakes \(Albert, Gab, Julia\)/)
    ).toBeInTheDocument();
  });
});
