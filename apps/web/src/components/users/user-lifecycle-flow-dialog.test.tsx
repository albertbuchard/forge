import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserLifecycleFlowDialog } from "@/components/users/user-lifecycle-flow-dialog";
import type { UserIdentityEvidence, UserSummary } from "@/lib/types";

const { getUserDeactivationPreviewMock } = vi.hoisted(() => ({
  getUserDeactivationPreviewMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getUserDeactivationPreview: getUserDeactivationPreviewMock
}));

const operator: UserSummary = {
  id: "user_operator",
  kind: "human",
  lifecycleStatus: "active",
  handle: "operator",
  displayName: "Forge Operator",
  description: "Primary operator",
  accentColor: "#f4b97a",
  createdAt: "2026-08-12T08:00:00.000Z",
  updatedAt: "2026-08-12T08:00:00.000Z"
};

const bot: UserSummary = {
  id: "user_agent_codex",
  kind: "bot",
  lifecycleStatus: "active",
  handle: "codex",
  displayName: "Codex",
  description: "Coding agent",
  accentColor: "#22c55e",
  createdAt: "2026-08-12T08:00:00.000Z",
  updatedAt: "2026-08-12T08:00:00.000Z"
};

const botEvidence: UserIdentityEvidence = {
  userId: bot.id,
  lifecycleStatus: "active",
  identityKind: "linked_bot",
  trustState: "verified_runtime",
  linkedAgentIds: ["agt_codex"],
  providers: ["codex"],
  actorLabels: ["Codex"],
  sessionCount: 1,
  connectedSessionCount: 1,
  lastSeenAt: "2026-08-12T09:00:00.000Z"
};

function renderDialog(
  user: UserSummary,
  props: Partial<React.ComponentProps<typeof UserLifecycleFlowDialog>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const onDeactivate = vi.fn().mockResolvedValue(undefined);
  const onReactivate = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={client}>
      <UserLifecycleFlowDialog
        open
        onOpenChange={vi.fn()}
        user={user}
        activeUsers={[
          operator,
          ...(user.lifecycleStatus === "active" ? [bot] : [])
        ]}
        identityEvidence={botEvidence}
        pending={false}
        onDeactivate={onDeactivate}
        onReactivate={onReactivate}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onDeactivate, onReactivate };
}

describe("UserLifecycleFlowDialog", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("requires an exact preview, session-disconnect confirmation, and reason before deactivation", async () => {
    getUserDeactivationPreviewMock.mockResolvedValue({
      preview: {
        user: bot,
        replacementUser: operator,
        ownership: [{ entityType: "project", count: 2 }],
        assignments: [{ entityType: "task", count: 3 }],
        ownershipDefaultDependents: 1,
        activeRuntimeSessions: 1,
        activeAgentTokens: 1,
        totalOwnedEntities: 2,
        totalAssignments: 3,
        requiresSessionDisconnect: true,
        canDeactivate: true,
        blockers: []
      }
    });
    const { onDeactivate } = renderDialog(bot);

    expect(screen.getByText("verified_runtime")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("2 project owned")).toBeInTheDocument();
    expect(screen.getByText("3 task assigned")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Disconnect the 1 active runtime session/i
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
      target: { value: "Transfer the active work to the operator." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Transfer and deactivate" })
    );

    await waitFor(() =>
      expect(onDeactivate).toHaveBeenCalledWith({
        replacementUserId: operator.id,
        reason: "Transfer the active work to the operator.",
        disconnectActiveSessions: true
      })
    );
  });

  it("reactivates without claiming that revoked credentials return", async () => {
    const inactiveBot: UserSummary = {
      ...bot,
      lifecycleStatus: "inactive",
      lifecycleReason: "Access was removed after the project ended.",
      deactivatedAt: "2026-08-12T09:00:00.000Z"
    };
    const { onReactivate } = renderDialog(inactiveBot, {
      identityEvidence: {
        ...botEvidence,
        lifecycleStatus: "inactive",
        trustState: "inactive",
        connectedSessionCount: 0
      }
    });

    expect(
      screen.getByText("Access was removed after the project ended.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByText(/Revoked agent tokens stay revoked/i)
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
      target: { value: "The collaborator returned with fresh credentials." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Reactivate user" }));

    await waitFor(() =>
      expect(onReactivate).toHaveBeenCalledWith(
        "The collaborator returned with fresh credentials."
      )
    );
  });
});
