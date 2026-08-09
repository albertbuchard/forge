import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AttentionInboxPage } from "@/pages/attention-inbox-page";
import type {
  AttentionInboxItem,
  AttentionInboxPayload,
  AttentionInboxState
} from "@/lib/types";

const {
  createAttentionResolutionIdempotencyKeyMock,
  getAttentionInboxMock,
  getAttentionResolutionsMock,
  checkAttentionResolutionsMock,
  startAttentionResolutionActionMock,
  snoozeAttentionInboxItemMock,
  dismissAttentionInboxItemMock,
  restoreAttentionInboxItemMock,
  undoMutationReceiptMock
} = vi.hoisted(() => ({
  createAttentionResolutionIdempotencyKeyMock: vi.fn(),
  getAttentionInboxMock: vi.fn(),
  getAttentionResolutionsMock: vi.fn(),
  checkAttentionResolutionsMock: vi.fn(),
  startAttentionResolutionActionMock: vi.fn(),
  snoozeAttentionInboxItemMock: vi.fn(),
  dismissAttentionInboxItemMock: vi.fn(),
  restoreAttentionInboxItemMock: vi.fn(),
  undoMutationReceiptMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({ selectedUserIds: ["user_operator"] })
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge,
    actions
  }: {
    title: ReactNode;
    description: ReactNode;
    badge?: ReactNode;
    actions?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {badge}
      {actions}
    </header>
  )
}));

vi.mock("@/lib/api", () => ({
  createMutationReceiptUndoKey: () => "undo_attention_test",
  createAttentionResolutionIdempotencyKey:
    createAttentionResolutionIdempotencyKeyMock,
  checkAttentionResolutions: checkAttentionResolutionsMock,
  getAttentionInbox: getAttentionInboxMock,
  getAttentionResolutions: getAttentionResolutionsMock,
  startAttentionResolutionAction: startAttentionResolutionActionMock,
  snoozeAttentionInboxItem: snoozeAttentionInboxItemMock,
  dismissAttentionInboxItem: dismissAttentionInboxItemMock,
  restoreAttentionInboxItem: restoreAttentionInboxItemMock,
  undoMutationReceipt: undoMutationReceiptMock
}));

const mutationReceipt = {
  id: "mrc_attention",
  operation: "attention_state" as const,
  targetType: "attention_item",
  targetId: "attn:insight:ins_1",
  targetLabel: "Review the recent pattern",
  ownerUserId: "user_operator",
  summary: "Dismissed Review the recent pattern.",
  status: "available" as const,
  reversible: true,
  explanation: "Undo is available until the time shown.",
  expiresAt: "2099-07-09T10:10:00.000Z",
  createdAt: "2099-07-09T10:00:00.000Z",
  undoneAt: null
};

