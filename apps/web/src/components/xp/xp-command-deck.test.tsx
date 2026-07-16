import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getXpDeckEntranceMotion,
  XpCommandDeck
} from "@/components/xp/xp-command-deck";
import type { XpMetricsPayload } from "@/lib/types";

const metrics = {
  scope: { label: "Albert" },
  profile: {
    totalXp: 240,
    level: 2,
    currentLevelXp: 140,
    nextLevelXp: 175,
    xpToNextLevel: 35,
    weeklyXp: 42,
    streakDays: 3
  },
  achievements: [],
  milestoneRewards: [],
  momentumPulse: {
    status: "steady",
    headline: "Progress is current.",
    detail: "The ledger contains recent activity.",
    celebrationLabel: "No pending celebration",
    nextMilestoneId: "next-level",
    nextMilestoneLabel: "Level 3"
  },
  recentLedger: [
    {
      id: "reward_1",
      deltaXp: 8,
      reasonTitle: "Task started",
      reasonSummary: "A focused run began.",
      source: "ui",
      actor: "albert",
      metadata: { manual: false },
      createdAt: "2026-07-15T08:00:00.000Z"
    }
  ]
} as unknown as XpMetricsPayload;

describe("XpCommandDeck", () => {
  afterEach(() => cleanup());

  it("explains level and streak state without claiming an XP multiplier", () => {
    const view = render(
      <XpCommandDeck
        profile={metrics.profile}
        achievements={metrics.achievements}
        milestoneRewards={metrics.milestoneRewards}
        momentumPulse={metrics.momentumPulse}
        recentLedger={metrics.recentLedger}
        scopeLabel={metrics.scope.label}
      />
    );

    expect(view.getByText("Albert progression")).toBeVisible();
    expect(view.getByText("140/175 XP in level 2")).toBeInTheDocument();
    expect(view.getByText("35 XP to level 3")).toBeInTheDocument();
    expect(
      view.getByText(/manual adjustments, corrections/i)
    ).toBeInTheDocument();
    expect(view.getByText(/ui · albert · automatic rule/i)).toBeInTheDocument();
    expect(view.queryByText(/combo/i)).not.toBeInTheDocument();
  });

  it("uses zero-duration entrance motion when reduced motion is active", () => {
    expect(getXpDeckEntranceMotion(true)).toEqual({
      initial: false,
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0 }
    });
    expect(getXpDeckEntranceMotion(false).transition.duration).toBeGreaterThan(
      0
    );
  });
});
