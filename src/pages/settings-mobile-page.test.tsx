import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsMobilePage } from "@/pages/settings-mobile-page";
import type { CompanionPairingSession } from "@/lib/types";

const {
  getCompanionOverviewMock,
  createCompanionPairingSessionMock,
  patchCompanionPairingSourceStateMock,
  revokeAllCompanionPairingSessionsMock,
  revokeCompanionPairingSessionMock
} = vi.hoisted(() => ({
  getCompanionOverviewMock: vi.fn(),
  createCompanionPairingSessionMock: vi.fn(),
  patchCompanionPairingSourceStateMock: vi.fn(),
  revokeAllCompanionPairingSessionsMock: vi.fn(),
  revokeCompanionPairingSessionMock: vi.fn()
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async () => "data:image/png;base64,test")
  }
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge
  }: {
    title: string;
    description: string;
    badge?: string;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {badge ? <span>{badge}</span> : null}
    </div>
  )
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>
}));

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/components/ui/page-state", () => ({
  ErrorState: ({ error }: { error: Error }) => <div>{error.message}</div>
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({
    selectedUserIds: ["user_operator"]
  })
}));

vi.mock("@/lib/api", () => ({
  getCompanionOverview: (...args: unknown[]) => getCompanionOverviewMock(...args),
  createCompanionPairingSession: (...args: unknown[]) =>
    createCompanionPairingSessionMock(...args),
  patchCompanionPairingSourceState: (...args: unknown[]) =>
    patchCompanionPairingSourceStateMock(...args),
  revokeAllCompanionPairingSessions: (...args: unknown[]) =>
    revokeAllCompanionPairingSessionsMock(...args),
  revokeCompanionPairingSession: (...args: unknown[]) =>
    revokeCompanionPairingSessionMock(...args)
}));

function createPairing(overrides: Partial<CompanionPairingSession> = {}): CompanionPairingSession {
  return {
    id: "pairing_1",
    userId: "user_operator",
    label: "Omar iPhone",
    status: "healthy",
    capabilities: ["background-sync"],
    deviceName: "Omar iPhone",
    platform: "ios",
    appVersion: "1.0",
    apiBaseUrl: "https://forge.test/api/v1",
    lastSeenAt: "2026-04-12T09:04:00.000Z",
    lastSyncAt: "2026-04-12T09:03:00.000Z",
    lastSyncError: null,
    pairedAt: "2026-04-12T08:58:00.000Z",
    sourceStates: {
      health: {
        desiredEnabled: true,
        appliedEnabled: true,
        authorizationStatus: "approved",
        syncEligible: true,
        lastObservedAt: "2026-04-12T09:04:00.000Z",
        metadata: {}
      },
      movement: {
        desiredEnabled: true,
        appliedEnabled: false,
        authorizationStatus: "pending",
        syncEligible: false,
        lastObservedAt: "2026-04-12T09:04:00.000Z",
        metadata: {}
      },
      screenTime: {
        desiredEnabled: false,
        appliedEnabled: false,
        authorizationStatus: "disabled",
        syncEligible: false,
        lastObservedAt: null,
        metadata: {}
      }
    },
    expiresAt: "2026-04-13T09:00:00.000Z",
    createdAt: "2026-04-12T08:58:00.000Z",
    updatedAt: "2026-04-12T09:04:00.000Z",
    ...overrides
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsMobilePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsMobilePage", () => {
  beforeEach(() => {
    getCompanionOverviewMock.mockResolvedValue({
      overview: {
        healthState: "healthy",
        counts: {
          sleepSessions: 4,
          workouts: 3,
          reflectiveSleepSessions: 2,
          linkedWorkouts: 1,
          habitGeneratedWorkouts: 0,
          reconciledWorkouts: 1
        },
        lastSyncAt: "2026-04-12T09:03:00.000Z",
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          locationReady: true,
          motionReady: true
        },
        pairings: [createPairing()],
        importRuns: []
      }
    });
    createCompanionPairingSessionMock.mockResolvedValue({});
    patchCompanionPairingSourceStateMock.mockResolvedValue({});
    revokeAllCompanionPairingSessionsMock.mockResolvedValue({});
    revokeCompanionPairingSessionMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows pending phone reconciliation and lets the web toggle a source", async () => {
    renderPage();

    expect(await screen.findByText("Device sync sources")).toBeInTheDocument();
    expect(screen.getByText("Pending on phone")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Companion Sync Lab" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Health sync source" }));

    await waitFor(() => {
      expect(patchCompanionPairingSourceStateMock).toHaveBeenCalledWith(
        "pairing_1",
        "health",
        false
      );
    });
  });
});
