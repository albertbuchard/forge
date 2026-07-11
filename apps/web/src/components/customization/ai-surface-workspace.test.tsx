import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";

const { getSurfaceLayoutMock } = vi.hoisted(() => ({
  getSurfaceLayoutMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getSurfaceLayout: (...args: unknown[]) => getSurfaceLayoutMock(...args),
  saveSurfaceLayout: vi.fn(),
  resetSurfaceLayout: vi.fn()
}));

describe("AiSurfaceWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getSurfaceLayoutMock.mockResolvedValue({ layout: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps compact Workbench and layout controls named", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AiSurfaceWorkspace
            surfaceId="overview"
            baseWidgets={[
              {
                id: "summary",
                title: "Summary",
                defaultWidth: 12,
                defaultHeight: 2,
                render: () => <div>Summary content</div>
              }
            ]}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      screen.getByRole("link", { name: "Open overview in Workbench" })
    ).toHaveAttribute("href", "/workbench?surface=overview");

    const editButton = screen.getByRole("button", {
      name: "Edit surface layout"
    });
    fireEvent.click(editButton);

    expect(
      screen.getByRole("button", { name: "Finish editing surface layout" })
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reset surface layout" })
    ).toBeVisible();
  });
});
