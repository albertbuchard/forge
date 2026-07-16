import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
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
  const actual = await vi.importActual<
    typeof import("@/components/shell/app-shell")
  >("@/components/shell/app-shell");
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

vi.mock("@/components/gamification/gamification-widgets", () => ({
  GamificationMiniHud: () => null
}));

vi.mock("@/components/knowledge-graph/open-in-graph-button", () => ({
  OpenInGraphButton: () => null
}));

vi.mock("@/components/wiki/wiki-article-markdown", () => ({
  WikiArticleMarkdown: ({ markdown }: { markdown: string }) => (
    <div>{markdown}</div>
  )
}));

describe("wiki missing-page routing", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
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
            <Route path="/wiki" element={<WikiPage />} />
            <Route path="/wiki/new" element={<WikiEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  function makeSpace(input: {
    id: string;
    label: string;
    visibility: "personal" | "shared";
    ownerUserId: string | null;
  }) {
    return {
      ...input,
      slug: input.id,
      description: "",
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z"
    };
  }

  function makePage(spaceId: string, title = "Home") {
    return {
      id: `note_${spaceId}`,
      kind: "wiki" as const,
      title,
      slug: "index",
      spaceId,
      parentSlug: null,
      indexOrder: 0,
      showInIndex: true,
      aliases: [],
      summary: `${title} page`,
      contentMarkdown: `# ${title}`,
      contentPlain: title,
      author: "Albert",
      source: "ui" as const,
      sourcePath: "",
      frontmatter: {},
      revisionHash: `${spaceId}-hash`,
      lastSyncedAt: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      links: [],
      tags: [],
      destroyAt: null
    };
  }

  function makeDetail(page: ReturnType<typeof makePage>) {
    return {
      page,
      backlinks: [],
      backlinkSourceNotes: [],
      assets: [],
      backlinksBySourceId: {}
    };
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
    getWikiTreeMock.mockResolvedValue({ tree: [], truncated: false });
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

    expect(
      await screen.findByDisplayValue("Albert Buchard")
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("albert-buchard")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/# Albert Buchard/)).toBeInTheDocument();
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
    getWikiTreeMock.mockResolvedValue({ tree: [], truncated: false });
    listWikiPagesMock.mockResolvedValue({ pages: [] });
    searchWikiMock.mockResolvedValue({ results: [] });
    getWikiPageBySlugMock.mockRejectedValue(
      new ForgeApiError({
        status: 404,
        code: "not_found",
        message: "Wiki page not found",
        requestPath: "/api/v1/wiki/by-slug/Cakes%20(Albert,%20Gab,%20Julia)"
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

  it("searches the wiki in bounded ranked windows", async () => {
    const space = {
      id: "wiki_space_shared",
      slug: "shared",
      label: "Shared Forge Memory",
      description: "",
      visibility: "shared",
      ownerUserId: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z"
    };
    const page = {
      id: "note_home",
      kind: "wiki",
      title: "Home",
      slug: "index",
      spaceId: space.id,
      parentSlug: null,
      indexOrder: 0,
      showInIndex: true,
      aliases: [],
      summary: "Home page",
      contentMarkdown: "# Home",
      contentPlain: "Home",
      author: "Albert",
      source: "ui",
      sourcePath: "",
      frontmatter: {},
      revisionHash: "home-hash",
      lastSyncedAt: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      links: [],
      tags: [],
      destroyAt: null
    };
    getWikiSettingsMock.mockResolvedValue({
      settings: { spaces: [space], llmProfiles: [], embeddingProfiles: [] }
    });
    getWikiHomeMock.mockResolvedValue({
      page,
      backlinks: [
        {
          sourceNoteId: "deleted_source",
          targetType: "page",
          targetNoteId: page.id,
          targetEntityType: null,
          targetEntityId: null,
          label: "Home",
          rawTarget: "index",
          isEmbed: false,
          createdAt: "2026-04-06T00:00:00.000Z",
          updatedAt: "2026-04-06T00:00:00.000Z"
        }
      ],
      backlinkSourceNotes: [],
      assets: [],
      backlinksBySourceId: { deleted_source: null }
    });
    getWikiTreeMock.mockResolvedValue({ tree: [], truncated: false });
    let nextPageAttempts = 0;
    searchWikiMock.mockImplementation(
      async ({ limit, offset = 0 }: { limit: number; offset?: number }) => {
        if (offset > 0 && nextPageAttempts === 0) {
          nextPageAttempts += 1;
          throw new Error("Next search page failed");
        }
        return {
          mode: "hybrid",
          profileId: null,
          limit,
          offset,
          hasMore: offset === 0,
          nextOffset: offset === 0 ? limit : null,
          warnings: [],
          results: Array.from(
            { length: offset === 0 ? limit : 3 },
            (_, index) => ({
              page: {
                ...page,
                id: `note_${offset + index}`,
                title: `Result ${offset + index}`
              },
              score: 1 - (offset + index) / 100,
              matchKind: index === 0 ? "title" : "content",
              snippet: `Matched content ${offset + index}`
            })
          )
        };
      }
    );
    useForgeShellMock.mockReturnValue({ snapshot: { metrics: {} } });

    renderRoute(`/wiki?spaceId=${space.id}`);

    expect(
      await screen.findByText("Source page unavailable")
    ).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Search KarpaWiki" })
    );
    fireEvent.change(screen.getByPlaceholderText("Search KarpaWiki pages"), {
      target: { value: "memory" }
    });

    const loadMore = await screen.findByRole("button", {
      name: "Load more matches"
    });
    expect(searchWikiMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "memory", limit: 20, offset: 0 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(await screen.findByText("Title match")).toBeInTheDocument();
    expect(screen.getByText("Matched content 0")).toBeInTheDocument();

    fireEvent.click(loadMore);
    expect(
      await screen.findByText("More matches could not be loaded.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more matches" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(searchWikiMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 20, offset: 20 }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    expect(await screen.findByText("Result 22")).toBeInTheDocument();
  });

  it("opens the selected user's personal wiki and filters the space picker", async () => {
    const sharedSpace = makeSpace({
      id: "wiki_space_shared",
      label: "Shared Wiki",
      visibility: "shared",
      ownerUserId: null
    });
    const operatorSpace = makeSpace({
      id: "wiki_space_operator",
      label: "Operator Wiki",
      visibility: "personal",
      ownerUserId: "user_operator"
    });
    const botSpace = makeSpace({
      id: "wiki_space_bot",
      label: "Bot Wiki",
      visibility: "personal",
      ownerUserId: "user_forge_bot"
    });
    const operatorPage = makePage(operatorSpace.id, "Operator Home");
    getWikiSettingsMock.mockResolvedValue({
      settings: {
        spaces: [sharedSpace, operatorSpace, botSpace],
        llmProfiles: [],
        embeddingProfiles: []
      }
    });
    getWikiHomeMock.mockImplementation(
      async ({ spaceId }: { spaceId?: string }) =>
        makeDetail(
          spaceId === operatorSpace.id
            ? operatorPage
            : makePage(sharedSpace.id, "Shared Home")
        )
    );
    getWikiTreeMock.mockResolvedValue({
      tree: [{ page: operatorPage, children: [] }],
      truncated: false
    });
    searchWikiMock.mockResolvedValue({
      mode: "hybrid",
      profileId: null,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      warnings: [],
      results: []
    });
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: { metrics: {} }
    });

    renderRoute("/wiki");

    expect(await screen.findByText("# Operator Home")).toBeInTheDocument();
    await waitFor(() =>
      expect(getWikiHomeMock).toHaveBeenCalledWith({
        spaceId: operatorSpace.id
      })
    );

    const indexToggle = screen.getByRole("button", { name: "Index" });
    expect(indexToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(indexToggle);
    expect(indexToggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(
      screen.getByRole("button", { name: /Space\s+Operator Wiki/i })
    );
    expect(
      await screen.findByRole("button", { name: /Shared Wiki/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Operator Wiki/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Bot Wiki/i })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close space picker" }));

    fireEvent.click(screen.getByRole("button", { name: "Search KarpaWiki" }));
    expect(
      screen.queryByRole("button", { name: "entity" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "semantic" })
    ).not.toBeInTheDocument();
  });

  it("shows scoped entity availability, citation labels, and relationship bounds", async () => {
    const space = makeSpace({
      id: "wiki_space_shared",
      label: "Shared Wiki",
      visibility: "shared",
      ownerUserId: null
    });
    const page = {
      ...makePage(space.id),
      links: [
        {
          entityType: "goal" as const,
          entityId: "goal_visible",
          anchorKey: null
        },
        {
          entityType: "goal" as const,
          entityId: "goal_outside_scope",
          anchorKey: null
        }
      ]
    };
    const source = {
      ...makePage(space.id, "Source article"),
      id: "note_source",
      slug: "source-article",
      summary: "Source summary"
    };
    const edge = (label: string) => ({
      sourceNoteId: source.id,
      targetType: "page" as const,
      targetNoteId: page.id,
      targetEntityType: null,
      targetEntityId: null,
      label,
      rawTarget: "index",
      isEmbed: false,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z"
    });

    getWikiSettingsMock.mockResolvedValue({
      settings: { spaces: [space], llmProfiles: [], embeddingProfiles: [] }
    });
    getWikiHomeMock.mockResolvedValue({
      page,
      outboundLinks: [],
      outboundLinksTruncated: true,
      outboundLinkLimit: 500,
      backlinks: [edge("Home reference"), edge("Overview citation")],
      backlinksTruncated: true,
      backlinkLimit: 100,
      backlinkSourceNotes: [source],
      assets: [],
      backlinksBySourceId: { [source.id]: source }
    });
    getWikiTreeMock.mockResolvedValue({ tree: [], truncated: false });
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      snapshot: {
        metrics: {},
        goals: [{ id: "goal_visible", title: "Visible goal" }],
        projects: [],
        tasks: [],
        strategies: []
      }
    });

    renderRoute(`/wiki?spaceId=${space.id}`);

    expect(
      await screen.findByRole("link", { name: "goal · Visible goal" })
    ).toHaveAttribute("data-entity-link-status", "available");
    expect(
      screen.getByTitle("Entity unavailable in the selected scope")
    ).toHaveTextContent("goal · goal_outside_scope · Unavailable");
    expect(screen.getByText("Source article")).toBeInTheDocument();
    expect(
      screen.getByText("Cited as Home reference, Overview citation")
    ).toBeInTheDocument();
    expect(screen.getByText(/first 500 wiki links/)).toBeInTheDocument();
    expect(
      screen.getByText(/first 100 backlink citations/)
    ).toBeInTheDocument();
  });

  it("renders search loading, fallback warnings, empty results, and retry", async () => {
    const space = makeSpace({
      id: "wiki_space_shared",
      label: "Shared Wiki",
      visibility: "shared",
      ownerUserId: null
    });
    const page = makePage(space.id);
    getWikiSettingsMock.mockResolvedValue({
      settings: { spaces: [space], llmProfiles: [], embeddingProfiles: [] }
    });
    getWikiHomeMock.mockResolvedValue(makeDetail(page));
    getWikiTreeMock.mockResolvedValue({ tree: [], truncated: false });
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      snapshot: { metrics: {} }
    });

    let resolveSearch!: (value: unknown) => void;
    searchWikiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        })
    );

    renderRoute(`/wiki?spaceId=${space.id}`);
    expect(
      await screen.findByText("No active pages in this space link here.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search KarpaWiki" }));
    const searchbox = screen.getByRole("searchbox", {
      name: "Search KarpaWiki pages"
    });
    fireEvent.change(searchbox, { target: { value: "nothing" } });
    expect(await screen.findByText("Searching")).toBeInTheDocument();
    await waitFor(() => expect(searchWikiMock).toHaveBeenCalledTimes(1));

    resolveSearch({
      mode: "hybrid",
      profileId: null,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      warnings: [
        "Hybrid search used text ranking because no enabled embedding profile matches this request."
      ],
      results: []
    });
    expect(
      await screen.findByText(/Hybrid search used text ranking/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("No pages matched this search.")
    ).toBeInTheDocument();

    searchWikiMock.mockRejectedValueOnce(new Error("Search unavailable"));
    fireEvent.change(searchbox, { target: { value: "broken" } });
    const retry = await screen.findByRole("button", { name: "Retry" });
    searchWikiMock.mockResolvedValueOnce({
      mode: "hybrid",
      profileId: null,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      warnings: [],
      results: []
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(searchWikiMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "broken", offset: 0 }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    expect(
      await screen.findByText("No pages matched this search.")
    ).toBeInTheDocument();
  });
});
