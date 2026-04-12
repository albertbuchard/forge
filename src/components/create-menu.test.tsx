import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateMenu, type ForgeCreateAction } from "@/components/create-menu";

const actions: ForgeCreateAction[] = [
  {
    id: "goal",
    kind: "goal",
    group: "Execution",
    title: "New life goal",
    quickActionTitle: "Create life goal",
    description: "Define a long-term direction.",
    aliases: ["goal"],
    filterIds: ["goal"],
    onSelect: vi.fn()
  },
  {
    id: "task",
    kind: "task",
    group: "Execution",
    title: "New task",
    quickActionTitle: "Create task",
    description: "Capture the next actionable step in a project.",
    aliases: ["task"],
    filterIds: ["task"],
    onSelect: vi.fn()
  },
  {
    id: "psyche_value",
    kind: "value",
    group: "Psyche",
    title: "Value",
    quickActionTitle: "Create value",
    description: "Place one value into the goal, project, and task constellation.",
    aliases: ["value"],
    filterIds: ["psyche_value"],
    onSelect: vi.fn()
  },
  {
    id: "wiki_page",
    kind: "wiki_page",
    group: "Knowledge",
    title: "Wiki page",
    quickActionTitle: "Create wiki page",
    description: "Open a fresh KarpaWiki page draft.",
    aliases: ["wiki"],
    filterIds: ["wiki_page"],
    onSelect: vi.fn()
  }
];

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });

  return {
    setMatches(next: boolean) {
      matches = next;
    }
  };
}

describe("CreateMenu", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the desktop menu in a fixed floating layer", () => {
    render(
      <MemoryRouter>
        <CreateMenu actions={actions} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(screen.getByTestId("create-desktop-menu")).toHaveClass("fixed");
    expect(screen.getByTestId("create-desktop-menu")).toHaveStyle({ transform: "translateY(-100%)" });
    expect(screen.getByRole("button", { name: /create/i })).toHaveClass("min-w-max");
    expect(screen.getByRole("button", { name: /create/i })).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("New life goal")).toBeInTheDocument();
    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Wiki page")).toBeInTheDocument();
  });

  it("uses a mobile modal selector instead of the desktop popover", () => {
    installMatchMedia(true);

    render(
      <MemoryRouter>
        <CreateMenu actions={actions} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(screen.queryByTestId("create-desktop-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-mobile-sheet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create in Forge" })).toBeInTheDocument();
  });
});
