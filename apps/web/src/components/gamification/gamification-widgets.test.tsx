import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamificationOverviewWidget } from "@/components/gamification/gamification-widgets";
import { GamificationThemeProvider } from "@/components/gamification/use-gamification-theme";
import type { XpMetricsPayload } from "@/lib/types";

const { getSettingsMock, getGamificationAssetStatusMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getGamificationAssetStatusMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  getGamificationAssetStatus: (...args: unknown[]) =>
    getGamificationAssetStatusMock(...args),
  installGamificationAssetStyle: vi.fn()
}));

const trophy = {
  id: "trophy-xp-levels-the-first-heat",
  kind: "trophy",
  title: "The First Heat",
  assetKey: "item-trophy-xp-levels-the-first-heat",
  unlocked: true
};

const newerUnlock = {
  id: "unlock-habits-vital-flame",
  kind: "unlock",
  title: "Vital Flame",
  assetKey: "item-unlock-habits-vital-flame",
  unlocked: true
};

const metrics = {
  scope: { label: "Operator" },
  profile: {
    totalXp: 5_000,
    level: 7,
    currentLevelXp: 220,
    nextLevelXp: 500,
    weeklyXp: 100,
    streakDays: 4,
    comboMultiplier: 1,
    momentumScore: 82,
    topGoalId: null,
    topGoalTitle: null
  },
  catalogPreview: [newerUnlock, trophy],
  unlockedItemCount: 1,
  totalItemCount: 144,
  newestUnlock: newerUnlock,
  nextUnlock: null,
  mascot: {
    spriteKey: "mascot-state-014",
    headline: "The forge is warm.",
    line: "Keep the rhythm.",
    pressureLevel: 0,
    missedDays: 0
  }
} as unknown as XpMetricsPayload;

describe("GamificationOverviewWidget", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    getSettingsMock.mockResolvedValue({
      settings: { gamificationTheme: "dark-fantasy" }
    });
    getGamificationAssetStatusMock.mockResolvedValue({
      assets: {
        styles: [
          {
            id: "dark-fantasy",
            label: "Dark Fantasy",
            installed: true
          }
        ]
      }
    });
  });

  it("shows real selected-theme trophy art in the compact overview", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GamificationThemeProvider initialTheme="dark-fantasy">
          <MemoryRouter>
            <GamificationOverviewWidget metrics={metrics} compact />
          </MemoryRouter>
        </GamificationThemeProvider>
      </QueryClientProvider>
    );

    const image = view.getByTestId("forge-smith-featured-trophy");
    expect(view.getByText("Latest trophy")).toBeVisible();
    expect(view.getByText("The First Heat")).toBeVisible();
    expect(image).toHaveAttribute("alt", "The First Heat trophy");
    expect(image).toHaveAttribute("width", "56");
    expect(image).toHaveAttribute("height", "56");
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/gamification/sprites/themes/dark-fantasy/items/item-trophy-xp-levels-the-first-heat-256.webp"
      )
    );
    expect(image.getAttribute("src")).toMatch(/\?v=0\.2\.59$/);

    fireEvent.error(image);
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/gamification-previews/dark-fantasy-item-trophy-xp-levels-the-first-heat.webp"
      )
    );
    expect(image.getAttribute("src")).toMatch(/\?v=0\.2\.59$/);
    expect(image).not.toHaveAttribute("hidden");
  });

  it("updates visible reward art when the shared settings theme changes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GamificationThemeProvider initialTheme="dark-fantasy">
          <MemoryRouter>
            <GamificationOverviewWidget metrics={metrics} compact />
          </MemoryRouter>
        </GamificationThemeProvider>
      </QueryClientProvider>
    );

    const image = view.getByTestId("forge-smith-featured-trophy");
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining("/themes/dark-fantasy/")
    );

    await waitFor(() =>
      expect(queryClient.getQueryData(["forge-settings"])).toEqual({
        settings: { gamificationTheme: "dark-fantasy" }
      })
    );

    fireEvent.error(image);
    fireEvent.error(image);
    expect(image).toHaveAttribute("hidden");

    act(() => {
      queryClient.setQueryData(["forge-settings"], {
        settings: { gamificationTheme: "mind-locksmith" }
      });
    });

    await waitFor(() =>
      expect(image).toHaveAttribute(
        "src",
        expect.stringContaining("/themes/mind-locksmith/")
      )
    );

    fireEvent.load(image);
    expect(image).not.toHaveAttribute("hidden");

    fireEvent.error(image);
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/gamification-previews/mind-locksmith-item-trophy-xp-levels-the-first-heat.webp"
      )
    );
    expect(image).not.toHaveAttribute("hidden");
  });
});
