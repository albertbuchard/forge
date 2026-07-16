import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EntityNotesSurface } from "./entity-notes-surface";

const {
  createNoteMock,
  deleteNoteMock,
  listNotesMock,
  patchNoteMock,
  searchEntitiesMock,
  entityLinkMultiSelectPropsMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
  deleteNoteMock: vi.fn(),
  listNotesMock: vi.fn(),
  patchNoteMock: vi.fn(),
  searchEntitiesMock: vi.fn(),
  entityLinkMultiSelectPropsMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createNote: createNoteMock,
  deleteNote: deleteNoteMock,
  listNotes: listNotesMock,
  patchNote: patchNoteMock,
  searchEntities: searchEntitiesMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: (props: {
    onSearch?: (query: string) => Promise<unknown>;
  }) => {
    entityLinkMultiSelectPropsMock(props);
    return <div>Linked records</div>;
  }
}));

vi.mock("@/components/notes/note-tags-input", () => ({
  NoteTagsInput: () => <div>Tags</div>
}));

vi.mock("@/components/notes/note-markdown", () => ({
  NoteMarkdown: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
  NoteMarkdownDisclosure: ({ markdown }: { markdown: string }) => (
    <div>{markdown}</div>
  )
}));

function buildNote(index: number) {
  const now = "2026-07-15T08:00:00.000Z";
  return {
    id: `note_${index}`,
    kind: "evidence" as const,
    title: `Linked note ${index}`,
    slug: `linked-note-${index}`,
    spaceId: "space_1",
    parentSlug: null,
    indexOrder: 0,
    showInIndex: true,
    aliases: [],
    summary: "",
    contentMarkdown: `Durable content ${index}`,
    contentPlain: `Durable content ${index}`,
    author: "Albert",
    source: "ui" as const,
    sourcePath: "",
    frontmatter: {},
    revisionHash: `revision-${index}`,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
    links: [
      {
        entityType: "project" as const,
        entityId: "project_1",
        anchorKey: null
      }
    ],
    tags: ["linked"],
    destroyAt: null,
    userId: "user_operator",
    user: null
  };
}

function renderSurface(
  props: Partial<ComponentProps<typeof EntityNotesSurface>> = {}
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <EntityNotesSurface
        entityType="project"
        entityId="project_1"
        {...props}
      />
    </QueryClientProvider>
  );
}

describe("EntityNotesSurface", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: {
        goals: [],
        tasks: [],
        strategies: [],
        habits: [],
        tags: [],
        dashboard: { projects: [] }
      }
    });
    searchEntitiesMock.mockResolvedValue({ results: [] });
    listNotesMock.mockImplementation(
      async ({ cursor }: { cursor?: string } = {}) =>
        cursor
          ? {
              notes: [buildNote(2)],
              total: 2,
              limit: 40,
              nextCursor: null,
              hasMore: false
            }
          : {
              notes: [buildNote(1)],
              total: 2,
              limit: 40,
              nextCursor: "cursor-2",
              hasMore: true
            }
    );
    deleteNoteMock.mockResolvedValue({ note: buildNote(1) });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("accumulates exact cursor pages and confirms before soft deletion", async () => {
    renderSurface();

    expect(await screen.findByText("Linked note 1")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 1 of 2 linked notes.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load older notes" }));
    expect(await screen.findByText("Linked note 2")).toBeInTheDocument();
    expect(listNotesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor-2", limit: 40 })
    );
    expect(
      screen.getByText("Showing 2 of 2 linked notes.")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Linked note 1" })
    );
    expect(deleteNoteMock).not.toHaveBeenCalled();
    expect(
      screen.getByText('Move "Linked note 1" to the bin?')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move to bin" }));
    await waitFor(() => expect(deleteNoteMock).toHaveBeenCalledWith("note_1"));
  });

  it("wires canonical remote entity search into an embedded note editor", async () => {
    renderSurface();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Linked note 1" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const onSearch = entityLinkMultiSelectPropsMock.mock.lastCall?.[0]
      ?.onSearch as ((query: string) => Promise<unknown>) | undefined;
    expect(onSearch).toEqual(expect.any(Function));
    searchEntitiesMock.mockClear();
    await onSearch?.("flight");
    expect(searchEntitiesMock).toHaveBeenCalledWith({
      searches: [
        expect.objectContaining({
          query: "flight",
          limit: 40,
          entityTypes: expect.arrayContaining([
            "life_event",
            "calendar_event",
            "artifact",
            "person"
          ])
        })
      ]
    });
  });

  it("requests anchorless notes in the same bounded server page as the active anchor", async () => {
    renderSurface({
      entityType: "trigger_report",
      entityId: "report_1",
      anchorKey: "spark",
      includeAnchorlessWhenAnchored: true
    });

    expect(await screen.findByText("Linked note 1")).toBeInTheDocument();
    expect(listNotesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedEntityType: "trigger_report",
        linkedEntityId: "report_1",
        anchorKey: "spark",
        includeAnchorless: true,
        limit: 40
      })
    );
  });
});
