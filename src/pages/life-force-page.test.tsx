import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { LifeForcePage } from "@/pages/life-force-page";

const { useForgeShellMock, userScopeSelectorMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  userScopeSelectorMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock,
  UserScopeSelector: (props: {
    users: Array<{ id: string; displayName: string }>;
    selectedUserIds: string[];
    onChange: (userIds: string[]) => void;
  }) => {
    userScopeSelectorMock(props);
    return <div>User scope selector</div>;
  }
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    titleText,
    description,
    badge,
    actions
  }: {
    titleText: string;
    description: string;
    badge?: string;
    actions?: ReactNode;
  }) => (
    <div>
      <div>{titleText}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
      {actions}
    </div>
  )
}));

vi.mock("@/components/life-force/life-force-workspace", () => ({
  LifeForceOverviewWorkspace: () => <div>Life Force workspace</div>
}));

describe("LifeForcePage", () => {
  it("renders the shared user scope selector in the page hero", () => {
    const setSelectedUserIds = vi.fn();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      setSelectedUserIds,
      refresh: vi.fn(),
      snapshot: {
        users: [
          {
            id: "user_operator",
            displayName: "Albert",
            handle: "@albert",
            kind: "human"
          }
        ],
        lifeForce: {
          spentTodayAp: 120,
          dailyBudgetAp: 210
        }
      }
    });

    render(<LifeForcePage />);

    expect(screen.getByText("Life Force")).toBeInTheDocument();
    expect(screen.getByText("User scope selector")).toBeInTheDocument();
    expect(userScopeSelectorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        users: expect.arrayContaining([
          expect.objectContaining({ id: "user_operator" })
        ]),
        selectedUserIds: ["user_operator"],
        onChange: setSelectedUserIds
      })
    );
  });
});
