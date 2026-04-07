import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: {
      host: "127.0.0.1:4317"
    }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

test("questionnaire seeds are present in the psyche library", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-questionnaire-library-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/questionnaires"
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      instruments: Array<{ key: string; title: string; currentVersionNumber: number }>;
    };

    const keys = payload.instruments.map((instrument) => instrument.key);
    assert.deepEqual(keys, ["audit", "gad_7", "pcl_5", "phq_9", "srq_20", "who_5", "ysq_r"]);
    assert.ok(payload.instruments.every((instrument) => instrument.currentVersionNumber === 1));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completing a PHQ-9 run stores answers, score rows, and history", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-questionnaire-run-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const libraryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/questionnaires"
    });
    const library = libraryResponse.json() as {
      instruments: Array<{ id: string; key: string }>;
    };
    const phq = library.instruments.find((instrument) => instrument.key === "phq_9");
    assert.ok(phq);

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${phq!.id}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(startResponse.statusCode, 201);
    const started = startResponse.json() as {
      run: { id: string };
      version: { definition: { items: Array<{ id: string; options: Array<{ key: string; label: string; value: number }> }> } };
    };

    const answers = started.version.definition.items.map((item) => {
      const option = item.options[item.options.length - 1]!;
      return {
        itemId: item.id,
        optionKey: option.key,
        valueText: option.label,
        numericValue: option.value,
        answer: { label: option.label, value: option.value }
      };
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/questionnaire-runs/${started.run.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        answers,
        progressIndex: 8
      }
    });
    assert.equal(patchResponse.statusCode, 200);

    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaire-runs/${started.run.id}/complete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {}
    });
    assert.equal(completeResponse.statusCode, 200);
    const completed = completeResponse.json() as {
      run: { status: string; completedAt: string | null };
      scores: Array<{ scoreKey: string; valueNumeric: number | null; bandLabel: string }>;
      answers: Array<{ itemId: string }>;
      history: Array<{ runId: string; primaryScore: number | null; bandLabel: string }>;
    };
    assert.equal(completed.run.status, "completed");
    assert.ok(completed.run.completedAt);
    assert.equal(completed.answers.length, 9);
    assert.deepEqual(
      completed.scores.map((score) => [score.scoreKey, score.valueNumeric, score.bandLabel]),
      [
        ["phq9_total", 27, "Severe"],
        ["phq9_item9", 3, ""]
      ]
    );
    assert.equal(completed.history[0]?.runId, started.run.id);
    assert.equal(completed.history[0]?.primaryScore, 27);

    const noteRow = getDatabase()
      .prepare(
        `
          SELECT title, tags_json, frontmatter_json
          FROM notes
          WHERE json_extract(frontmatter_json, '$.questionnaireRunId') = ?
          LIMIT 1
        `
      )
      .get(started.run.id) as
      | {
          title: string;
          tags_json: string;
          frontmatter_json: string;
        }
      | undefined;
    assert.ok(noteRow);
    assert.match(noteRow.title, /PHQ-9/i);
    assert.deepEqual(JSON.parse(noteRow.tags_json), ["Self-observation"]);
    const frontmatter = JSON.parse(noteRow.frontmatter_json) as Record<string, unknown>;
    assert.equal(frontmatter.questionnaireRunId, started.run.id);
    assert.equal(frontmatter.questionnaireVersionId, completed.run.versionId);
    assert.ok(typeof frontmatter.observedAt === "string");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("AUDIT hides downstream alcohol questions when drinking frequency is never", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-questionnaire-audit-flow-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const libraryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/questionnaires"
    });
    const library = libraryResponse.json() as {
      instruments: Array<{ id: string; key: string }>;
    };
    const audit = library.instruments.find((instrument) => instrument.key === "audit");
    assert.ok(audit);

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${audit!.id}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(startResponse.statusCode, 201);
    const started = startResponse.json() as {
      run: { id: string };
      version: { definition: { items: Array<{ id: string }> } };
    };
    assert.equal(started.version.definition.items.length, 10);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/questionnaire-runs/${started.run.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        answers: [
          {
            itemId: "audit_1",
            optionKey: "never",
            valueText: "Never",
            numericValue: 0,
            answer: { label: "Never", value: 0 }
          }
        ],
        progressIndex: 0
      }
    });
    assert.equal(patchResponse.statusCode, 200);

    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaire-runs/${started.run.id}/complete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {}
    });
    assert.equal(completeResponse.statusCode, 200);
    const completed = completeResponse.json() as {
      run: { status: string };
      scores: Array<{ scoreKey: string; valueNumeric: number | null; bandLabel: string }>;
    };
    assert.equal(completed.run.status, "completed");
    assert.deepEqual(
      completed.scores.map((score) => [score.scoreKey, score.valueNumeric, score.bandLabel]),
      [["audit_total", 0, "Zone I · Low risk"]]
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("custom questionnaire drafts can publish new versions without mutating past runs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-questionnaire-versioning-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/questionnaires",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Tiny check-in",
        subtitle: "Custom",
        description: "One question custom instrument.",
        aliases: [],
        symptomDomains: ["check-in"],
        tags: ["custom"],
        sourceClass: "secondary_verified",
        availability: "custom",
        isSelfReport: true,
        userId: "user_operator",
        versionLabel: "Draft 1",
        definition: {
          locale: "en",
          instructions: "Rate how present this feels today.",
          completionNote: "",
          presentationMode: "single_question",
          responseStyle: "four_point_frequency",
          itemIds: ["check_1"],
          items: [
            {
              id: "check_1",
              prompt: "I feel grounded.",
              shortLabel: "",
              description: "",
              helperText: "",
              required: true,
              tags: [],
              options: [
                { key: "0", label: "Not at all", value: 0, description: "" },
                { key: "1", label: "A little", value: 1, description: "" },
                { key: "2", label: "Mostly", value: 2, description: "" },
                { key: "3", label: "Strongly", value: 3, description: "" }
              ]
            }
          ],
          sections: [
            {
              id: "check",
              title: "Check",
              description: "",
              itemIds: ["check_1"]
            }
          ],
          pageSize: null
        },
        scoring: {
          scores: [
            {
              key: "total",
              label: "Total",
              description: "",
              valueType: "number",
              expression: { kind: "sum", itemIds: ["check_1"] },
              dependsOnItemIds: ["check_1"],
              missingPolicy: { mode: "require_all" },
              bands: [{ label: "Strong", min: 3, max: 3, severity: "" }],
              roundTo: null,
              unitLabel: ""
            }
          ]
        },
        provenance: {
          retrievalDate: "2026-04-06",
          sourceClass: "secondary_verified",
          scoringNotes: "Sum the one item.",
          sources: [
            {
              label: "Local draft",
              url: "https://example.com/draft",
              citation: "Local draft questionnaire",
              notes: ""
            }
          ]
        }
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json() as {
      instrument: {
        id: string;
        draftVersion: { id: string; versionNumber: number } | null;
      };
    };
    const instrumentId = created.instrument.id;
    assert.equal(created.instrument.draftVersion?.versionNumber, 1);

    const publishV1 = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/publish`,
      headers: { cookie: operatorCookie },
      payload: { label: "v1" }
    });
    assert.equal(publishV1.statusCode, 200);

    const runStart = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/runs`,
      headers: { cookie: operatorCookie },
      payload: { userId: "user_operator" }
    });
    assert.equal(runStart.statusCode, 201);
    const started = runStart.json() as { run: { id: string } };

    await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/questionnaire-runs/${started.run.id}`,
      headers: { cookie: operatorCookie },
      payload: {
        answers: [
          {
            itemId: "check_1",
            optionKey: "3",
            valueText: "Strongly",
            numericValue: 3,
            answer: { label: "Strongly", value: 3 }
          }
        ],
        progressIndex: 0
      }
    });

    const completedRun = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaire-runs/${started.run.id}/complete`,
      headers: { cookie: operatorCookie },
      payload: {}
    });
    assert.equal(completedRun.statusCode, 200);
    const completed = completedRun.json() as {
      run: { versionId: string };
      version: { versionNumber: number };
    };
    assert.equal(completed.version.versionNumber, 1);

    const draftAgain = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/draft`,
      headers: { cookie: operatorCookie },
      payload: {}
    });
    assert.equal(draftAgain.statusCode, 200);

    const updateDraft = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/draft`,
      headers: { cookie: operatorCookie },
      payload: {
        title: "Tiny check-in revised",
        subtitle: "Custom",
        description: "Updated copy.",
        aliases: [],
        symptomDomains: ["check-in"],
        tags: ["custom"],
        sourceClass: "secondary_verified",
        availability: "custom",
        isSelfReport: true,
        label: "v2 draft",
        definition: {
          locale: "en",
          instructions: "Rate how present this feels right now.",
          completionNote: "",
          presentationMode: "single_question",
          responseStyle: "four_point_frequency",
          itemIds: ["check_1"],
          items: [
            {
              id: "check_1",
              prompt: "I feel grounded right now.",
              shortLabel: "",
              description: "",
              helperText: "",
              required: true,
              tags: [],
              options: [
                { key: "0", label: "Not at all", value: 0, description: "" },
                { key: "1", label: "A little", value: 1, description: "" },
                { key: "2", label: "Mostly", value: 2, description: "" },
                { key: "3", label: "Strongly", value: 3, description: "" }
              ]
            }
          ],
          sections: [
            {
              id: "check",
              title: "Check",
              description: "",
              itemIds: ["check_1"]
            }
          ],
          pageSize: null
        },
        scoring: {
          scores: [
            {
              key: "total",
              label: "Total",
              description: "",
              valueType: "number",
              expression: { kind: "sum", itemIds: ["check_1"] },
              dependsOnItemIds: ["check_1"],
              missingPolicy: { mode: "require_all" },
              bands: [{ label: "Strong", min: 3, max: 3, severity: "" }],
              roundTo: null,
              unitLabel: ""
            }
          ]
        },
        provenance: {
          retrievalDate: "2026-04-06",
          sourceClass: "secondary_verified",
          scoringNotes: "Sum the one item.",
          sources: [
            {
              label: "Local draft",
              url: "https://example.com/draft",
              citation: "Local draft questionnaire",
              notes: ""
            }
          ]
        }
      }
    });
    assert.equal(updateDraft.statusCode, 200);

    const publishV2 = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/publish`,
      headers: { cookie: operatorCookie },
      payload: { label: "v2" }
    });
    assert.equal(publishV2.statusCode, 200);
    const published = publishV2.json() as {
      instrument: {
        currentVersionNumber: number;
        currentVersion: { versionNumber: number; definition: { items: Array<{ prompt: string }> } } | null;
      };
    };
    assert.equal(published.instrument.currentVersionNumber, 2);
    assert.equal(
      published.instrument.currentVersion?.definition.items[0]?.prompt,
      "I feel grounded right now."
    );

    const runDetail = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/questionnaire-runs/${started.run.id}`
    });
    assert.equal(runDetail.statusCode, 200);
    const preserved = runDetail.json() as {
      version: { versionNumber: number; definition: { items: Array<{ prompt: string }> } };
    };
    assert.equal(preserved.version.versionNumber, 1);
    assert.equal(
      preserved.version.definition.items[0]?.prompt,
      "I feel grounded."
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
