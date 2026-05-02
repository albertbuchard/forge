import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateLevel,
  xpToAdvance
} from "./services/gamification.js";

describe("gamification level curve", () => {
  it("starts level 1 at zero and advances with the smith-forge curve", () => {
    assert.equal(xpToAdvance(1), 100);
    assert.deepEqual(calculateLevel(0), {
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      currentLevelStartXp: 0,
      nextLevelTotalXp: 100,
      levelCurveVersion: "smith-forge"
    });
    assert.equal(calculateLevel(100).level, 2);
    assert.equal(calculateLevel(100).currentLevelStartXp, 100);
    assert.equal(calculateLevel(100).nextLevelXp, 135);
  });
});
