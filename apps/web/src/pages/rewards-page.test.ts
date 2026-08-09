import { describe, expect, it } from "vitest";
import {
  DEFAULT_REWARD_GROUP_PREVIEW_COUNT,
  offlineGamificationImageUrl,
  recoverMissingGamificationImage,
  revealLoadedGamificationImage,
  rewardGroupPreviewCountForWidth,
  selectFeaturedTrophies,
  selectRewardGroupItems
} from "@/pages/rewards-page";
import {
  gamificationThemeOptions,
  getGamificationSpriteUrl
} from "@/lib/gamification-assets";
import type { SyntheticEvent } from "react";

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
      selectFeaturedTrophies(
        [
          { id: "trophy-next", kind: "trophy", unlocked: false },
          { id: "unlock-next", kind: "unlock", unlocked: false }
        ],
        []
      )
    ).toEqual([{ id: "trophy-next", kind: "trophy", unlocked: false }]);
  });
});

describe("reward artwork recovery", () => {
  const assetKeys = [
    "item-trophy-xp-levels-the-first-heat",
    "item-unlock-streaks-molten-crown-fire"
  ];

  for (const { value: theme } of gamificationThemeOptions) {
    for (const assetKey of assetKeys) {
      it(`keeps ${theme} ${assetKey} visible after sprite and preview failures`, () => {
        const image = document.createElement("img");
        image.alt = "Reward artwork";
        image.src = getGamificationSpriteUrl(assetKey, 512, theme);
        const event = {
          currentTarget: image
        } as SyntheticEvent<HTMLImageElement>;

        recoverMissingGamificationImage(event, theme, assetKey);
        expect(image.getAttribute("src")).toContain(
          `/gamification-previews/${theme}-`
        );
        expect(image.dataset.gamificationImageSource).toBe("preview");
        expect(image.hidden).toBe(false);

        recoverMissingGamificationImage(event, theme, assetKey);
        expect(image.getAttribute("src")).toBe(offlineGamificationImageUrl);
        expect(image.dataset.gamificationImageSource).toBe("offline");
        expect(image.hidden).toBe(false);
        expect(image.alt).toBe("Reward artwork");

        revealLoadedGamificationImage(event);
        expect(image.dataset.gamificationImageSource).toBe("offline");
        expect(image.hidden).toBe(false);
      });
    }
  }
});
