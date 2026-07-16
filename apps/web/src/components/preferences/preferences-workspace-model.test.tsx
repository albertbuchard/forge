import { describe, expect, it } from "vitest";

import type { PreferenceWorkspacePayload } from "@/lib/types";
import {
  getPreferenceContextScope,
  getPreferenceEffectiveSignal,
  getPreferenceSignalConflicts,
  isPreferenceHistoryPartial,
  SIGNAL_MODEL_EFFECTS,
  SIGNAL_OPTIONS
} from "./preferences-workspace-model";

const favoriteSignal = {
  id: "signal_1",
  profileId: "profile_1",
  contextId: "context_1",
  userId: "user_1",
  ownerUserId: "user_1",
  itemId: "item_1",
  signalType: "favorite" as const,
  strength: 1,
  modelWeight: 1.25,
  source: "ui",
  actor: "Operator",
  createdAt: "2026-01-02T00:00:00.000Z"
};

const workspace = {
  selectedContext: {
    id: "context_1",
    profileId: "profile_1",
    name: "Deep work",
    description: "",
    shareMode: "blended",
    active: true,
    isDefault: true,
    decayDays: 75,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  history: {
    judgments: [
      {
        id: "judgment_1",
        profileId: "profile_1",
        contextId: "context_1",
        userId: "user_1",
        leftItemId: "item_1",
        rightItemId: "item_2",
        outcome: "left",
        strength: 1,
        responseTimeMs: null,
        source: "ui",
        reasonTags: [],
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    signals: [favoriteSignal],
    snapshots: [],
    staleItemIds: [],
    flippedItemIds: []
  },
  scores: [
    {
      itemId: "item_1",
      pairwiseWins: 7,
      pairwiseLosses: 3,
      effectiveSignal: favoriteSignal
    }
  ],
  presentation: { historyLimit: 50 },
  evidenceCoverage: {
    contexts: [
      {
        contextId: "context_1",
        totalJudgments: 1,
        consideredJudgments: 1,
        truncated: false
      }
    ]
  }
} as unknown as PreferenceWorkspacePayload;

describe("preferences workspace signal model", () => {
  it("keeps UI weights aligned with the server model and explains removal", () => {
    expect(
      Object.fromEntries(
        SIGNAL_OPTIONS.map((option) => [option.signalType, option.modelWeight])
      )
    ).toEqual({
      favorite: 1.25,
      must_have: 1.5,
      bookmark: 0.35,
      compare_later: 0.2,
      neutral: 0,
      veto: -1.6
    });
    expect(SIGNAL_MODEL_EFFECTS.neutral).toMatch(
      /clears the current direct effect.*remaining evidence/i
    );
    expect(getPreferenceContextScope(workspace.selectedContext)).toMatch(
      /other active contexts contribute at 45%.*75 days/i
    );
  });

  it("uses authoritative score aggregates for direct-versus-judgment conflicts", () => {
    expect(getPreferenceSignalConflicts(workspace, "item_1", "veto")).toEqual([
      "7 prior comparison wins conflict with this veto.",
      "This replaces the current favorite signal; the earlier record remains in history but stops affecting the model."
    ]);
  });

  it("surfaces replacement conflicts from bounded signal history", () => {
    const vetoSignal = {
      ...favoriteSignal,
      id: "signal_2",
      signalType: "veto" as const,
      modelWeight: -1.6,
      createdAt: "2026-01-03T00:00:00.000Z"
    };
    expect(
      getPreferenceSignalConflicts(
        {
          ...workspace,
          scores: [
            {
              ...workspace.scores[0]!,
              effectiveSignal: vetoSignal
            }
          ],
          history: {
            ...workspace.history,
            signals: [vetoSignal, ...workspace.history.signals]
          }
        } as PreferenceWorkspacePayload,
        "item_1"
      )
    ).toContain(
      "The current veto signal replaced the prior favorite signal; the earlier record remains in history but no longer affects the model."
    );
  });

  it("keeps an authoritative effective signal outside truncated history", () => {
    const effectiveSignal = {
      ...favoriteSignal,
      id: "signal_outside_history",
      signalType: "must_have" as const,
      modelWeight: 1.5,
      createdAt: "2025-12-01T00:00:00.000Z"
    };
    const truncatedWorkspace = {
      ...workspace,
      scores: [
        {
          ...workspace.scores[0]!,
          pairwiseLosses: 9,
          effectiveSignal
        }
      ],
      presentation: { ...workspace.presentation, historyLimit: 1 }
    } as PreferenceWorkspacePayload;

    expect(getPreferenceEffectiveSignal(truncatedWorkspace, "item_1")?.id).toBe(
      "signal_outside_history"
    );
    expect(isPreferenceHistoryPartial(truncatedWorkspace)).toBe(true);
    expect(
      getPreferenceSignalConflicts(truncatedWorkspace, "item_1")
    ).toContain(
      "9 prior comparison losses conflict with this positive signal."
    );
  });
});
