import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsUsersPage } from "@/pages/settings-users-page";

const { getUserDirectoryMock } = vi.hoisted(() => ({
  getUserDirectoryMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getUserDirectory: getUserDirectoryMock,
  createUser: vi.fn(),
  patchUser: vi.fn(),
  patchUserAccessGrant: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({
    snapshot: { users: [] },
    refresh: vi.fn()
  })
}));

vi.mock("@/components/users/user-relationship-graph", () => ({
  UserRelationshipGraph: () => <div>Relationship graph</div>,
  buildGrantCapabilitySummary: () => [],
  countEnabledRights: () => 0,
  summarizeGrant: () => "Hidden",
  TOTAL_RIGHTS: 12
}));

vi.mock("@/components/users/user-settings-flow-dialog", () => ({
  UserSettingsFlowDialog: () => null
}));

vi.mock("@/components/users/user-relationship-flow-dialog", () => ({
  UserRelationshipFlowDialog: () => null
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsUsersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsUsersPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not substitute an empty permissive graph while the directory fails", async () => {
    getUserDirectoryMock.mockRejectedValue(new Error("Directory unavailable"));
    renderPage();

    expect(
      await screen.findByText("Directory unavailable")
    ).toBeInTheDocument();
    expect(screen.queryByText("default open")).not.toBeInTheDocument();
  });

  it("states the bounded active-identity and ownership-transfer contract", async () => {
    getUserDirectoryMock.mockResolvedValue({
      directory: {
        users: [],
        grants: [],
        ownership: [],
        xp: [],
        posture: {
          accessModel: "directional_graph",
          summary: "Directional access is enforced.",
          futureReady: true
        }
      }
    });
    renderPage();

    expect(
      await screen.findByText(/currently exposes active identities/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Relationship graph")).toBeInTheDocument();
  });
});
