import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  createCompanionPairingSession,
  createCompanionPairingSessionSchema
} from "./health.js";

async function withTestDatabase(run: () => void | Promise<void>) {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-companion-pairing-atomicity-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();
  try {
    await run();
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function createPairing() {
  return createCompanionPairingSession(
    "http://127.0.0.1:4317/api/v1",
    createCompanionPairingSessionSchema.parse({
      label: "Atomic pairing test",
      userId: "user_operator"
    })
  );
}

function countRows(sql: string, ...params: string[]) {
  return (
    getDatabase()
      .prepare(sql)
      .get(...params) as { count: number }
  ).count;
}

test("replacement pairing revokes matching pending sessions with one audit trail", async () => {
  await withTestDatabase(() => {
    const first = createPairing();
    const replacement = createPairing();
    const database = getDatabase();
    const firstRow = database
      .prepare(
        `SELECT status, last_sync_error
         FROM companion_pairing_sessions
         WHERE id = ?`
      )
      .get(first.session.id) as {
      status: string;
      last_sync_error: string | null;
    };

    assert.notEqual(replacement.session.id, first.session.id);
    assert.equal(firstRow.status, "revoked");
    assert.equal(firstRow.last_sync_error, "Superseded by a newer pairing QR");
    assert.equal(replacement.session.status, "pending");
    assert.equal(
      countRows(
        "SELECT COUNT(*) AS count FROM companion_pairing_source_states WHERE pairing_session_id = ?",
        first.session.id
      ),
      3
    );
    assert.equal(
      countRows(
        "SELECT COUNT(*) AS count FROM companion_pairing_source_states WHERE pairing_session_id = ?",
        replacement.session.id
      ),
      3
    );
    assert.equal(
      countRows(
        `SELECT COUNT(*) AS count
         FROM activity_events
         WHERE entity_id = ? AND event_type = 'companion_pairing_revoked'`,
        first.session.id
      ),
      1
    );
    assert.equal(
      countRows(
        `SELECT COUNT(*) AS count
         FROM event_log
         WHERE entity_id = ? AND event_kind = 'activity.companion_pairing_revoked'`,
        first.session.id
      ),
      1
    );
  });
});

const replacementFailureTriggers = [
  {
    stage: "revocation activity",
    message: "injected replacement activity failure",
    sql: `
      CREATE TRIGGER fail_replacement_activity
      BEFORE INSERT ON activity_events
      WHEN NEW.event_type = 'companion_pairing_revoked'
      BEGIN
        SELECT RAISE(ABORT, 'injected replacement activity failure');
      END;
    `
  },
  {
    stage: "session insertion",
    message: "injected replacement insertion failure",
    sql: `
      CREATE TRIGGER fail_replacement_insert
      BEFORE INSERT ON companion_pairing_sessions
      WHEN NEW.label = 'Atomic pairing test'
      BEGIN
        SELECT RAISE(ABORT, 'injected replacement insertion failure');
      END;
    `
  },
  {
    stage: "source-state insertion",
    message: "injected replacement source-state failure",
    sql: `
      CREATE TRIGGER fail_replacement_source_state
      BEFORE INSERT ON companion_pairing_source_states
      WHEN NEW.source_key = 'movement'
      BEGIN
        SELECT RAISE(ABORT, 'injected replacement source-state failure');
      END;
    `
  }
] as const;

for (const failure of replacementFailureTriggers) {
  test(`replacement ${failure.stage} failure preserves the prior pairing and audit state`, async () => {
    await withTestDatabase(() => {
      const first = createPairing();
      const database = getDatabase();
      const before = database
        .prepare(
          `SELECT status, last_sync_error, updated_at
           FROM companion_pairing_sessions
           WHERE id = ?`
        )
        .get(first.session.id) as {
        status: string;
        last_sync_error: string | null;
        updated_at: string;
      };

      database.exec(failure.sql);

      assert.throws(() => createPairing(), new RegExp(failure.message));

      const after = database
        .prepare(
          `SELECT status, last_sync_error, updated_at
           FROM companion_pairing_sessions
           WHERE id = ?`
        )
        .get(first.session.id) as typeof before;
      assert.deepEqual(after, before);
      assert.equal(
        countRows("SELECT COUNT(*) AS count FROM companion_pairing_sessions"),
        1
      );
      assert.equal(
        countRows(
          "SELECT COUNT(*) AS count FROM companion_pairing_source_states"
        ),
        3
      );
      assert.equal(
        countRows(
          `SELECT COUNT(*) AS count
           FROM activity_events
           WHERE entity_id = ? AND event_type = 'companion_pairing_revoked'`,
          first.session.id
        ),
        0
      );
      assert.equal(
        countRows(
          `SELECT COUNT(*) AS count
           FROM event_log
           WHERE entity_id = ? AND event_kind = 'activity.companion_pairing_revoked'`,
          first.session.id
        ),
        0
      );
    });
  });
}
