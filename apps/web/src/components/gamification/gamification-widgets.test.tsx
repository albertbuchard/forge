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
import {
  GamificationCelebrationLayer,
  GamificationOverviewWidget,
  getGamificationFailureAlertMotion,
  getGamificationNoticeMotion
} from "@/components/gamification/gamification-widgets";
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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

    let image = view.getByTestId("forge-smith-featured-trophy");
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
    image = view.getByTestId("forge-smith-featured-trophy");
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/gamification-previews/dark-fantasy-item-trophy-xp-levels-the-first-heat.webp"
      )
    );
    expect(image.getAttribute("src")).toMatch(/\?v=0\.2\.59$/);
    expect(image).not.toHaveAttribute("hidden");
  });

  it("keeps progression and trophy content visible before optional art is installed", async () => {
    getGamificationAssetStatusMock.mockResolvedValue({
      assets: {
        styles: [
          {
            id: "dark-fantasy",
            label: "Dark Fantasy",
            installed: false,
            spriteCount: 0,
            expectedSpriteCount: 300
          }
        ]
      }
    });
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

    expect(
      await view.findByText(/Optional Dark Fantasy trophy and Smith art/i)
    ).toBeVisible();
    expect(view.getByText("Forge level 7")).toBeVisible();
    expect(view.getByText("The First Heat")).toBeVisible();
    expect(view.getByText("4 days")).toBeVisible();
    expect(view.getByRole("button", { name: "Download art" })).toBeEnabled();
  });

  it("keeps core progression visible and retries when asset status fails", async () => {
    getGamificationAssetStatusMock.mockRejectedValueOnce(
      new Error("Asset service unavailable")
    );
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

    expect(
      await view.findByText(/Reward art status is unavailable/i)
    ).toBeVisible();
    expect(view.getByText("Forge level 7")).toBeVisible();
    expect(view.getByText("The First Heat")).toBeVisible();

    getGamificationAssetStatusMock.mockResolvedValueOnce({
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
    fireEvent.click(view.getByRole("button", { name: "Retry art status" }));
    await waitFor(() =>
      expect(
        view.queryByText(/Reward art status is unavailable/i)
      ).not.toBeInTheDocument()
    );
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

    let image = view.getByTestId("forge-smith-featured-trophy");
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
    image = view.getByTestId("forge-smith-featured-trophy");
    fireEvent.error(image);
    image = view.getByTestId("forge-smith-featured-trophy");
    expect(image).toHaveAttribute("data-gamification-image-fallback", "icon");
    expect(image).toHaveAttribute("role", "img");
    expect(image).toHaveAccessibleName("The First Heat trophy");
    expect(image).not.toHaveAttribute("hidden");

    act(() => {
      queryClient.setQueryData(["forge-settings"], {
        settings: { gamificationTheme: "mind-locksmith" }
      });
    });

    await waitFor(() =>
      expect(view.getByTestId("forge-smith-featured-trophy")).toHaveAttribute(
        "src",
        expect.stringContaining("/themes/mind-locksmith/")
      )
    );

    image = view.getByTestId("forge-smith-featured-trophy");
    fireEvent.load(image);
    expect(image).not.toHaveAttribute("hidden");

    fireEvent.error(image);
    image = view.getByTestId("forge-smith-featured-trophy");
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/gamification-previews/mind-locksmith-item-trophy-xp-levels-the-first-heat.webp"
      )
    );
    expect(image).not.toHaveAttribute("hidden");
  });

  it("removes decorative notice transitions when reduced motion is requested", () => {
    expect(getGamificationNoticeMotion(true, "celebration")).toEqual({
      initial: false,
      animate: { opacity: 1 },
      exit: { opacity: 1 },
      transition: { duration: 0 }
    });
    expect(getGamificationNoticeMotion(true, "xp").transition.duration).toBe(0);
    expect(
      getGamificationNoticeMotion(false, "celebration").transition.duration
    ).toBeGreaterThan(0);
    expect(
      getGamificationFailureAlertMotion(true).exit.transition.duration
    ).toBe(0);
    expect(
      getGamificationFailureAlertMotion(false).exit.transition.duration
    ).toBeGreaterThan(0);
  });

  it("announces celebrations, preserves them, and allows dismissal", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const onSeen = vi.fn();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GamificationThemeProvider initialTheme="dark-fantasy">
          <GamificationCelebrationLayer
            xpNotice={null}
            celebrations={[
              {
                id: "celebration_1",
                userId: "user_1",
                kind: "trophy",
                itemId: "trophy_1",
                title: "The First Heat",
                summary: "A truthful milestone from completed Forge work.",
                assetKey: "item-trophy-xp-levels-the-first-heat",
                metadata: {},
                createdAt: "2026-07-11T10:00:00.000Z",
                seenAt: null
              }
            ]}
            onSeen={onSeen}
          />
        </GamificationThemeProvider>
      </QueryClientProvider>
    );

    expect(view.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(view.getByRole("status")).toHaveTextContent("The First Heat");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(view.getByRole("status")).toHaveTextContent("The First Heat");
    expect(onSeen).not.toHaveBeenCalled();

    fireEvent.click(
      view.getByRole("button", { name: "Dismiss trophy celebration" })
    );
    expect(onSeen).toHaveBeenCalledWith("celebration_1");
  });

  it("dismisses locally after an acknowledgement failure without retry storms", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const onSeen = vi
      .fn()
      .mockRejectedValueOnce(new Error("Acknowledgement unavailable"))
      .mockResolvedValueOnce(undefined);
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GamificationThemeProvider initialTheme="dark-fantasy">
          <GamificationCelebrationLayer
            xpNotice={null}
            celebrations={[
              {
                id: "celebration_retry",
                userId: "user_1",
                kind: "trophy",
                itemId: "trophy_1",
                title: "The First Heat",
                summary: "A truthful milestone from completed Forge work.",
                assetKey: "item-trophy-xp-levels-the-first-heat",
                metadata: {},
                createdAt: "2026-07-11T10:00:00.000Z",
                seenAt: null
              }
            ]}
            onSeen={onSeen}
          />
        </GamificationThemeProvider>
      </QueryClientProvider>
    );

    fireEvent.click(
      view.getByRole("button", { name: "Dismiss trophy celebration" })
    );
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(
      view.getByText("Celebration dismissed, but not saved")
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(onSeen).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Retry saving" }));
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });
    expect(onSeen).toHaveBeenCalledTimes(2);
    const exitingRetry = view.queryByRole("button", { name: "Retry saving" });
    if (exitingRetry) {
      fireEvent.click(exitingRetry);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(onSeen).toHaveBeenCalledTimes(2);
  });
});
