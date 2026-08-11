import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("PSY-21 persists generated mode interpretations only after explicit acceptance", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-psy-21-interpretation-control-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false,
    peerRuntime: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    const createSession = async (
      suffix: string,
      answers: Array<{ questionKey: string; value: string }>
    ) =>
      app.inject({
        method: "POST",
        url: "/api/v1/psyche/mode-guides",
        headers: { cookie },
        payload: { summary: `PSY-21 ${suffix}`, answers }
      });
    const interpretedAnswers = [
      { questionKey: "coping_response", value: "detach" },
      { questionKey: "child_state", value: "vulnerable" }
    ];

    const accepted = await createSession("accepted", [
      ...interpretedAnswers,
      { questionKey: "interpretation_stance", value: "fits" }
    ]);
    assert.equal(accepted.statusCode, 201, accepted.body);
    assert.ok(
      (accepted.json() as { session: { results: unknown[] } }).session.results
        .length > 0
    );

    const corrected = await createSession("corrected", [
      ...interpretedAnswers,
      { questionKey: "interpretation_stance", value: "partly" },
      {
        questionKey: "user_correction",
        value: "I was creating distance so I would not escalate the conflict."
      }
    ]);
    assert.equal(corrected.statusCode, 201, corrected.body);
    const correctedSession = corrected.json() as {
      session: {
        answers: Array<{ questionKey: string; value: string }>;
        results: unknown[];
      };
    };
    assert.deepEqual(correctedSession.session.results, []);
    assert.ok(
      correctedSession.session.answers.some(
        (answer) =>
          answer.questionKey === "user_correction" &&
          answer.value.includes("not escalate")
      )
    );

    for (const stance of ["decline", "uncertain"] as const) {
      const response = await createSession(stance, [
        ...interpretedAnswers,
        { questionKey: "interpretation_stance", value: stance }
      ]);
      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(
        (response.json() as { session: { results: unknown[] } }).session
          .results,
        []
      );
    }

    const unreviewed = await createSession("unreviewed", interpretedAnswers);
    assert.equal(unreviewed.statusCode, 201, unreviewed.body);
    assert.deepEqual(
      (unreviewed.json() as { session: { results: unknown[] } }).session
        .results,
      []
    );

    const missingCorrection = await createSession("missing correction", [
      ...interpretedAnswers,
      { questionKey: "interpretation_stance", value: "partly" }
    ]);
    assert.equal(missingCorrection.statusCode, 400, missingCorrection.body);
    assert.match(missingCorrection.body, /requires the user's correction/i);

    const duplicateDecision = await createSession("duplicate decision", [
      ...interpretedAnswers,
      { questionKey: "interpretation_stance", value: "fits" },
      { questionKey: "interpretation_stance", value: "decline" }
    ]);
    assert.equal(duplicateDecision.statusCode, 400, duplicateDecision.body);
    assert.match(duplicateDecision.body, /exactly one interpretation stance/i);

    const persisted = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/mode-guides",
      headers: { cookie }
    });
    assert.equal(persisted.statusCode, 200, persisted.body);
    const persistedSessions = (
      persisted.json() as { sessions: Array<{ summary: string }> }
    ).sessions;
    assert.equal(persistedSessions.length, 5);
    assert.equal(
      persistedSessions.some((session) =>
        /missing correction|duplicate decision/i.test(session.summary)
      ),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
