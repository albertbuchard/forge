import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GamificationAssetSetupDialog } from "@/components/gamification/gamification-asset-setup-dialog";

const { getGamificationAssetStatusMock } = vi.hoisted(() => ({
  getGamificationAssetStatusMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getGamificationAssetStatus: (...args: unknown[]) =>
    getGamificationAssetStatusMock(...args),
  installGamificationAssetStyle: vi.fn(),
  patchSettings: vi.fn()
}));

function renderDialog(pathname: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pathname]}>
        <GamificationAssetSetupDialog />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("GamificationAssetSetupDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getGamificationAssetStatusMock.mockResolvedValue({
      assets: {
        defaultStyle: "fantasy",
        styles: [
          {
            id: "fantasy",
            label: "Fantasy",
            description: "Warm, lighthearted Forge art.",
            installed: false
          }
        ]
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not block Overview with optional reward setup", async () => {
    renderDialog("/overview");

    await waitFor(() =>
      expect(getGamificationAssetStatusMock).not.toHaveBeenCalled()
    );
    expect(
      screen.queryByText("Download trophies and mascot sprites?")
    ).not.toBeInTheDocument();
  });

  it("offers the guided reward setup inside Trophy Hall", async () => {
    renderDialog("/rewards");

    expect(
      await screen.findByText("Download trophies and mascot sprites?")
    ).toBeInTheDocument();
    expect(getGamificationAssetStatusMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Not now" })).toBeVisible();
  });
});
