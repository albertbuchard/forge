import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "@/pages/settings-page";
import type { ForgeCustomTheme } from "@/lib/theme-system";

const {
  ensureOperatorSessionMock,
  getCompanionOverviewMock,
  getGamificationAssetStatusMock,
  getSettingsMock,
  installGamificationAssetStyleMock,
  patchSettingsMock,
  revokeOperatorSessionMock
} = vi.hoisted(() => ({
  ensureOperatorSessionMock: vi.fn(),
  getCompanionOverviewMock: vi.fn(),
  getGamificationAssetStatusMock: vi.fn(),
  getSettingsMock: vi.fn(),
  installGamificationAssetStyleMock: vi.fn(),
  patchSettingsMock: vi.fn(),
  revokeOperatorSessionMock: vi.fn()
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>
}));

vi.mock("@/components/settings/theme-customizer-dialog", () => ({
  ThemeCustomizerDialog: ({
    open,
    onSave
  }: {
    open: boolean;
    onSave: (theme: ForgeCustomTheme) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onSave({
            label: "Sunlit Draft",
            primary: "#2457d6",
            secondary: "#0e8a6a",
            tertiary: "#b8662b",
            canvas: "#f8f4ec",
            panel: "#fffaf2",
            panelHigh: "#ffffff",
            panelLow: "#ece1d2",
            ink: "#182235"
          })
        }
      >
        Save custom theme
      </button>
    ) : null
}));

vi.mock("@/lib/api", () => ({
  ensureOperatorSession: ensureOperatorSessionMock,
  getCompanionOverview: getCompanionOverviewMock,
  getGamificationAssetStatus: getGamificationAssetStatusMock,
  getSettings: getSettingsMock,
  installGamificationAssetStyle: installGamificationAssetStyleMock,
  patchSettings: patchSettingsMock,
  revokeOperatorSession: revokeOperatorSessionMock
}));

function renderSettingsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsPage theme persistence", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ensureOperatorSessionMock.mockResolvedValue({
      session: {
        actorLabel: "Master Architect"
      }
    });
    getSettingsMock.mockResolvedValue({
      settings: {
        profile: {
          operatorName: "Albert",
          operatorEmail: "architect@kineticforge.ai",
          operatorTitle: "Local-first operator"
        },
        notifications: {
          goalDriftAlerts: true,
          dailyQuestReminders: true,
          achievementCelebrations: true
        },
        execution: {
          maxActiveTasks: 2,
          timeAccountingMode: "split"
        },
        themePreference: "obsidian",
        gamificationTheme: "dramatic-smithie",
        customTheme: null,
        localePreference: "en",
        security: {
          integrityScore: 98,
          storageMode: "local-first",
          lastAuditAt: "2026-04-09T18:00:00.000Z"
        }
      }
    });
    getCompanionOverviewMock.mockResolvedValue({
      overview: {
        pairings: [],
        importRuns: [],
        healthState: "disconnected",
        lastSyncAt: null,
        counts: {
          sleepSessions: 0,
          sleepSegments: 0,
          sleepRawRecords: 0,
          sleepRawLogs: 0,
          workouts: 0
        },
        permissions: {
          healthKitAuthorized: false,
          backgroundRefreshEnabled: false,
          locationReady: false,
          motionReady: false,
          screenTimeReady: false
        }
      }
    });
    getGamificationAssetStatusMock.mockResolvedValue({
      assets: {
        version: "0.2.59",
        defaultStyle: "dramatic-smithie",
        styles: [
          {
            id: "dramatic-smithie",
            label: "Fantasy",
            description: "Warm, lighthearted 3D forge art.",
            previewUrl: "/gamification-previews/dramatic-smithie-mascot.webp",
            fileName: "forge-gamification-dramatic-smithie-0.2.59.zip",
            downloadUrl:
              "https://api.github.com/repos/albertbuchard/aurel-monorepo/releases/assets/411057831",
            sha256: "407c98a89626d723f9f92e79411df7c999458459c96e0e09e73020b3d3ce14c0",
            installed: false,
            spriteCount: 0,
            expectedSpriteCount: 348,
            installedAt: null
          },
          {
            id: "dark-fantasy",
            label: "Dark Fantasy",
            description: "Obsidian iron and ember gold.",
            previewUrl: "/gamification-previews/dark-fantasy-mascot.webp",
            fileName: "forge-gamification-dark-fantasy-0.2.59.zip",
            downloadUrl:
              "https://api.github.com/repos/albertbuchard/aurel-monorepo/releases/assets/411057833",
            sha256: "9545900906784a23d15f4536eb8c32683ffff0ef42006d06c70cea101c1db570",
            installed: false,
            spriteCount: 0,
            expectedSpriteCount: 348,
            installedAt: null
          },
          {
            id: "mind-locksmith",
            label: "Mind Locksmith",
            description: "Modern locksmith-of-the-mind art.",
            previewUrl: "/gamification-previews/mind-locksmith-mascot.webp",
            fileName: "forge-gamification-mind-locksmith-0.2.59.zip",
            downloadUrl:
              "https://api.github.com/repos/albertbuchard/aurel-monorepo/releases/assets/411057834",
            sha256: "cfdfd4259145e589e6e0fba8e1deb69d30931cfabbe6d626c0053e4f4cfe5f10",
            installed: false,
            spriteCount: 0,
            expectedSpriteCount: 348,
            installedAt: null
          }
        ]
      }
    });
    installGamificationAssetStyleMock.mockResolvedValue({
      style: {
        id: "mind-locksmith",
        installed: true,
        spriteCount: 348,
        expectedSpriteCount: 348
      }
    });
    patchSettingsMock.mockImplementation(
      async (input: Record<string, unknown>) => ({
        settings: {
          profile: {
            operatorName: "Albert",
            operatorEmail: "architect@kineticforge.ai",
            operatorTitle: "Local-first operator"
          },
          notifications: {
            goalDriftAlerts: true,
            dailyQuestReminders: true,
            achievementCelebrations: true
          },
          execution: {
            maxActiveTasks: 2,
            timeAccountingMode: "split"
          },
          themePreference: input.themePreference ?? "obsidian",
          gamificationTheme: input.gamificationTheme ?? "dramatic-smithie",
          customTheme: input.customTheme ?? null,
          localePreference: "en",
          security: {
            integrityScore: 98,
            storageMode: "local-first",
            lastAuditAt: "2026-04-09T18:00:00.000Z"
          }
        }
      })
    );
    revokeOperatorSessionMock.mockResolvedValue(undefined);
  });

  it("persists preset theme selection immediately", async () => {
    renderSettingsPage();

    expect(await screen.findByText("Dev frontend")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Forge UI is currently being served by the Vite dev server."
      )
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByText("Paper"));

    await waitFor(() =>
      expect(patchSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ themePreference: "paper" })
      )
    );
  });

  it("persists custom theme saves immediately", async () => {
    renderSettingsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Create custom theme" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Save custom theme" })
    );

    await waitFor(() =>
      expect(patchSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          themePreference: "custom",
          customTheme: expect.objectContaining({ label: "Sunlit Draft" })
        })
      )
    );
  });

  it("persists gamification style selection immediately", async () => {
    renderSettingsPage();

    const mindLocksmithButtons = await screen.findAllByRole("button", {
      name: /Select Mind Locksmith/i
    });
    fireEvent.click(mindLocksmithButtons[0]);

    await waitFor(() =>
      expect(patchSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ gamificationTheme: "mind-locksmith" })
      )
    );
  });

  it("downloads the selected gamification asset style from settings", async () => {
    renderSettingsPage();

    await screen.findByText("Selected style not downloaded");
    const downloadButtons = await screen.findAllByRole("button", {
      name: "Download"
    });
    fireEvent.click(downloadButtons[2]);

    await waitFor(() =>
      expect(installGamificationAssetStyleMock).toHaveBeenCalledWith(
        "mind-locksmith"
      )
    );
    await waitFor(() =>
      expect(patchSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ gamificationTheme: "mind-locksmith" })
      )
    );
  });

  it("promotes the mobile companion card while the bridge is not healthy", async () => {
    renderSettingsPage();

    await screen.findAllByText("Connect the iPhone bridge");

    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("Mobile companion")).toBeLessThan(
      bodyText.indexOf("Operator profile")
    );
  });

  it("explains why integrity is below 100", async () => {
    renderSettingsPage();

    await screen.findByText("Security posture");
    expect(
      screen.getAllByText(
        /Forge is holding back 2% because the latest settings and storage audit reported a consistency warning/i
      ).length
    ).toBeGreaterThan(0);

    const integritySummary = await screen.findByText(/98% integrity/i);
    const integrityDetails = integritySummary.closest("details");
    expect(integrityDetails).not.toHaveAttribute("open");

    fireEvent.click(integritySummary);

    expect(integrityDetails).toHaveAttribute("open");
    expect(await screen.findByText("Why this is 98%")).toBeInTheDocument();
    expect(
      screen.getByText(
        /The current audit only exposes the aggregate score, so per-check details are not available yet/i
      )
    ).toBeInTheDocument();
  });
});
