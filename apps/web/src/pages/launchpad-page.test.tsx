import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchpadPage } from "@/pages/launchpad-page";

const mocks = vi.hoisted(() => ({
  decideReview: vi.fn(),
  deleteFeedback: vi.fn(),
  getFeedback: vi.fn(),
  getOnboarding: vi.fn(),
  installPackage: vi.fn(),
  listImports: vi.fn(),
  listInstalls: vi.fn(),
  listPackages: vi.fn(),
  listReviews: vi.fn(),
  previewImport: vi.fn(),
  previewPackage: vi.fn(),
  removeInstall: vi.fn(),
  rollbackImport: vi.fn(),
  updateFeedback: vi.fn(),
  updateOnboarding: vi.fn(),
  commitImport: vi.fn(),
  discardOffline: vi.fn(),
  retryOffline: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({
    selectedUserIds: ["user_operator"],
    snapshot: { users: [{ id: "user_operator", kind: "human" }] },
    refresh: mocks.refresh,
    offlineMutationOutbox: {
      isOnline: true,
      discard: mocks.discardOffline,
      retryConflict: mocks.retryOffline,
      entries: [
        {
          id: "offline-1",
          taskId: "task-1",
          taskLabel: "Ship the release",
          desiredStatus: "done",
          state: "conflicted",
          summary: "The task changed on another device.",
          expectedUpdatedAt: "2026-08-12T10:00:00.000Z",
          current: { status: "ongoing" }
        }
      ]
    }
  })
}));

vi.mock("@/components/distribution-center", () => ({
  DistributionCenter: () => <div>Signed desktop and companion distribution</div>
}));

vi.mock("@/lib/api", () => ({
  commitLaunchpadImport: (...args: unknown[]) => mocks.commitImport(...args),
  decideLaunchpadReview: (...args: unknown[]) => mocks.decideReview(...args),
  deleteLaunchpadFeedback: (...args: unknown[]) => mocks.deleteFeedback(...args),
  getLaunchpadFeedback: (...args: unknown[]) => mocks.getFeedback(...args),
  getLaunchpadOnboarding: (...args: unknown[]) => mocks.getOnboarding(...args),
  installLaunchpadPackage: (...args: unknown[]) => mocks.installPackage(...args),
  listLaunchpadImports: (...args: unknown[]) => mocks.listImports(...args),
  listLaunchpadPackageInstalls: (...args: unknown[]) => mocks.listInstalls(...args),
  listLaunchpadPackages: (...args: unknown[]) => mocks.listPackages(...args),
  listLaunchpadReviews: (...args: unknown[]) => mocks.listReviews(...args),
  previewLaunchpadImport: (...args: unknown[]) => mocks.previewImport(...args),
  previewLaunchpadPackage: (...args: unknown[]) => mocks.previewPackage(...args),
  removeLaunchpadPackageInstall: (...args: unknown[]) => mocks.removeInstall(...args),
  rollbackLaunchpadImport: (...args: unknown[]) => mocks.rollbackImport(...args),
  updateLaunchpadFeedback: (...args: unknown[]) => mocks.updateFeedback(...args),
  updateLaunchpadOnboarding: (...args: unknown[]) => mocks.updateOnboarding(...args)
}));

const starter = {
  id: "starter.plan-week",
  version: "1.0.0",
  kind: "starter_pack" as const,
  title: "Plan a useful week",
  summary: "Create a small weekly planning system.",
  outcomeKey: "plan_week" as const,
  author: "Forge",
  reviewState: "forge_reviewed" as const,
  compatibility: "Forge 0.3.55 or newer",
  permissions: ["Create one Goal", "Create three Tasks"],
  records: [],
  setupHref: null,
  manifestSha256: "a".repeat(64)
};

function renderLaunchpad(entry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <LaunchpadPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Launchpad", () => {
  beforeEach(() => {
    mocks.listPackages.mockResolvedValue({ packages: [starter] });
    mocks.listInstalls.mockResolvedValue({ installs: [] });
    mocks.getOnboarding.mockResolvedValue({
      onboarding: {
        ownerUserId: "user_operator",
        outcomeKey: null,
        currentStep: "choose_outcome",
        status: "not_started",
        installedPackageId: null,
        lastResultHref: null,
        createdAt: null,
        updatedAt: null
      }
    });
    mocks.listImports.mockResolvedValue({
      imports: [
        {
          id: "import-1",
          sourceKind: "notion",
          sourceLabel: "notion-export.json",
          status: "committed",
          created: [
            {
              sourceId: "page-1",
              entityType: "note",
              entityId: "note-1",
              title: "Imported decision",
              href: "/notes?focus=note-1"
            }
          ],
          skipped: [],
          committedAt: "2026-08-12T10:00:00.000Z",
          createdAt: "2026-08-12T09:59:00.000Z",
          updatedAt: "2026-08-12T10:00:00.000Z"
        }
      ]
    });
    mocks.listReviews.mockResolvedValue({
      items: [
        {
          id: "relationship:proposal-1",
          kind: "relationship_proposal",
          sourceType: "relationship_proposal",
          sourceId: "proposal-1",
          revision: 3,
          status: "pending",
          title: "Link evidence to goal",
          summary: "Both records describe the same outcome.",
          proposedAction: { relationship: "supports" },
          evidence: [{ matchedTerms: ["outcome"] }],
          createdAt: "2026-08-12T10:00:00.000Z",
          updatedAt: "2026-08-12T10:00:00.000Z"
        }
      ]
    });
    mocks.rollbackImport.mockResolvedValue({
      rollback: { importId: "import-1", status: "rolled_back", replayed: false }
    });
    mocks.updateOnboarding.mockResolvedValue({ onboarding: {} });
    mocks.getFeedback.mockResolvedValue({
      feedback: {
        settings: { ownerUserId: "user_operator", enabled: false },
        events: [],
        policy: { transport: "local_only", allowedFields: [], prohibitedFields: [], retentionDays: 90 }
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows durable import receipts and requires explicit rollback confirmation", async () => {
    renderLaunchpad("/launchpad?tab=imports");
    await screen.findByText("Import receipts and rollback");
    expect(screen.getByRole("link", { name: "Imported decision" })).toHaveAttribute(
      "href",
      "/notes?focus=note-1"
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    expect(screen.getByText(/Move all 1 created record to the bin/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm rollback" }));
    await waitFor(() => expect(mocks.rollbackImport).toHaveBeenCalledWith("import-1", "user_operator"));
  });

  it("combines server proposals and browser-local offline conflicts in one decision queue", async () => {
    renderLaunchpad("/launchpad?tab=reviews");
    await screen.findByText("One place for decisions that must not be automatic");
    expect(screen.getByText("Move Ship the release to done")).toBeTruthy();
    expect(screen.getByText("Link evidence to goal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply to current revision" }));
    expect(mocks.retryOffline).toHaveBeenCalledWith("offline-1");
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() =>
      expect(mocks.decideReview).toHaveBeenCalledWith("relationship:proposal-1", {
        ownerUserId: "user_operator",
        expectedRevision: 3,
        decision: "accept"
      })
    );
  });

  it("keeps privacy feedback off by default and states the local-only boundary", async () => {
    renderLaunchpad("/launchpad?tab=privacy");
    await screen.findByText("Privacy-preserving product feedback");
    expect(screen.getByText("Off by default")).toBeTruthy();
    expect(screen.getByText(/does not transmit them/u)).toBeTruthy();
    expect(screen.getByText(/Local retention: 90 days/u)).toBeTruthy();
  });
});
