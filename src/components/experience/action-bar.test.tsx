import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionBar } from "@/components/experience/action-bar";
import type { ForgeCreateAction } from "@/components/create-menu";
import type { ForgeSnapshot } from "@/lib/types";

const { searchEntitiesMock } = vi.hoisted(() => ({
  searchEntitiesMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  searchEntities: searchEntitiesMock
}));

function createSnapshot(): ForgeSnapshot {
  return {
    overview: {
      topTasks: [
        {
          id: "task_recent",
          title: "Recent focus task",
          user: null
        }
      ],
      activeGoals: [
        {
          id: "goal_recent",
          title: "Ship Forge",
          user: null
        }
      ]
    },
    dashboard: {
      projects: [
        {
          id: "project_recent",
          title: "Action Bar polish",
          goalTitle: "Ship Forge",
          user: null
        }
      ],
      habits: [
        {
          id: "habit_recent",
          title: "Morning review",
          frequency: "daily",
          user: null
        }
      ]
    },
    users: [
      {
        id: "user_mickael",
        kind: "human",
        displayName: "Mickael",
        handle: "mickael",
        description: "",
        accentColor: "",
        createdAt: "",
        updatedAt: ""
      }
    ]
  } as ForgeSnapshot;
}

function renderActionBar({
  createActions = [],
  onOpenChange = vi.fn(),
  selectedUserIds = []
}: {
  createActions?: ForgeCreateAction[];
  onOpenChange?: (open: boolean) => void;
  selectedUserIds?: string[];
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActionBar
          open
          onOpenChange={onOpenChange}
          snapshot={createSnapshot()}
          selectedUserIds={selectedUserIds}
          createActions={createActions}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchEntitiesMock.mockResolvedValue({ results: [] });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows route and recent surfaces when no query or filters are active", () => {
    renderActionBar();

    expect(screen.getByText("Routes")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Recent focus task")).toBeInTheDocument();
  });

  it("applies free-text and badge filters conjunctively", async () => {
    searchEntitiesMock.mockResolvedValue({
      results: [
        {
          matches: [
            {
              entityType: "note",
              id: "wiki_mickael",
              entity: {
                id: "wiki_mickael",
                kind: "wiki",
                title: "Mickael Atlas",
                slug: "mickael-atlas"
              }
            },
            {
              entityType: "note",
              id: "note_mickael",
              entity: {
                id: "note_mickael",
                kind: "evidence",
                title: "Mickael scratchpad"
              }
            }
          ]
        }
      ]
    });

    renderActionBar();

    fireEvent.change(screen.getAllByPlaceholderText(/add entity type filters/i)[0]!, {
      target: { value: "wiki" }
    });
    fireEvent.click(await screen.findByText("Wiki page"));
    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      {
        target: { value: "Mickael" }
      }
    );

    expect(await screen.findByText("Mickael Atlas")).toBeInTheDocument();
    expect(screen.queryByText("Mickael scratchpad")).not.toBeInTheDocument();
  });

  it("keeps OR semantics when multiple entity-type badges are selected", async () => {
    searchEntitiesMock.mockResolvedValue({
      results: [
        {
          matches: [
            {
              entityType: "note",
              id: "wiki_mickael",
              entity: {
                id: "wiki_mickael",
                kind: "wiki",
                title: "Mickael Atlas",
                slug: "mickael-atlas"
              }
            },
            {
              entityType: "note",
              id: "note_mickael",
              entity: {
                id: "note_mickael",
                kind: "evidence",
                title: "Mickael scratchpad"
              }
            }
          ]
        }
      ]
    });

    renderActionBar();

    fireEvent.change(screen.getAllByPlaceholderText(/add entity type filters/i)[0]!, {
      target: { value: "wiki" }
    });
    fireEvent.click(await screen.findByText("Wiki page"));
    fireEvent.change(screen.getAllByPlaceholderText(/add entity type filters/i)[0]!, {
      target: { value: "note" }
    });
    fireEvent.click(await screen.findByText(/^Note$/));
    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      {
        target: { value: "Mickael" }
      }
    );

    expect(await screen.findByText("Mickael Atlas")).toBeInTheDocument();
    expect(await screen.findByText("Mickael scratchpad")).toBeInTheDocument();
  });

  it("removes the last badge when backspace is pressed on an empty filter input", async () => {
    renderActionBar();

    const filterInput =
      screen.getAllByPlaceholderText(/add entity type filters/i)[0]!;
    fireEvent.change(filterInput, { target: { value: "wiki" } });
    fireEvent.click(await screen.findByText("Wiki page"));

    expect(screen.getByLabelText("Remove Wiki page")).toBeInTheDocument();

    fireEvent.keyDown(screen.getAllByPlaceholderText(/add entity type filters/i)[0]!, {
      key: "Backspace"
    });

    await waitFor(() =>
      expect(screen.queryByLabelText("Remove Wiki page")).not.toBeInTheDocument()
    );
  });

  it("surfaces quick create actions and runs the shared create handler", async () => {
    const onOpenChange = vi.fn();
    const onCreateHabit = vi.fn();

    renderActionBar({
      onOpenChange,
      createActions: [
        {
          id: "habit",
          kind: "habit",
          group: "Execution",
          title: "Habit",
          quickActionTitle: "Create habit",
          description: "Track a recurring commitment.",
          aliases: ["habit", "routine"],
          filterIds: ["habit"],
          onSelect: onCreateHabit
        }
      ]
    });

    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      {
        target: { value: "create habit" }
      }
    );

    fireEvent.click(await screen.findByText("Create habit"));

    expect(onCreateHabit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
