import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelationshipProposalReview } from "@/components/knowledge-graph/relationship-proposal-review";
import type { RelationshipProposal, RelationshipProposalList } from "@/lib/types";

const {
  getRelationshipProposalsMock,
  generateRelationshipProposalsMock,
  decideRelationshipProposalMock
} = vi.hoisted(() => ({
  getRelationshipProposalsMock: vi.fn(),
  generateRelationshipProposalsMock: vi.fn(),
  decideRelationshipProposalMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getRelationshipProposals: getRelationshipProposalsMock,
  generateRelationshipProposals: generateRelationshipProposalsMock,
  decideRelationshipProposal: decideRelationshipProposalMock
}));

const proposal: RelationshipProposal = {
  id: "proposal-1",
  ownerUserId: "user_operator",
  source: {
    entityType: "task",
    entityId: "task-1",
    title: "Prepare violet compass milestone",
    detail: "Advance the milestone.",
    sourceHref: "/tasks/task-1",
    graphHref: "/knowledge-graph?focus=task%3Atask-1"
  },
  target: {
    entityType: "goal",
    entityId: "goal-1",
    title: "Violet compass milestone",
    detail: "Reach the milestone.",
    sourceHref: "/goals/goal-1",
    graphHref: "/knowledge-graph?focus=goal%3Agoal-1"
  },
  relationship: "supports",
  evidence: [
    {
      sourceField: "Title",
      targetField: "Title",
      matchedTerms: ["compass", "milestone", "violet"]
    }
  ],
  explanation: "The task shares specific terms and may support the goal.",
  confidence: 0.94,
  generator: { id: "forge-local-overlap", version: "1.0.0" },
  status: "pending",
  revision: 1,
  expiresAt: "2099-08-16T12:00:00.000Z",
  createdAt: "2026-08-09T12:00:00.000Z",
  updatedAt: "2026-08-09T12:00:00.000Z"
};

function list(proposals: RelationshipProposal[]): RelationshipProposalList {
  return {
    proposals,
    total: proposals.length,
    shown: proposals.length,
    limit: 20,
    generatedAt: "2026-08-09T12:00:00.000Z"
  };
}

function renderReview(
  options: { ownerUserId?: string | null; onAccepted?: () => void } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const onAccepted = options.onAccepted ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RelationshipProposalReview
        open
        onOpenChange={vi.fn()}
        ownerUserId={
          Object.prototype.hasOwnProperty.call(options, "ownerUserId")
            ? (options.ownerUserId ?? null)
            : "user_operator"
        }
        onAccepted={onAccepted}
      />
    </QueryClientProvider>
  );
  return { onAccepted };
}

describe("RelationshipProposalReview", () => {
  beforeEach(() => {
    getRelationshipProposalsMock.mockResolvedValue(list([proposal]));
    generateRelationshipProposalsMock.mockResolvedValue({
      ...list([proposal]),
      generation: {
        generator: { id: "forge-local-overlap", version: "1.0.0" },
        consideredDocuments: 2,
        comparisons: 1,
        created: 1,
        unauthorizedCandidateCount: 0,
        truncated: false
      }
    });
    decideRelationshipProposalMock.mockResolvedValue({
      decision: {
        status: "accepted",
        proposalId: proposal.id,
        revision: 2,
        linkCreated: true,
        replayed: false
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("explains the confirmation boundary and requires exactly one selected owner", () => {
    renderReview({ ownerUserId: null });
    expect(
      screen.getByText(/Review suggested links before Forge writes them/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Select exactly one person/i)).toBeInTheDocument();
    expect(getRelationshipProposalsMock).not.toHaveBeenCalled();
  });

  it("shows directional evidence, sources, confidence, generator, and expiry", async () => {
    renderReview();
    expect(await screen.findByText("Prepare violet compass milestone")).toBeInTheDocument();
    expect(screen.getByText("Violet compass milestone")).toBeInTheDocument();
    expect(screen.getByText(/94% confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Generator forge-local-overlap 1.0.0/i)).toBeInTheDocument();
    expect(screen.getByText("compass")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open source/i })).toHaveLength(2);
  });

  it("accepts only after the explicit control and refreshes the graph", async () => {
    const { onAccepted } = renderReview();
    fireEvent.click(await screen.findByRole("button", { name: /Accept link/i }));
    await waitFor(() =>
      expect(decideRelationshipProposalMock).toHaveBeenCalledWith({
        proposalId: proposal.id,
        ownerUserId: proposal.ownerUserId,
        expectedRevision: proposal.revision,
        action: "accept"
      })
    );
    await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
    expect(screen.getByText(/Relationship added/i)).toBeInTheDocument();
  });

  it("rejects without claiming that a link was written", async () => {
    getRelationshipProposalsMock
      .mockResolvedValueOnce(list([proposal]))
      .mockResolvedValue(list([]));
    decideRelationshipProposalMock.mockResolvedValue({
      decision: {
        status: "rejected",
        proposalId: proposal.id,
        revision: 2,
        linkCreated: false,
        replayed: false
      }
    });
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: /^Reject$/i }));
    await waitFor(() =>
      expect(decideRelationshipProposalMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "reject" })
      )
    );
    expect(await screen.findByText(/No relationship was written/i)).toBeInTheDocument();
  });

  it("finds suggestions only on demand and reports an empty result truthfully", async () => {
    getRelationshipProposalsMock.mockResolvedValue(list([]));
    generateRelationshipProposalsMock.mockResolvedValue({
      ...list([]),
      generation: {
        generator: { id: "forge-local-overlap", version: "1.0.0" },
        consideredDocuments: 8,
        comparisons: 28,
        created: 0,
        unauthorizedCandidateCount: 0,
        truncated: false
      }
    });
    renderReview();
    expect(await screen.findByText("No pending suggestions")).toBeInTheDocument();
    expect(generateRelationshipProposalsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Find suggestions/i }));
    await waitFor(() =>
      expect(generateRelationshipProposalsMock).toHaveBeenCalledWith("user_operator")
    );
    expect(await screen.findByText(/found no new suggestions/i)).toBeInTheDocument();
  });

  it("keeps stale and server failures explicit", async () => {
    decideRelationshipProposalMock.mockRejectedValue(
      new Error("The suggestion is no longer current. No relationship was changed.")
    );
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: /Accept link/i }));
    expect(
      await screen.findByText(/no longer current.*No relationship was changed/i)
    ).toBeInTheDocument();
  });
});
