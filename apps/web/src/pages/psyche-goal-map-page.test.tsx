import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PsycheGoalMapPage } from "@/pages/psyche-goal-map-page";

const { getPsycheOverviewMock, useForgeShellMock } = vi.hoisted(() => ({
  getPsycheOverviewMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getPsycheOverview: getPsycheOverviewMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description
  }: {
    title: ReactNode;
    description: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <nav aria-label="Psyche sections" />
}));

vi.mock("@/components/psyche/psyche-graph", () => ({
  PsycheGraphCanvas: ({ title }: { title: string }) => <div>{title}</div>
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PsycheGoalMapPage", () => {
  it("loads the map in the selected user scope and states its non-causal semantics", async () => {
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_albert"],
      snapshot: {
        goals: [],
        habits: [],
        dashboard: { projects: [] }
      }
    });
    getPsycheOverviewMock.mockResolvedValue({
      overview: {
        values: [],
        reports: [],
        behaviors: [],
        beliefs: []
      }
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PsycheGoalMapPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      await screen.findByText(/not correlation or causation/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Solid lines are explicit links/i)
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(getPsycheOverviewMock).toHaveBeenCalledWith(["user_albert"])
    );
  });
});
