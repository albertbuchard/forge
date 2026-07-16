import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PreferenceWorkspacePayload, UserSummary } from "@/lib/types";
import {
  PreferenceWorkspaceControls,
  PreferenceWorkspaceTabNav
} from "./preference-workspace-chrome";

const user: UserSummary = {
  id: "user_1",
  kind: "human",
  handle: "operator",
  displayName: "Operator",
  description: "",
  accentColor: "#336699",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const workspace = {
  selectedContext: {
    name: "Default",
    shareMode: "shared"
  },
  compare: { pendingCount: 2 },
  libraries: { totalCatalogItems: 48 }
} as PreferenceWorkspacePayload;

describe("preference workspace chrome", () => {
  it("exposes touch-sized pressed-state controls without incomplete tab semantics", () => {
    const onPatchSearch = vi.fn();
    render(
      <>
        <PreferenceWorkspaceControls
          users={[user]}
          user={user}
          selectedUserId={user.id}
          selectedDomain="projects"
          workspace={workspace}
          onPatchSearch={onPatchSearch}
        />
        <PreferenceWorkspaceTabNav
          selectedTab="overview"
          onSelectTab={(tab) => onPatchSearch({ tab })}
        />
      </>
    );

    expect(screen.getByLabelText("Active preference user")).toHaveClass(
      "min-h-11"
    );
    const domainGroup = screen.getByRole("group", {
      name: "Preference domain"
    });
    const projects = within(domainGroup).getByRole("button", {
      name: "Projects"
    });
    expect(projects).toHaveAttribute("aria-pressed", "true");
    expect(projects).toHaveClass("min-h-11");

    const viewGroup = screen.getByRole("group", { name: "Preference views" });
    const overview = within(viewGroup).getByRole("button", {
      name: "Overview"
    });
    expect(overview).toHaveAttribute("aria-pressed", "true");
    expect(overview).toHaveClass("min-h-11");
    expect(within(viewGroup).queryByRole("tab")).not.toBeInTheDocument();

    fireEvent.click(within(viewGroup).getByRole("button", { name: "Map" }));
    expect(onPatchSearch).toHaveBeenCalledWith({ tab: "map" });
  });
});
