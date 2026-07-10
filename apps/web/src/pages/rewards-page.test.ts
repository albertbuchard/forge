import { describe, expect, it } from "vitest";
import {
  DEFAULT_REWARD_GROUP_PREVIEW_COUNT,
  rewardGroupPreviewCountForWidth,
  selectFeaturedTrophies,
  selectRewardGroupItems
} from "@/pages/rewards-page";

describe("reward group previews", () => {
  const items = Array.from({ length: 12 }, (_, index) => `reward-${index + 1}`);

  it("bounds the unfiltered default to one desktop row", () => {
    expect(selectRewardGroupItems(items, false, false)).toEqual(
      items.slice(0, DEFAULT_REWARD_GROUP_PREVIEW_COUNT)
    );
  });

  it("reveals every item after expansion or while filtering", () => {
    expect(selectRewardGroupItems(items, true, false)).toEqual(items);
    expect(selectRewardGroupItems(items, false, true)).toEqual(items);
  });

  it("keeps one preview row at each responsive grid width", () => {
    expect(rewardGroupPreviewCountForWidth(390)).toBe(1);
    expect(rewardGroupPreviewCountForWidth(768)).toBe(2);
    expect(rewardGroupPreviewCountForWidth(1280)).toBe(4);
    expect(selectRewardGroupItems(items, false, false, 1)).toEqual([
      "reward-1"
    ]);
  });

  it("puts earned trophies first and keeps the shelf populated for new profiles", () => {
    const catalog = [
      { id: "trophy-old", kind: "trophy", unlocked: true },
      { id: "unlock-new", kind: "unlock", unlocked: true },
      { id: "trophy-locked", kind: "trophy", unlocked: false }
    ];
    const recent = [
      { id: "trophy-new", kind: "trophy", unlocked: true },
      { id: "trophy-old", kind: "trophy", unlocked: true }
    ];

    expect(selectFeaturedTrophies(catalog, recent)).toEqual([
      recent[0],
      recent[1],
      catalog[2]
    ]);

    expect(
      selectFeaturedTrophies([
        { id: "trophy-next", kind: "trophy", unlocked: false },
        { id: "unlock-next", kind: "unlock", unlocked: false }
      ], [])
    ).toEqual([
      { id: "trophy-next", kind: "trophy", unlocked: false }
    ]);
  });
});
