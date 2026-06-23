import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { GAMIFICATION_CATALOG } from "@/lib/gamification-catalog.js";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "./db.js";
import { getSettings, getSettingsFileStatus } from "./repositories/settings.js";
import { listUsers } from "./repositories/users.js";
import {
  calculateLevel,
  buildXpMetricsPayloadModel,
  resolveGamificationScope,
  xpToAdvance
} from "./services/gamification.js";
import { buildForgeDoctorReport } from "./services/doctor.js";

let activeDataRoot: string | null = null;

async function setupDatabase(prefix: string) {
  activeDataRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  configureDatabase({ dataRoot: activeDataRoot, seedDemoData: true });
  await initializeDatabase();
  getSettings();
  return activeDataRoot;
}

async function cleanupDatabase() {
  closeDatabase();
  if (activeDataRoot) {
    await rm(activeDataRoot, { recursive: true, force: true });
    activeDataRoot = null;
  }
}

afterEach(async () => {
  await cleanupDatabase();
});

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

describe("gamification scope and persistence", () => {
  it("keeps multi-user XP reads aggregate and non-persistent", async () => {
    await setupDatabase("forge-gamification-scope-");
    const users = listUsers();
    assert.ok(users.length >= 2);
    const userIds = users.slice(0, 2).map((user) => user.id);

    const scope = resolveGamificationScope(userIds);
    assert.equal(scope.mode, "aggregate_fallback");
    assert.deepEqual(new Set(scope.userIds), new Set(userIds));

    const before = {
      rewardRows: countRows("reward_ledger"),
      dailyRows: countRows("gamification_daily_activity"),
      unlockRows: countRows("gamification_item_unlocks"),
      celebrationRows: countRows("gamification_celebrations")
    };

    const payload = buildXpMetricsPayloadModel({
      goals: [],
      tasks: [],
      habits: [],
      userIds
    });

    assert.equal(payload.scope.mode, "aggregate_fallback");
    assert.equal(payload.equipment.updatedAt, null);
    assert.deepEqual(payload.celebrations, []);
    assert.deepEqual(
      {
        rewardRows: countRows("reward_ledger"),
        dailyRows: countRows("gamification_daily_activity"),
        unlockRows: countRows("gamification_item_unlocks"),
        celebrationRows: countRows("gamification_celebrations")
      },
      before
    );
    assert.equal(
      countRows("gamification_item_unlocks WHERE user_id = 'aggregate'"),
      0
    );
    assert.equal(
      countRows("gamification_celebrations WHERE user_id = 'aggregate'"),
      0
    );
  });

  it("Doctor accepts selected equipment values from unlock reward payloads", async () => {
    const rootDir = await setupDatabase("forge-gamification-doctor-");
    const mascotSkin = GAMIFICATION_CATALOG.find(
      (item) =>
        item.kind === "unlock" &&
        item.unlockType === "mascot_skin" &&
        typeof item.rewardPayload.mascotSkin === "string"
    )?.rewardPayload.mascotSkin;
    if (typeof mascotSkin !== "string") {
      assert.fail("Expected a mascot skin reward in the catalog");
    }
    const selectedMascotSkin = mascotSkin;

    getDatabase()
      .prepare(
        `INSERT INTO gamification_equipment (
           user_id, selected_mascot_skin, selected_hud_treatment,
           selected_streak_effect, selected_trophy_shelf,
           selected_celebration_variant, updated_at
         ) VALUES ('user_operator', ?, NULL, NULL, NULL, NULL, ?)`
      )
      .run(selectedMascotSkin, new Date().toISOString());

    const report = await buildForgeDoctorReport({
      settings: getSettings(),
      settingsFile: getSettingsFileStatus(),
      runtime: { storageRoot: rootDir },
      health: { ok: true }
    });
    const equipmentCheck = report.checks.find(
      (check) => check.id === "rewards.gamification.equipment"
    );

    assert.ok(equipmentCheck);
    assert.equal(equipmentCheck.status, "pass");
    assert.equal(equipmentCheck.affectedCount, 0);
  });
});

function countRows(fromSql: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM ${fromSql}`)
    .get() as { count: number };
  return row.count;
}
