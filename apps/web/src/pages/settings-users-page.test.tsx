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
  patchUserAccessGrant: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  setUserOwnershipDefault: vi.fn()
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

vi.mock("@/components/users/user-lifecycle-flow-dialog", () => ({
  UserLifecycleFlowDialog: () => null
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

  it("states the bounded active/inactive identity and ownership-transfer contract", async () => {
    getUserDirectoryMock.mockResolvedValue({
      directory: {
        users: [
          {
            id: "user_operator",
            kind: "human",
            lifecycleStatus: "active",
            handle: "operator",
            displayName: "Operator",
            description: "Primary operator",
            accentColor: "#f4b97a",
            createdAt: "2026-08-12T08:00:00.000Z",
            updatedAt: "2026-08-12T08:00:00.000Z"
          }
        ],
        inactiveUsers: [
          {
            id: "user_inactive",
            kind: "bot",
            lifecycleStatus: "inactive",
            handle: "retired_bot",
            displayName: "Retired Bot",
            description: "Historical bot",
            accentColor: "#64748b",
            createdAt: "2026-08-12T08:00:00.000Z",
            updatedAt: "2026-08-12T09:00:00.000Z"
          }
        ],
        grants: [],
        ownership: [],
        xp: [],
        ownershipDefaults: [
          {
            subjectUserId: "user_inactive",
            ownerUserId: "user_operator",
            updatedByActor: "Lifecycle operator",
            createdAt: "2026-08-12T08:00:00.000Z",
            updatedAt: "2026-08-12T09:00:00.000Z"
          }
        ],
        identityEvidence: [
          {
            userId: "user_inactive",
            lifecycleStatus: "inactive",
            identityKind: "linked_bot",
            trustState: "inactive",
            linkedAgentIds: ["agt_retired"],
            providers: ["codex"],
            actorLabels: ["Retired Bot"],
            sessionCount: 2,
            connectedSessionCount: 0,
            lastSeenAt: "2026-08-12T09:00:00.000Z"
          }
        ],
        posture: {
          accessModel: "directional_graph",
          summary: "Directional access is enforced.",
          futureReady: true
        }
      }
    });
    renderPage();

    expect(
      await screen.findByText(/Active and inactive identities remain distinct/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Inactive users")).toBeInTheDocument();
    expect(screen.getByText("Retired Bot")).toBeInTheDocument();
    expect(screen.getAllByText("inactive", { selector: "span" })).toHaveLength(
      2
    );
    expect(
      screen.getByRole("button", { name: "Reactivate" })
    ).toBeInTheDocument();
    expect(
      screen.getAllByLabelText("Default owner for new work by this identity")
    ).toHaveLength(2);
    for (const defaultOwnerControl of screen.getAllByLabelText(
      "Default owner for new work by this identity"
    )) {
      expect(defaultOwnerControl).toHaveValue("user_operator");
    }
    expect(screen.getByText("Relationship graph")).toBeInTheDocument();
  });
});
