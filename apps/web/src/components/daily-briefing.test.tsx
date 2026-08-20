import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DailyBriefingPanel } from "@/components/daily-briefing";
import type { DailyBriefing } from "@/lib/types";

const { getDailyBriefingMock } = vi.hoisted(() => ({
  getDailyBriefingMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getDailyBriefing: getDailyBriefingMock
}));

const provenance = {
  generatedAt: "2026-08-11T08:00:00.000Z",
  observedAt: "2026-08-11T07:58:00.000Z",
  freshness: "fresh" as const,
  completeness: "complete" as const,
  staleAfterSeconds: 600,
  sourceSummary: "Authorized current work",
  statusDetail:
    "Complete evidence. The latest observation is within the freshness window.",
  confidence: {
    level: "high" as const,
    reason: "The statement repeats a stored record."
  },
  sources: [
    {
      id: "task:task-1",
      label: "Authorized current work",
      kind: "record" as const,
      observedAt: "2026-08-11T07:58:00.000Z",
      detailRoute: "/tasks/task-1"
    }
  ],
  evidence: [
    {
      label: "Prepare the daily review",
      reference: "task:task-1",
      observedAt: "2026-08-11T07:58:00.000Z"
    }
  ]
};

const briefing: DailyBriefing = {
  contractVersion: 1,
  generatedAt: "2026-08-11T08:00:00.000Z",
  dateKey: "2026-08-11",
  timeZone: "Europe/Zurich",
  ownerUserId: "user-1",
  status: "partial",
  headline: "Next useful work: Prepare the daily review.",
  sections: [
    {
      key: "work",
      label: "Current work",
      status: "ready",
      statements: [
        {
          id: "work-current",
          text: "Next useful work: Prepare the daily review.",
          href: "/tasks/task-1",
          observedAt: provenance.observedAt,
          freshness: "fresh",
          provenance
        }
      ],
      omissionReason: null,
      inspectedCount: 1,
      availableCount: 1
    },
    {
      key: "schedule",
      label: "Schedule",
      status: "empty",
      statements: [],
      omissionReason:
        "No authorized calendar commitment overlaps this local day.",
      inspectedCount: 0,
      availableCount: 0
    },
    {
      key: "capacity",
      label: "Health and capacity",
      status: "stale",
      statements: [],
      omissionReason:
        "The persisted Life Force snapshot is older than 30 minutes and was not used.",
      inspectedCount: 1,
      availableCount: 0
    },
    {
      key: "recent_activity",
      label: "Recent activity",
      status: "empty",
      statements: [],
      omissionReason:
        "No authorized activity was recorded in the last 36 hours.",
      inspectedCount: 0,
      availableCount: 0
    }
  ]
};

function renderPanel(ownerUserId: string | null = "user-1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DailyBriefingPanel ownerUserId={ownerUserId} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function percentile(samples: number[], fraction: number) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)]!;
}

describe("DailyBriefingPanel", () => {
  beforeEach(() => {
    getDailyBriefingMock.mockResolvedValue({ briefing });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires one owner before reading any source", () => {
    renderPanel(null);
    expect(
      screen.getByRole("heading", {
        name: "Select one person for a daily briefing"
      })
    ).toBeInTheDocument();
    expect(getDailyBriefingMock).not.toHaveBeenCalled();
  });

  it("shows the factual headline, all source lanes, and exact omission reasons", async () => {
    renderPanel();
    expect(
      await screen.findByRole("heading", {
        name: "Next useful work: Prepare the daily review."
      })
    ).toBeInTheDocument();
    for (const label of [
      "Current work",
      "Schedule",
      "Health and capacity",
      "Recent activity"
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        "No authorized calendar commitment overlaps this local day."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/older than 30 minutes and was not used/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /Next useful work: Prepare the daily review/i
      })
    ).toHaveAttribute("href", "/tasks/task-1");
  });

  it("discloses source, freshness, and exact reference through a keyboard-native control", async () => {
    renderPanel();
    const disclosure = await screen.findByText("Source and freshness");
    fireEvent.click(disclosure);
    expect(screen.getByText(/fresh ·/i)).toBeVisible();
    expect(screen.getByText("Authorized current work")).toBeVisible();
    expect(screen.getByText("task:task-1")).toBeVisible();
  });

  it("keeps local disclosure interaction p95 below 100 milliseconds", async () => {
    renderPanel();
    const disclosure = await screen.findByText("Source and freshness");
    const samples: number[] = [];
    for (let index = 0; index < 33; index += 1) {
      const startedAt = performance.now();
      fireEvent.click(disclosure);
      if (index >= 3) samples.push(performance.now() - startedAt);
    }
    expect(percentile(samples, 0.95)).toBeLessThanOrEqual(100);
  });

  it("reports a failed read truthfully and retries only on request", async () => {
    getDailyBriefingMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ briefing });
    renderPanel();
    expect(
      await screen.findByRole("heading", {
        name: /Daily briefing is unavailable/i
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/No data was changed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getDailyBriefingMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", {
        name: "Next useful work: Prepare the daily review."
      })
    ).toBeInTheDocument();
  });

  it("fails safely when a partial runtime response omits the briefing", async () => {
    getDailyBriefingMock.mockResolvedValue({});
    renderPanel();

    expect(
      await screen.findByRole("heading", {
        name: /Daily briefing is unavailable/i
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/No data was changed/i)).toBeInTheDocument();
  });
});
