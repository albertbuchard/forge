import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "@/pages/settings-page";
import type { ForgeCustomTheme } from "@/lib/theme-system";
import { createAppStore } from "@/store/store";

const {
  ensureOperatorSessionMock,
  getCompanionOverviewMock,
  getGamificationAssetStatusMock,
  getForgeDoctorMock,
  getSettingsMock,
  applyForgeDoctorFixesMock,
  installGamificationAssetStyleMock,
  patchSettingsMock,
  revokeOperatorSessionMock
} = vi.hoisted(() => ({
  ensureOperatorSessionMock: vi.fn(),
  getCompanionOverviewMock: vi.fn(),
  getGamificationAssetStatusMock: vi.fn(),
  getForgeDoctorMock: vi.fn(),
  getSettingsMock: vi.fn(),
  applyForgeDoctorFixesMock: vi.fn(),
  installGamificationAssetStyleMock: vi.fn(),
  patchSettingsMock: vi.fn(),
  revokeOperatorSessionMock: vi.fn()
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>,
  SettingsStateFrame: ({
    children
  }: {
    children: import("react").ReactNode;
  }) => (
    <>
      <div>Settings nav</div>
      {children}
    </>
  )
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
  getForgeDoctor: getForgeDoctorMock,
  getSettings: getSettingsMock,
  applyForgeDoctorFixes: applyForgeDoctorFixesMock,
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
  const store = createAppStore();

  render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>
  );

  return { store };
}

describe("SettingsPage theme persistence", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ensureOperatorSessionMock.mockResolvedValue({
      session: {
        id: "operator-session",
        actorLabel: "Master Architect",
        profile: "operator",
        expiresAt: "2026-04-09T19:00:00.000Z"
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
            sha256:
              "407c98a89626d723f9f92e79411df7c999458459c96e0e09e73020b3d3ce14c0",
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
            sha256:
              "9545900906784a23d15f4536eb8c32683ffff0ef42006d06c70cea101c1db570",
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
            sha256:
              "cfdfd4259145e589e6e0fba8e1deb69d30931cfabbe6d626c0053e4f4cfe5f10",
            installed: false,
            spriteCount: 0,
            expectedSpriteCount: 348,
            installedAt: null
          }
        ]
      }
    });
    getForgeDoctorMock.mockResolvedValue({
      doctor: {
        ok: true,
        now: "2026-04-09T18:00:00.000Z",
        integrity: {
          score: 100,
          status: "healthy",
          headline: "All active Doctor consistency checks passed.",
          lastCheckedAt: "2026-04-09T18:00:00.000Z",
          issueCount: 0,
          warningCount: 0,
          errorCount: 0,
          topIssues: []
        },
        runtime: {},
        health: {},
        settingsFile: {
          path: "/tmp/forge.json",
          exists: true,
          valid: true,
          syncState: "up_to_date",
          parseError: null,
          overrideKeys: []
        },
        settingsSummary: {
          themePreference: "obsidian",
          localePreference: "en",
          operatorName: "Albert",
          maxActiveTasks: 2,
          timeAccountingMode: "split",
          psycheAuthRequired: false,
          webAppUrl: "http://127.0.0.1:4317/forge/"
        },
        checks: [],
        issues: [],
        fixProposals: [],
        warnings: []
      }
    });
    applyForgeDoctorFixesMock.mockResolvedValue({ results: [] });
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

  it("exposes the selected shell and reward themes", async () => {
    renderSettingsPage();

    expect(
      await screen.findByRole("button", { name: "Select Obsidian theme" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Select Paper theme" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Select Fantasy" })
    ).toHaveAttribute("aria-pressed", "true");
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

  it("loads a public Google credential summary without resubmitting credential metadata", async () => {
    getSettingsMock.mockResolvedValueOnce({
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
        },
        calendarProviders: {
          google: {
            clientId: "saved-client-id.apps.googleusercontent.com",
            storedClientId: "saved-client-id.apps.googleusercontent.com",
            hasStoredClientSecret: true,
            hasEffectiveClientSecret: true,
            clientSecretStorage: "encrypted"
          }
        },
        modelSettings: {
          forgeAgent: {
            basicChat: {
              connectionId: null,
              model: ""
            },
            wiki: {
              connectionId: null,
              model: ""
            }
          }
        }
      }
    });
    renderSettingsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Save settings" })
    );

    await waitFor(() => expect(patchSettingsMock).toHaveBeenCalledTimes(1));
    const submittedSettings = patchSettingsMock.mock.calls[0]?.[0];
    expect(submittedSettings).not.toHaveProperty("calendarProviders");
    expect(submittedSettings).not.toHaveProperty("modelSettings");
    expect(screen.queryByText("Forge could not finish rendering")).toBeNull();
  });

  it("renders a paired-browser boundary without making operator-only requests", async () => {
    ensureOperatorSessionMock.mockResolvedValueOnce({
      session: {
        id: "paired-browser-session",
        actorLabel: "Paired Browser",
        profile: "trusted_personal_assistant",
        expiresAt: "2026-04-09T19:00:00.000Z"
      }
    });
    getSettingsMock.mockResolvedValueOnce({
      settings: {
        profile: {
          operatorName: "Albert",
          operatorEmail: "",
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
    renderSettingsPage();

    expect(
      await screen.findByText("Global settings stay on the Forge host")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save settings" })
    ).not.toBeInTheDocument();
    expect(getForgeDoctorMock).not.toHaveBeenCalled();
    expect(getCompanionOverviewMock).not.toHaveBeenCalled();
    expect(getGamificationAssetStatusMock).not.toHaveBeenCalled();
    expect(installGamificationAssetStyleMock).not.toHaveBeenCalled();
    expect(patchSettingsMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Forge could not finish rendering")).toBeNull();
  });

  it("restores the persisted shell theme when selection fails", async () => {
    patchSettingsMock.mockRejectedValueOnce(
      new Error("Theme preference could not be saved")
    );
    renderSettingsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Select Paper theme" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Theme preference could not be saved"
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select Obsidian theme" })
      ).toHaveAttribute("aria-pressed", "true")
    );
    expect(
      screen.getByRole("button", { name: "Select Paper theme" })
    ).toHaveAttribute("aria-pressed", "false");
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

  it("shows static mascot and reward art thumbnails for every gamification style", async () => {
    renderSettingsPage();

    await screen.findByText("Gamification style");

    expect(
      screen.getAllByAltText(/neutral Forge Smith mascot preview/i)
    ).toHaveLength(3);
    expect(screen.getAllByAltText(/reward thumbnail/i)).toHaveLength(9);
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

  it("clears the selected user scope when the operator session is reset", async () => {
    window.localStorage.setItem(
      "forge.selected-user-ids",
      JSON.stringify(["user_previous"])
    );
    const { store } = renderSettingsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Reset operator session" })
    );

    await waitFor(() => expect(revokeOperatorSessionMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(store.getState().shell.selectedUserIds).toEqual([])
    );
    expect(
      JSON.parse(window.localStorage.getItem("forge.selected-user-ids") ?? "[]")
    ).toEqual([]);
  });

  it("promotes the mobile companion card while the bridge is not healthy", async () => {
    renderSettingsPage();

    await screen.findAllByText("Connect the iPhone bridge");

    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("Mobile companion")).toBeLessThan(
      bodyText.indexOf("Operator profile")
    );
  });

  it("keeps the settings index available when runtime settings fail", async () => {
    getSettingsMock.mockRejectedValueOnce(
      new Error("Runtime settings are temporarily unavailable")
    );

    renderSettingsPage();

    expect(await screen.findByText("Settings nav")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("keeps the settings index available while runtime settings load", async () => {
    getSettingsMock.mockReturnValueOnce(new Promise<never>(() => {}));

    renderSettingsPage();

    expect(await screen.findByText("Settings nav")).toBeInTheDocument();
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading runtime settings."
    );
  });

  it("keeps all settings return paths visible when operator access fails", async () => {
    ensureOperatorSessionMock.mockRejectedValueOnce(
      new Error("Operator access is unavailable")
    );

    renderSettingsPage();

    expect(await screen.findByText("Settings nav")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Operator access is unavailable"
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("explains Doctor-backed integrity details", async () => {
    renderSettingsPage();

    await screen.findByText("Security posture");
    expect(
      screen.getAllByText(/All active Doctor consistency checks passed/i).length
    ).toBeGreaterThan(0);

    const integritySummary = (await screen.findAllByText(/100% integrity/i))[0];
    const integrityDetails = integritySummary.closest("details");
    expect(integrityDetails).not.toHaveAttribute("open");

    fireEvent.click(integritySummary);

    expect(integrityDetails).toHaveAttribute("open");
    expect(
      await screen.findByText("Integrity is complete")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No active Doctor warnings are holding back integrity/i)
    ).toBeInTheDocument();
  });
});
