import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { hashPeerApiValue } from "./peer-sharing.js";

type QuestionPreviewRow = {
  id: string;
  owner_user_id: string;
  person_id: string;
  interpretation_hash: string;
  normalized_question_hash: string;
  typed_query_json: string;
  status: "active" | "consumed" | "expired";
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

function normalizeQuestion(question: string) {
  return question
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("und");
}

export function createPeerQuestionInterpretation(input: {
  ownerUserId: string;
  personId: string;
  question: string;
  typedQuery: Record<string, unknown>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const id = `pqi_${randomUUID().replaceAll("-", "")}`;
  const normalizedQuestionHash = createHash("sha256")
    .update("forge-peer/question/v1\0", "utf8")
    .update(normalizeQuestion(input.question), "utf8")
    .digest("hex");
  const interpretationHash = hashPeerApiValue({
    ownerUserId: input.ownerUserId,
    personId: input.personId,
    normalizedQuestionHash,
    typedQuery: input.typedQuery
  });
  const typedQueryJson = JSON.stringify(input.typedQuery);
  if (Buffer.byteLength(typedQueryJson, "utf8") > 262_144) {
    throw new Error("Typed peer question exceeds storage bounds.");
  }
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO peer_question_interpretations (
         id, owner_user_id, person_id, interpretation_hash,
         normalized_question_hash, typed_query_json, status, expires_at,
         consumed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?)`
    )
    .run(
      id,
      input.ownerUserId,
      input.personId,
      interpretationHash,
      normalizedQuestionHash,
      typedQueryJson,
      expiresAt,
      now.toISOString()
    );
  return { id, interpretationHash, expiresAt, typedQuery: input.typedQuery };
}

export function consumePeerQuestionInterpretation<T>(input: {
  ownerUserId: string;
  personId: string;
  interpretationId: string;
  interpretationHash: string;
  typedQuery: Record<string, unknown>;
  execute: () => T;
  now?: Date;
}): T {
  const now = (input.now ?? new Date()).toISOString();
  return runInTransaction(() => {
    const row = getDatabase()
      .prepare(
        `SELECT id, owner_user_id, person_id, interpretation_hash,
                normalized_question_hash, typed_query_json, status,
                expires_at, consumed_at, created_at
         FROM peer_question_interpretations
         WHERE id = ? AND owner_user_id = ? AND person_id = ?
           AND interpretation_hash = ? AND status = 'active'
           AND expires_at > ?`
      )
      .get(
        input.interpretationId,
        input.ownerUserId,
        input.personId,
        input.interpretationHash,
        now
      ) as QuestionPreviewRow | undefined;
    if (!row) {
      throw new Error("Question interpretation is invalid, expired, or used.");
    }
    const expectedQuery = JSON.parse(row.typed_query_json) as Record<
      string,
      unknown
    >;
    const expectedHash = hashPeerApiValue({
      ownerUserId: row.owner_user_id,
      personId: row.person_id,
      normalizedQuestionHash: row.normalized_question_hash,
      typedQuery: expectedQuery
    });
    if (
      expectedHash !== row.interpretation_hash ||
      hashPeerApiValue(input.typedQuery) !== hashPeerApiValue(expectedQuery)
    ) {
      throw new Error("Typed peer question changed after interpretation.");
    }
    const result = input.execute();
    const changed = getDatabase()
      .prepare(
        `UPDATE peer_question_interpretations
         SET status = 'consumed', consumed_at = ?
         WHERE id = ? AND owner_user_id = ? AND status = 'active'`
      )
      .run(now, input.interpretationId, input.ownerUserId).changes;
    if (changed !== 1) {
      throw new Error("Question interpretation was consumed concurrently.");
    }
    return result;
  });
}