const items: AttentionInboxItem[] = [
  {
    id: "attn:approval:apr_1",
    source: "approval",
    kind: "decision",
    severity: "blocking",
    state: "active",
    title: "Approve the planned update",
    reason: "A trusted agent is waiting for a human decision.",
    detail: "Review the material task change before execution.",
    target: {
      entityType: "task",
      entityId: "task_1",
      label: "Approve the planned update",
      href: "/settings/agents"
    },
    allowedActions: ["open", "approve", "reject", "snooze"],
    primaryAction: {
      key: "review_decision",
      label: "Review decision",
      href: "/settings/agents",
      sourceRef: "approval_request:apr_1",
      resolutionCondition: "Resolved after a decision is recorded."
    },
    createdAt: "2026-07-09T08:00:00.000Z",
    updatedAt: "2026-07-09T09:00:00.000Z",
    sourceUpdatedAt: "2026-07-09T09:00:00.000Z",
    dueAt: null,
    snoozedUntil: null,
    metadata: {}
  },
  {
    id: "attn:task:task_1",
    source: "task",
    kind: "blocked_work",
    severity: "important",
    state: "active",
    title: "Resolve the blocked release",
    reason: "This work is blocked and its due date has passed.",
    detail: "Blocked by deployment credentials.",
    target: {
      entityType: "task",
      entityId: "task_1",
      label: "Resolve the blocked release",
      href: "/tasks/task_1"
    },
    allowedActions: ["open", "snooze"],
    primaryAction: {
      key: "resolve_blocker",
      label: "Resolve blocker",
      href: "/tasks/task_1",
      sourceRef: "task:task_1",
      resolutionCondition: "Resolved when the task is no longer blocked."
    },
    createdAt: "2026-07-08T08:00:00.000Z",
    updatedAt: "2026-07-09T08:00:00.000Z",
    sourceUpdatedAt: "2026-07-09T08:00:00.000Z",
    dueAt: "2026-07-08",
    snoozedUntil: null,
    metadata: {}
  },
  {
    id: "attn:insight:ins_1",
    source: "insight",
    kind: "review",
    severity: "notice",
    state: "active",
    title: "Review the recent pattern",
    reason: "This insight has not been reviewed yet.",
    detail: "The evidence points to one repeated interruption.",
    target: {
      entityType: "insight",
      entityId: "ins_1",
      label: "Review the recent pattern",
      href: "/insights"
    },
    allowedActions: ["open", "snooze", "dismiss"],
    primaryAction: {
      key: "review_insight",
      label: "Review insight",
      href: "/insights",
      sourceRef: "insight:ins_1",
      resolutionCondition: "Resolved after the insight is accepted or applied."
    },
    createdAt: "2026-07-09T07:00:00.000Z",
    updatedAt: "2026-07-09T07:00:00.000Z",
    sourceUpdatedAt: "2026-07-09T07:00:00.000Z",
    dueAt: null,
    snoozedUntil: null,
    metadata: {}
  }
];

