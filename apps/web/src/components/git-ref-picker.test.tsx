import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitRefPicker } from "./git-ref-picker";

vi.mock("@/lib/api", () => ({
  getGitHelperOverview: vi.fn(async () => ({
    git: {
      repoRoot: "/repo",
      provider: "github",
      repository: "albertbuchard/aurel-monorepo",
      currentBranch: "agent/demo-branch",
      baseBranch: "main",
      branches: [],
      commits: [],
      pullRequests: [],
      warnings: []
    }
  })),
  searchGitHelperRefs: vi.fn(async () => ({
    git: {
      provider: "github",
      repository: "albertbuchard/aurel-monorepo",
      kind: "branch",
      refs: [
        {
          key: "branch:agent/demo-branch",
          refType: "branch",
          provider: "github",
          repository: "albertbuchard/aurel-monorepo",
          refValue: "agent/demo-branch",
          url: "https://github.com/albertbuchard/aurel-monorepo/tree/agent/demo-branch",
          displayTitle: "agent/demo-branch",
          subtitle: "Current branch"
        }
      ],
      warnings: []
    }
  }))
}));

describe("GitRefPicker", () => {
  it("adds the current branch from helper results", async () => {
    const onChange = vi.fn();

    render(<GitRefPicker selectedRefs={[]} onChange={onChange} />);

    expect(
      await screen.findByRole("button", { name: /use current branch/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /use current branch/i }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            refType: "branch",
            repository: "albertbuchard/aurel-monorepo",
            refValue: "agent/demo-branch"
          })
        ])
      );
    });
  });
});
