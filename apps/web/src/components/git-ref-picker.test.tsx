import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchGitHelperRefs } from "@/lib/api";
import {
  createDraftGitRefId,
  getSafeGitRefHref,
  GitRefPicker,
  type DraftGitRef
} from "./git-ref-picker";

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
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the current branch from helper results", async () => {
    const onChange = vi.fn();

    render(<GitRefPicker selectedRefs={[]} onChange={onChange} />);

    expect(
      await screen.findByRole("button", { name: /use current branch/i })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /use current branch/i })
    );

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
    const addedRef = onChange.mock.calls[0]?.[0]?.[0] as DraftGitRef;
    expect(addedRef.id).toMatch(/^gitref_draft_[a-f0-9]{32}$/);
    expect(addedRef.id?.length).toBeLessThanOrEqual(128);
  });

  it("debounces searches and labels reference actions", async () => {
    render(<GitRefPicker selectedRefs={[]} onChange={vi.fn()} />);

    await screen.findByRole("button", { name: /use current branch/i });
    fireEvent.change(screen.getByPlaceholderText("Search branches"), {
      target: { value: "feature closeout" }
    });

    expect(searchGitHelperRefs).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: "feature closeout" })
    );
    await waitFor(
      () => {
        expect(searchGitHelperRefs).toHaveBeenCalledWith(
          expect.objectContaining({ query: "feature closeout" })
        );
      },
      { timeout: 1_000 }
    );
    expect(
      await screen.findByRole("link", { name: "Open agent/demo-branch" })
    ).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
  });

  it("never renders an unsafe stored Git URL as a link", () => {
    const selectedRef: DraftGitRef = {
      id: "gitref_unsafe",
      workItemId: "task_1",
      refType: "commit",
      provider: "git",
      repository: "owner/repo",
      refValue: "abc123",
      url: "javascript:alert(1)",
      displayTitle: "Unsafe legacy reference"
    };

    render(<GitRefPicker selectedRefs={[selectedRef]} onChange={vi.fn()} />);

    expect(
      screen.queryByRole("link", { name: /unsafe legacy reference/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Unsafe legacy reference" })
    ).toBeInTheDocument();
    expect(getSafeGitRefHref(selectedRef.url)).toBeNull();
  });

  it("allocates a bounded safe draft id without secure-context UUID support", () => {
    expect(createDraftGitRefId(null)).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    expect(createDraftGitRefId(null).length).toBeLessThanOrEqual(128);
  });
});
