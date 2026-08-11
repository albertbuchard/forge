import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import {
  createTag,
  getTagById,
  listTags,
  updateTag
} from "./repositories/tags.js";

test("PLAN-16 normalizes tag identity and rejects a normalized rename collision atomically", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-plan-16-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const first = createTag({
      name: "  ＰＲＯＪＥＣＴ   Alpha  ",
      kind: "category",
      color: "#123456",
      description: "Canonical planning tag"
    });
    const replay = createTag({
      name: "project alpha",
      kind: "value",
      color: "#abcdef",
      description: "This duplicate must not replace canonical metadata"
    });

    assert.equal(first.name, "PROJECT Alpha");
    assert.equal(replay.id, first.id);
    assert.equal(replay.kind, "category");
    assert.equal(replay.description, "Canonical planning tag");
    assert.equal(listTags().filter((tag) => tag.id === first.id).length, 1);

    getDatabase()
      .prepare(
        `INSERT INTO tags (id, name, kind, color, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "tag_legacy_spacing",
        "Legacy   Roadmap",
        "category",
        "#777777",
        "Pre-normalization fixture",
        "2026-08-11T00:00:00.000Z"
      );
    const legacyReplay = createTag({
      name: "legacy roadmap",
      kind: "value",
      color: "#888888",
      description: "Must reuse the legacy identity"
    });
    assert.equal(legacyReplay.id, "tag_legacy_spacing");

    const other = createTag({
      name: "Other",
      kind: "category",
      color: "#654321",
      description: "Must survive the rejected rename"
    });
    assert.throws(
      () => updateTag(other.id, { name: "  project   alpha " }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        error.code === "tag_conflict"
    );

    assert.equal(getTagById(other.id)?.name, "Other");
    const stored = getDatabase()
      .prepare("SELECT id, name FROM tags WHERE id IN (?, ?, ?) ORDER BY id")
      .all(first.id, other.id, legacyReplay.id) as Array<{
      id: string;
      name: string;
    }>;
    assert.deepEqual(stored.map((tag) => tag.name).sort(), [
      "Legacy   Roadmap",
      "Other",
      "PROJECT Alpha"
    ]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("PLAN-16 reports a normalized duplicate in the Bin without creating an invisible tag", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-plan-16-bin-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tags",
      headers: { cookie },
      payload: {
        name: "Focused   Work",
        kind: "category",
        color: "#224466",
        description: "Original tag"
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const tagId = (created.json() as { tag: { id: string } }).tag.id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/tags/${tagId}`,
      headers: { cookie }
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/tags",
      headers: { cookie },
      payload: {
        name: "ＦＯＣＵＳＥＤ work",
        kind: "value",
        color: "#6688aa",
        description: "Must not be created"
      }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(
      (duplicate.json() as { code: string }).code,
      "tag_duplicate_in_bin"
    );
    assert.equal(
      (duplicate.json() as { existingId: string }).existingId,
      tagId
    );

    const matchingRows = getDatabase()
      .prepare(
        `SELECT id
         FROM tags
         WHERE forge_tag_key(name) = forge_tag_key(?)`
      )
      .all("focused work") as Array<{ id: string }>;
    assert.deepEqual(
      matchingRows.map((row) => row.id),
      [tagId]
    );

    getDatabase()
      .prepare(
        `INSERT INTO tags (id, name, kind, color, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "tag_live_legacy_equivalent",
        "FOCUSED  WORK",
        "category",
        "#446688",
        "Live legacy equivalent",
        "2026-08-11T00:00:00.000Z"
      );
    const livePreferred = await app.inject({
      method: "POST",
      url: "/api/v1/tags",
      headers: { cookie },
      payload: {
        name: "focused work",
        kind: "value",
        color: "#88aacc",
        description: "Must reuse the live row"
      }
    });
    assert.equal(livePreferred.statusCode, 201, livePreferred.body);
    assert.equal(
      (livePreferred.json() as { tag: { id: string } }).tag.id,
      "tag_live_legacy_equivalent"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
