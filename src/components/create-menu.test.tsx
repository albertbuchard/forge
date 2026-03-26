import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateMenu } from "@/components/create-menu";
import type { DashboardGoal, ProjectSummary, Tag } from "@/lib/types";

const goals: DashboardGoal[] = [];
const projects: ProjectSummary[] = [];
const tags: Tag[] = [];

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
        <CreateMenu
          goals={goals}
          projects={projects}
          tags={tags}
          onCreateGoal={vi.fn().mockResolvedValue(undefined)}
          onCreateProject={vi.fn().mockResolvedValue(undefined)}
          onCreateTask={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(screen.getByTestId("create-desktop-menu")).toHaveClass("fixed");
    expect(screen.getByTestId("create-desktop-menu")).toHaveStyle({ transform: "translateY(-100%)" });
    expect(screen.getByRole("button", { name: /create/i })).toHaveClass("min-w-max");
    expect(screen.getByRole("button", { name: /create/i })).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("New life goal")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();
    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Pattern")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
  });

  it("uses a mobile modal selector instead of the desktop popover", () => {
    installMatchMedia(true);

    render(
      <MemoryRouter>
        <CreateMenu
          goals={goals}
          projects={projects}
          tags={tags}
          onCreateGoal={vi.fn().mockResolvedValue(undefined)}
          onCreateProject={vi.fn().mockResolvedValue(undefined)}
          onCreateTask={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(screen.queryByTestId("create-desktop-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-mobile-sheet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create in Forge" })).toBeInTheDocument();
  });
});