function payload(
  state: AttentionInboxState,
  stateItems: AttentionInboxItem[] = state === "active" ? items : []
): AttentionInboxPayload {
  return {
    generatedAt: "2026-07-09T10:00:00.000Z",
    state,
    total: stateItems.length,
    offset: 0,
    limit: 25,
    hasMore: false,
    summary: {
      activeCount: 3,
      snoozedCount: state === "snoozed" ? stateItems.length : 1,
      dismissedCount: state === "dismissed" ? stateItems.length : 0,
      blockingCount: 1,
      importantCount: 1,
      sourceCounts: {
        approval: 1,
        insight: 1,
        task: 1,
        companion_sync: 0,
        agent_session: 0
      }
    },
    items: stateItems
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-probe">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderPage(initialEntry = "/attention") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AttentionInboxPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  createAttentionResolutionIdempotencyKeyMock.mockReset();
  createAttentionResolutionIdempotencyKeyMock.mockReturnValue(
    "attention_start_test"
  );
  getAttentionInboxMock.mockImplementation(
    ({ state = "active" }: { state?: AttentionInboxState }) =>
      Promise.resolve(payload(state))
  );
  snoozeAttentionInboxItemMock.mockResolvedValue({
    attentionState: {},
    mutationReceipt
  });
  dismissAttentionInboxItemMock.mockResolvedValue({
    attentionState: {},
    mutationReceipt
  });
  restoreAttentionInboxItemMock.mockResolvedValue({
    attentionState: {},
    mutationReceipt
  });
  getAttentionResolutionsMock.mockResolvedValue({
    receipts: [],
    total: 0,
    limit: 5,
    retention: { days: 365, maxPerActor: 1000 }
  });
  checkAttentionResolutionsMock.mockResolvedValue({
    results: [],
    receipts: []
  });
  startAttentionResolutionActionMock.mockImplementation(
    async (itemId: string) => {
      const item = items.find((entry) => entry.id === itemId)!;
      return {
        attempt: {
          id: `atra_${itemId}`,
          itemId,
          source: item.source,
          kind: item.kind,
          actionKey: item.primaryAction.key,
          sourceRef: item.primaryAction.sourceRef,
          sourceUpdatedAt: item.sourceUpdatedAt,
          title: item.title,
          targetLabel: item.target.label,
          targetHref: item.primaryAction.href,
          status: "pending",
          startedAt: "2026-07-09T10:00:00.000Z",
          checkedAt: null
        },
        primaryAction: item.primaryAction,
        replayed: false
      };
    }
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttentionInboxPage", () => {
  it("shows evidence, review context, and only truthful row actions", async () => {
    renderPage();

    expect(
      await screen.findByText("Approve the planned update")
    ).toBeInTheDocument();
    expect(
      screen.getByText("A trusted agent is waiting for a human decision.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review decision" })
    ).toBeInTheDocument();

    const blockedRow = screen.getByTestId("attention-item-attn:task:task_1");
    expect(within(blockedRow).getByText("Due Jul 8")).toBeInTheDocument();
    expect(
      within(blockedRow).queryByRole("button", { name: "Hide" })
    ).toBeNull();
    expect(
      within(blockedRow).getByRole("button", { name: "Snooze" })
    ).toBeInTheDocument();
  });

  it("starts the exact typed action before navigating and preserves return state", async () => {
    renderPage("/attention?state=active&offset=25");
    const action = await screen.findByRole("button", {
      name: "Review decision"
    });
    fireEvent.click(action);

    await waitFor(() => {
      expect(startAttentionResolutionActionMock).toHaveBeenCalledWith(
        "attn:approval:apr_1",
        {
          actionKey: "review_decision",
          sourceUpdatedAt: "2026-07-09T09:00:00.000Z",
          userIds: ["user_operator"],
          idempotencyKey: "attention_start_test"
        }
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("location-probe").textContent).toContain(
        "/settings/agents?"
      );
    });
    const target = new URL(
      screen.getByTestId("location-probe").textContent ?? "",
      "http://forge.local"
    );
    expect(target.searchParams.get("attentionSource")).toBe(
      "approval_request:apr_1"
    );
    expect(target.searchParams.get("attentionReturn")).toContain(
      "/attention?state=active"
    );
    const returnTarget = new URL(
      target.searchParams.get("attentionReturn") ?? "",
      "http://forge.local"
    );
    expect(returnTarget.searchParams.get("focus")).toBe("attn:approval:apr_1");
    expect(returnTarget.searchParams.get("attempt")).toBe(
      "atra_attn:approval:apr_1"
    );
  });

  it("reuses one start key after an uncertain response failure", async () => {
    createAttentionResolutionIdempotencyKeyMock.mockReset();
    createAttentionResolutionIdempotencyKeyMock
      .mockReturnValueOnce("attention_start_uncertain")
      .mockReturnValue("attention_start_wrong_retry");
    startAttentionResolutionActionMock.mockRejectedValueOnce(
      new TypeError("The response was lost.")
    );

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Review decision" })
    );
    expect(
      await screen.findByText("The response was lost.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review decision" }));

    await waitFor(() => {
      expect(startAttentionResolutionActionMock).toHaveBeenCalledTimes(2);
    });
    expect(
      startAttentionResolutionActionMock.mock.calls.map(
        (call) => call[1]?.idempotencyKey
      )
    ).toEqual(["attention_start_uncertain", "attention_start_uncertain"]);
    expect(createAttentionResolutionIdempotencyKeyMock).toHaveBeenCalledTimes(
      1
    );
  });

  it("rejects an unsafe server action link without replacing the current Attention URL", async () => {
    const item = items[0]!;
    startAttentionResolutionActionMock.mockResolvedValueOnce({
      attempt: {
        id: "atra_unsafe",
        itemId: item.id,
        source: item.source,
        kind: item.kind,
        actionKey: item.primaryAction.key,
        sourceRef: item.primaryAction.sourceRef,
        sourceUpdatedAt: item.sourceUpdatedAt,
        title: item.title,
        targetLabel: item.target.label,
        targetHref: item.primaryAction.href,
        status: "pending",
        startedAt: "2026-07-09T10:00:00.000Z",
        checkedAt: null
      },
      primaryAction: {
        ...item.primaryAction,
        href: "https://example.com/steal-attention-state"
      },
      replayed: false
    });

    renderPage("/attention?state=active&offset=25");
    fireEvent.click(
      await screen.findByRole("button", { name: "Review decision" })
    );

    expect(
      await screen.findByText("Forge refused an unsafe Attention action link.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/attention?state=active&offset=25"
    );
  });

  it("announces a resolution only after the server returns source evidence", async () => {
    const receipt = {
      id: "atrr_1",
      attemptId: "atra_1",
      itemId: "attn:task:task_1",
      source: "task" as const,
      kind: "blocked_work" as const,
      actionKey: "resolve_blocker" as const,
      sourceRef: "task:task_1",
      sourceUpdatedAt: "2026-07-09T08:00:00.000Z",
      title: "Resolve the blocked release",
      targetLabel: "Resolve the blocked release",
      targetHref: "/tasks/task_1",
      evidenceCode: "task_unblocked",
      evidenceSummary: "The task is no longer blocked.",
      activityEventId: "act_1",
      resolvedAt: "2026-07-09T10:05:00.000Z"
    };
    checkAttentionResolutionsMock.mockResolvedValue({
      results: [
        {
          attemptId: "atra_1",
          itemId: receipt.itemId,
          status: "resolved",
          explanation: receipt.evidenceSummary,
          receipt
        }
      ],
      receipts: [receipt]
    });

    renderPage(
      "/attention?state=active&focus=attn%3Atask%3Atask_1&attempt=atra_1"
    );

    expect(
      await screen.findByText(
        "Resolved with source evidence: The task is no longer blocked."
      )
    ).toBeInTheDocument();
  });

  it("reports a source that remains open without claiming resolution", async () => {
    checkAttentionResolutionsMock.mockResolvedValue({
      results: [
        {
          attemptId: "atra_1",
          itemId: "attn:task:task_1",
          status: "still_open",
          explanation: "The task is still blocked.",
          receipt: null
        }
      ],
      receipts: []
    });

    renderPage(
      "/attention?state=active&focus=attn%3Atask%3Atask_1&attempt=atra_1"
    );

    expect(
      await screen.findByText(
        "Forge checked the source. It still needs attention."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Resolved with source evidence:/)).toBeNull();
  });

  it("reports only the returned attempt when another pending action has the opposite outcome", async () => {
    const olderReceipt = {
      id: "atrr_older",
      attemptId: "atra_older",
      itemId: "attn:insight:ins_1",
      source: "insight" as const,
      kind: "review" as const,
      actionKey: "review_insight" as const,
      sourceRef: "insight:ins_1",
      sourceUpdatedAt: "2026-07-09T07:00:00.000Z",
      title: "Review the recent pattern",
      targetLabel: "Review the recent pattern",
      targetHref: "/insights",
      evidenceCode: "insight_accepted",
      evidenceSummary: "The older insight was accepted.",
      activityEventId: "act_older",
      resolvedAt: "2026-07-09T10:05:00.000Z"
    };
    checkAttentionResolutionsMock.mockResolvedValue({
      results: [
        {
          attemptId: "atra_older",
          itemId: olderReceipt.itemId,
          status: "resolved",
          explanation: olderReceipt.evidenceSummary,
          receipt: olderReceipt
        },
        {
          attemptId: "atra_returned",
          itemId: "attn:task:task_1",
          status: "still_open",
          explanation: "The returned task remains blocked.",
          receipt: null
        }
      ],
      receipts: [olderReceipt]
    });

    renderPage(
      "/attention?state=active&focus=attn%3Atask%3Atask_1&attempt=atra_returned"
    );

    expect(
      await screen.findByText(
        "Forge checked the source. It still needs attention."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Resolved with source evidence: The older insight was accepted."
      )
    ).toBeNull();
  });

  it("shows bounded durable resolution history with an exact source link", async () => {
    getAttentionResolutionsMock.mockResolvedValue({
      receipts: [
        {
          id: "atrr_1",
          attemptId: "atra_1",
          itemId: "attn:insight:ins_1",
          source: "insight",
          kind: "review",
          actionKey: "review_insight",
          sourceRef: "insight:ins_1",
          sourceUpdatedAt: "2026-07-09T07:00:00.000Z",
          title: "Review the recent pattern",
          targetLabel: "Review the recent pattern",
          targetHref: "/insights",
          evidenceCode: "insight_accepted",
          evidenceSummary: "The insight was accepted.",
          activityEventId: "act_2",
          resolvedAt: "2026-07-09T10:05:00.000Z"
        }
      ],
      total: 1,
      limit: 5,
      retention: { days: 365, maxPerActor: 1000 }
    });

    renderPage();

    expect(
      await screen.findByRole("region", { name: "Verified resolutions" })
    ).toBeInTheDocument();
    expect(screen.getByText("The insight was accepted.")).toBeInTheDocument();
    const sourceHref = new URL(
      screen.getByRole("link", { name: "Open source" }).getAttribute("href") ??
        "",
      "http://forge.local"
    );
    expect(sourceHref.pathname).toBe("/insights");
    expect(sourceHref.searchParams.get("attentionSource")).toBe(
      "insight:ins_1"
    );
    expect(sourceHref.searchParams.get("attentionReturn")).toBe("/attention");
    expect(
      screen.getByText(/newest 1000 receipts for 365 days/i)
    ).toBeVisible();
  });

  it("snoozes from the bounded option menu", async () => {
    renderPage();
    const insightRow = await screen.findByTestId(
      "attention-item-attn:insight:ins_1"
    );
    fireEvent.click(within(insightRow).getByRole("button", { name: "Snooze" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Tomorrow/ }));

    await waitFor(() => {
      expect(snoozeAttentionInboxItemMock).toHaveBeenCalledTimes(1);
    });
    const [itemId, input] = snoozeAttentionInboxItemMock.mock.calls[0] as [
      string,
      { until: string }
    ];
    expect(itemId).toBe("attn:insight:ins_1");
    expect(Date.parse(input.until)).toBeGreaterThan(
      Date.now() + 23 * 60 * 60 * 1000
    );
    await waitFor(() => {
      const currentInsightRow = screen.getByTestId(
        "attention-item-attn:insight:ins_1"
      );
      expect(
        within(currentInsightRow).getByRole("button", { name: "Snooze" })
      ).toBeEnabled();
    });
  });

  it("dismisses an eligible insight", async () => {
    renderPage();
    const insightRow = await screen.findByTestId(
      "attention-item-attn:insight:ins_1"
    );
    fireEvent.click(within(insightRow).getByRole("button", { name: "Hide" }));
    await waitFor(() => {
      expect(dismissAttentionInboxItemMock).toHaveBeenCalledWith(
        "attn:insight:ins_1"
      );
    });
    expect(
      screen.getByRole("button", {
        name: "Undo: Dismissed Review the recent pattern."
      })
    ).toBeVisible();
  });

  it("loads state tabs and restores a snoozed record", async () => {
    const snoozedItem: AttentionInboxItem = {
      ...items[2],
      state: "snoozed",
      allowedActions: ["open", "restore"],
      snoozedUntil: "2026-07-10T10:00:00.000Z"
    };
    getAttentionInboxMock.mockImplementation(
      ({ state = "active" }: { state?: AttentionInboxState }) =>
        Promise.resolve(
          state === "snoozed"
            ? payload("snoozed", [snoozedItem])
            : payload(state)
        )
    );
    renderPage();
    await screen.findByText("Approve the planned update");

    fireEvent.click(screen.getByRole("tab", { name: /Snoozed/ }));
    const restore = await screen.findByRole("button", { name: "Restore" });
    expect(getAttentionInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: "snoozed", offset: 0 })
    );
    fireEvent.click(restore);
    await waitFor(() => {
      expect(restoreAttentionInboxItemMock).toHaveBeenCalledWith(
        "attn:insight:ins_1"
      );
    });
  });

  it("moves through server pages without rendering an unbounded list", async () => {
    getAttentionInboxMock.mockImplementation(
      ({ offset = 0 }: { offset?: number }) =>
        Promise.resolve({
          ...payload("active"),
          total: 60,
          offset,
          hasMore: offset < 50
        })
    );
    renderPage();
    await screen.findByText("Approve the planned update");
    fireEvent.click(
      screen.getByRole("button", { name: "Next attention page" })
    );
    await waitFor(() => {
      expect(getAttentionInboxMock).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 25, limit: 25 })
      );
    });
  });
});
