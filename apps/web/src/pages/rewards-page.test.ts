import { describe, expect, it } from "vitest";
import {
  DEFAULT_REWARD_GROUP_PREVIEW_COUNT,
  rewardGroupPreviewCountForWidth,
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
});
