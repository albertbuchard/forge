import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserRelationshipFlowDialog } from "@/components/users/user-relationship-flow-dialog";
import type { UserAccessGrant, UserSummary } from "@/lib/types";

vi.mock("@/components/flows/question-flow-dialog", () => ({
  FlowChoiceGrid: ({
    options
  }: {
    options: Array<{ value: string; label: string }>;
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} type="button">
          {option.label}
        </button>
      ))}
    </div>
  ),
  QuestionFlowDialog: ({
    open,
    value,
    steps,
    onSubmit
  }: {
    open: boolean;
    value: unknown;
    steps: Array<{
      id: string;
      render: (
        value: unknown,
        setValue: (patch: Record<string, unknown>) => void
      ) => ReactNode;
    }>;
    onSubmit: () => Promise<void>;
  }) =>
    open ? (
      <div>
        {steps.map((step) => (
          <section key={step.id}>{step.render(value, () => undefined)}</section>
        ))}
        <button type="button" onClick={() => void onSubmit()}>
          Save relationship
        </button>
      </div>
    ) : null
}));

function user(id: string, displayName: string): UserSummary {
  return {
    id,
    kind: "human",
    handle: id,
    displayName,
    description: "",
    accentColor: "#112233",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  };
}

function grant(
  id: string,
  subjectUser: UserSummary,
  targetUser: UserSummary
): UserAccessGrant {
  return {
    id,
    subjectUserId: subjectUser.id,
    targetUserId: targetUser.id,
    accessLevel: "manage",
    config: {
      self: false,
      mutable: true,
      linkedEntities: true,
      rights: {
        discoverable: true,
        canListUsers: true,
        canReadProfile: true,
        canReadEntities: true,
        canSearchEntities: true,
        canLinkEntities: true,
        canCoordinate: true,
        canAffectEntities: true,
        canManageStrategies: true,
        canCreateOnBehalf: true,
        canViewMetrics: true,
        canViewActivity: true
      }
    },
    subjectUser,
    targetUser,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  };
}

describe("UserRelationshipFlowDialog", () => {
  afterEach(cleanup);

  it("saves exactly one direction even when the reverse arrow exists", async () => {
    const human = user("human", "Human");
    const bot = user("bot", "Bot");
    const outbound = grant("grant_out", human, bot);
    const reverse = grant("grant_back", bot, human);
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <UserRelationshipFlowDialog
        open
        onOpenChange={() => undefined}
        grant={outbound}
        grants={[outbound, reverse]}
        onSubmit={onSubmit}
      />
    );

    expect(screen.queryByText("Both arrows")).not.toBeInTheDocument();
    expect(screen.getByText("One direction per save")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save relationship" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          grantId: "grant_out",
          reverseGrantId: "grant_back",
          applyToReverse: false
        })
      )
    );
  });
});
