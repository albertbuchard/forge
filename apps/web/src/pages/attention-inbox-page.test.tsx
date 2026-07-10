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
import { MemoryRouter } from "react-router-dom";
import { AttentionInboxPage } from "@/pages/attention-inbox-page";
import type {
  AttentionInboxItem,
  AttentionInboxPayload,
  AttentionInboxState
} from "@/lib/types";

const {
  getAttentionInboxMock,
  snoozeAttentionInboxItemMock,
  dismissAttentionInboxItemMock,
  restoreAttentionInboxItemMock
} = vi.hoisted(() => ({
  getAttentionInboxMock: vi.fn(),
  snoozeAttentionInboxItemMock: vi.fn(),
  dismissAttentionInboxItemMock: vi.fn(),
  restoreAttentionInboxItemMock: vi.fn()
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
  getAttentionInbox: getAttentionInboxMock,
  snoozeAttentionInboxItem: snoozeAttentionInboxItemMock,
  dismissAttentionInboxItem: dismissAttentionInboxItemMock,
  restoreAttentionInboxItem: restoreAttentionInboxItemMock
}));

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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AttentionInboxPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  getAttentionInboxMock.mockImplementation(
    ({ state = "active" }: { state?: AttentionInboxState }) =>
      Promise.resolve(payload(state))
  );
  snoozeAttentionInboxItemMock.mockResolvedValue({ attentionState: {} });
  dismissAttentionInboxItemMock.mockResolvedValue({ attentionState: {} });
  restoreAttentionInboxItemMock.mockResolvedValue({ attentionState: {} });
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
      screen.getByRole("link", { name: "Review request" })
    ).toHaveAttribute("href", "/settings/agents");

    const blockedRow = screen.getByTestId("attention-item-attn:task:task_1");
    expect(within(blockedRow).getByText("Due Jul 8")).toBeInTheDocument();
    expect(
      within(blockedRow).queryByRole("button", { name: "Dismiss" })
    ).toBeNull();
    expect(
      within(blockedRow).getByRole("button", { name: "Snooze" })
    ).toBeInTheDocument();
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
    fireEvent.click(
      within(insightRow).getByRole("button", { name: "Dismiss" })
    );
    await waitFor(() => {
      expect(dismissAttentionInboxItemMock).toHaveBeenCalledWith(
        "attn:insight:ins_1"
      );
    });
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
