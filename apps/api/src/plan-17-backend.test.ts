import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AGENT_ONBOARDING_TOOL_INPUT_CATALOG, buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import { createGoal } from "./repositories/goals.js";
import { listNotes } from "./repositories/notes.js";
import { createProject } from "./repositories/projects.js";
import {
  claimTaskRun,
  completeTaskRun,
  getTaskRunById,
  preflightTaskRunCompletionReplay,
  preflightTaskRunReleaseReplay,
  releaseTaskRun
} from "./repositories/task-runs.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import {
  createTask,
  getTaskById,
  listTasks,
  updateTask
} from "./repositories/tasks.js";
import { createUser } from "./repositories/users.js";
import {
  TASK_CLOSEOUT_LIMITS,
  completionReportSchema,
  taskRunCompleteSchema,
  taskRunReleaseSchema,
  workItemGitRefInputSchema
} from "./types.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function withIsolatedForge(run: (app: TestApp) => Promise<void> | void) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-plan17-"));
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function createFixture(label: string) {
  const user = createUser({
    kind: "human",
    handle: `plan17-${label}`,
    displayName: `PLAN-17 ${label}`,
    description: "",
    accentColor: "#336699"
  });
  const goal = createGoal({
    title: `PLAN-17 goal ${label}`,
    description: "",
    horizon: "year",
    status: "active",
    targetPoints: 200,
    themeColor: "#336699",
    tagIds: [],
    notes: [],
    userId: user.id
  });
  const project = createProject({
    goalId: goal.id,
    title: `PLAN-17 project ${label}`,
    userId: user.id
  });
  return { user, goal, project };
}

function createFixtureTask(label: string) {
  const fixture = createFixture(label);
  const task = createTask({
    title: `PLAN-17 task ${label}`,
    goalId: fixture.goal.id,
    projectId: fixture.project.id,
    userId: fixture.user.id,
    owner: fixture.user.displayName
  });
  return { ...fixture, task };
}

function expectHttpError(
  operation: () => unknown,
  statusCode: number,
  code: string
) {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    return true;
  });
}

const structuredCloseout = {
  actor: "Codex",
  note: "PLAN-17 complete",
  completionReport: {
    workSummary: "Implemented and verified the PLAN-17 backend closeout.",
    modifiedFiles: ["apps/api/src/repositories/task-runs.ts"],
    linkedGitRefIds: ["draft-ref-plan17"]
  },
  gitRefs: [
    {
      id: "draft-ref-plan17",
      refType: "commit" as const,
      provider: "github",
      repository: "albertbuchard/forge",
      refValue: "abc123",
      url: "https://github.com/albertbuchard/forge/commit/abc123",
      displayTitle: "PLAN-17 closeout"
    }
  ],
  closeoutNote: {
    contentMarkdown: "Durable PLAN-17 evidence.",
    links: [
      {
        entityType: "artifact" as const,
        entityId: "artifact_plan17",
        anchorKey: "closeout"
      }
    ]
  }
};

test("PLAN-17 preserves draft Git IDs, reads evidence back exactly, and protects ref integrity", async () => {
  await withIsolatedForge(() => {
    const fixture = createFixture("git-integrity");
    const task = createTask({
      title: "PLAN-17 exact evidence",
      goalId: fixture.goal.id,
      projectId: fixture.project.id,
      userId: fixture.user.id,
      owner: fixture.user.displayName,
      status: "done",
      completionReport: structuredCloseout.completionReport,
      gitRefs: structuredCloseout.gitRefs
    });

    assert.equal(task.closeoutState, "complete");
    assert.deepEqual(
      task.completionReport,
      structuredCloseout.completionReport
    );
    assert.equal(task.gitRefs.length, 1);
    assert.equal(task.gitRefs[0]?.id, "draft-ref-plan17");
    assert.equal(task.gitRefs[0]?.url, structuredCloseout.gitRefs[0]?.url);
    assert.equal(task.gitRefs[0]?.rawUrl, structuredCloseout.gitRefs[0]?.url);
    assert.equal(task.gitRefs[0]?.urlSafety, "safe");

    expectHttpError(
      () => updateTask(task.id, { gitRefs: [] }),
      409,
      "completion_report_git_ref_missing"
    );
    assert.equal(getTaskById(task.id)?.gitRefs[0]?.id, "draft-ref-plan17");

    expectHttpError(
      () =>
        createTask({
          title: "PLAN-17 cross-task collision",
          goalId: fixture.goal.id,
          projectId: fixture.project.id,
          userId: fixture.user.id,
          gitRefs: structuredCloseout.gitRefs
        }),
      409,
      "git_ref_id_conflict"
    );
    assert.equal(
      listTasks().some(
        (entry) => entry.title === "PLAN-17 cross-task collision"
      ),
      false
    );

    expectHttpError(
      () =>
        updateTask(task.id, {
          completionReport: null,
          gitRefs: [
            structuredCloseout.gitRefs[0]!,
            { ...structuredCloseout.gitRefs[0]!, refValue: "def456" }
          ]
        }),
      409,
      "git_ref_id_duplicate"
    );
  });
});

test("PLAN-17 rejects unsafe new URLs and redacts unsafe legacy URLs", async () => {
  await withIsolatedForge(() => {
    assert.equal(
      workItemGitRefInputSchema.safeParse({
        refType: "commit",
        refValue: "abc123",
        url: "javascript:alert(1)"
      }).success,
      false
    );

    const { task } = createFixtureTask("legacy-url");
    const updated = updateTask(task.id, {
      gitRefs: [structuredCloseout.gitRefs[0]!]
    });
    assert.ok(updated);
    getDatabase()
      .prepare(`UPDATE work_item_git_refs SET url = ? WHERE id = ?`)
      .run("file:///Users/private/repository", "draft-ref-plan17");

    const legacy = getTaskById(task.id)?.gitRefs[0];
    assert.equal(legacy?.url, null);
    assert.equal(legacy?.rawUrl, null);
    assert.equal(legacy?.urlSafety, "unsafe");
  });
});

test("PLAN-17 schemas accept maxima, reject over-limit payloads, and dedupe bounded evidence", () => {
  const maxReport = {
    workSummary: "s".repeat(TASK_CLOSEOUT_LIMITS.workSummaryLength),
    modifiedFiles: Array.from(
      { length: TASK_CLOSEOUT_LIMITS.modifiedFiles },
      (_, index) => `src/file-${index}.ts`
    ),
    linkedGitRefIds: Array.from(
      { length: TASK_CLOSEOUT_LIMITS.linkedGitRefIds },
      (_, index) => `ref-${index}`
    )
  };
  assert.equal(completionReportSchema.safeParse(maxReport).success, true);
  assert.equal(
    completionReportSchema.safeParse({
      ...maxReport,
      modifiedFiles: [...maxReport.modifiedFiles, "src/one-file-too-many.ts"]
    }).success,
    false
  );
  assert.equal(
    completionReportSchema.parse({
      modifiedFiles: ["./src/a.ts", "src/a.ts"],
      linkedGitRefIds: ["ref-a", "ref-a"]
    }).modifiedFiles.length,
    1
  );
  assert.equal(
    taskRunCompleteSchema.safeParse({
      gitRefs: Array.from(
        { length: TASK_CLOSEOUT_LIMITS.gitRefs + 1 },
        (_, index) => ({
          id: `ref-${index}`,
          refType: "commit",
          refValue: `sha-${index}`
        })
      )
    }).success,
    false
  );
});

test("PLAN-17 complete is atomic across task, Git, Note, and completion activity boundaries", async () => {
  await withIsolatedForge(() => {
    const triggerCases = [
      {
        name: "plan17_fail_task",
        sql: (taskId: string) =>
          `CREATE TEMP TRIGGER plan17_fail_task BEFORE UPDATE OF status ON tasks
           WHEN NEW.id = '${taskId}' AND NEW.status = 'done'
           BEGIN SELECT RAISE(ABORT, 'plan17 task boundary'); END`
      },
      {
        name: "plan17_fail_git",
        sql: (taskId: string) =>
          `CREATE TEMP TRIGGER plan17_fail_git BEFORE INSERT ON work_item_git_refs
           WHEN NEW.work_item_id = '${taskId}'
           BEGIN SELECT RAISE(ABORT, 'plan17 git boundary'); END`
      },
      {
        name: "plan17_fail_note",
        sql: () =>
          `CREATE TEMP TRIGGER plan17_fail_note BEFORE INSERT ON notes
           BEGIN SELECT RAISE(ABORT, 'plan17 note boundary'); END`
      },
      {
        name: "plan17_fail_activity",
        sql: () =>
          `CREATE TEMP TRIGGER plan17_fail_activity BEFORE INSERT ON activity_events
           WHEN NEW.event_type = 'task_run_completed'
           BEGIN SELECT RAISE(ABORT, 'plan17 activity boundary'); END`
      }
    ];

    for (const [index, trigger] of triggerCases.entries()) {
      const { task } = createFixtureTask(`rollback-${index}`);
      const actor = `Codex-${index}`;
      const claimed = claimTaskRun(task.id, {
        actor,
        leaseTtlSeconds: 900
      });
      getDatabase().exec(trigger.sql(task.id));

      assert.throws(() =>
        completeTaskRun(claimed.run.id, { ...structuredCloseout, actor })
      );
      getDatabase().exec(`DROP TRIGGER ${trigger.name}`);

      assert.equal(getTaskRunById(claimed.run.id)?.status, "active");
      const rolledBackTask = getTaskById(task.id);
      assert.equal(rolledBackTask?.status, "in_progress");
      assert.equal(rolledBackTask?.completionReport, null);
      assert.deepEqual(rolledBackTask?.gitRefs, []);
      assert.equal(
        listNotes().some((note) =>
          note.links.some(
            (link) => link.entityType === "task" && link.entityId === task.id
          )
        ),
        false
      );
      const completedActivities = getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM activity_events
           WHERE entity_type = 'task_run' AND entity_id = ? AND event_type = 'task_run_completed'`
        )
        .get(claimed.run.id) as { count: number };
      assert.equal(completedActivities.count, 0);
    }
  });
});

test("PLAN-17 completion fingerprints permit exact replay and reject changed replay", async () => {
  await withIsolatedForge(() => {
    const { task } = createFixtureTask("replay");
    const claimed = claimTaskRun(task.id, {
      actor: "Codex",
      leaseTtlSeconds: 900
    });

    assert.equal(
      preflightTaskRunCompletionReplay(claimed.run.id, structuredCloseout),
      null
    );
    const completed = completeTaskRun(claimed.run.id, structuredCloseout);
    assert.equal(
      preflightTaskRunCompletionReplay(claimed.run.id, structuredCloseout)?.id,
      completed.id
    );
    const replayed = completeTaskRun(claimed.run.id, structuredCloseout);
    assert.equal(completed.status, "completed");
    assert.equal(replayed.id, completed.id);

    const activity = getDatabase()
      .prepare(
        `SELECT metadata_json FROM activity_events
         WHERE entity_type = 'task_run' AND entity_id = ? AND event_type = 'task_run_completed'`
      )
      .get(claimed.run.id) as { metadata_json: string };
    const metadata = JSON.parse(activity.metadata_json) as {
      closeoutFingerprint?: string;
    };
    assert.match(metadata.closeoutFingerprint ?? "", /^[0-9a-f]{64}$/);

    expectHttpError(
      () =>
        preflightTaskRunCompletionReplay(claimed.run.id, {
          ...structuredCloseout,
          completionReport: {
            ...structuredCloseout.completionReport,
            workSummary: "Changed replay evidence"
          }
        }),
      409,
      "task_run_closeout_conflict"
    );

    const saved = getTaskById(task.id);
    assert.equal(saved?.status, "done");
    assert.equal(saved?.closeoutState, "complete");
    assert.deepEqual(
      saved?.completionReport,
      structuredCloseout.completionReport
    );
    assert.equal(saved?.gitRefs[0]?.id, "draft-ref-plan17");
    const closeoutNote = listNotes().find((note) =>
      note.links.some(
        (link) => link.entityType === "task" && link.entityId === task.id
      )
    );
    assert.ok(closeoutNote);
    assert.ok(
      closeoutNote.links.some(
        (link) =>
          link.entityType === "artifact" &&
          link.entityId === "artifact_plan17" &&
          link.anchorKey === "closeout"
      )
    );
  });
});

test("PLAN-17 release remains handoff-only and quick completion is deferred", async () => {
  await withIsolatedForge(() => {
    const { task } = createFixtureTask("release");
    const claimed = claimTaskRun(task.id, {
      actor: "Codex",
      leaseTtlSeconds: 900
    });
    const handoff = {
      actor: "Codex",
      note: "Handoff",
      closeoutNote: { contentMarkdown: "Paused for review." }
    } as const;
    assert.equal(preflightTaskRunReleaseReplay(claimed.run.id, handoff), null);
    const released = releaseTaskRun(claimed.run.id, handoff);
    assert.equal(
      preflightTaskRunReleaseReplay(claimed.run.id, handoff)?.id,
      released.id
    );
    assert.equal(released.status, "released");
    assert.equal(getTaskById(task.id)?.status, "in_progress");
    assert.equal(getTaskById(task.id)?.completionReport, null);
    assert.equal(getTaskById(task.id)?.closeoutState, "not_applicable");
    const replayed = releaseTaskRun(claimed.run.id, handoff);
    assert.equal(replayed.id, released.id);
    expectHttpError(
      () =>
        preflightTaskRunReleaseReplay(claimed.run.id, {
          actor: "Codex"
        }),
      409,
      "task_run_handoff_conflict"
    );
    expectHttpError(
      () =>
        releaseTaskRun(claimed.run.id, {
          actor: "Codex"
        }),
      409,
      "task_run_handoff_conflict"
    );

    const activity = getDatabase()
      .prepare(
        `SELECT metadata_json FROM activity_events
         WHERE entity_type = 'task_run' AND entity_id = ? AND event_type = 'task_run_released'`
      )
      .get(claimed.run.id) as { metadata_json: string };
    const metadata = JSON.parse(activity.metadata_json) as {
      handoffFingerprint?: string;
    };
    assert.match(metadata.handoffFingerprint ?? "", /^[0-9a-f]{64}$/);

    expectHttpError(
      () =>
        preflightTaskRunReleaseReplay(claimed.run.id, {
          ...handoff,
          note: "Changed handoff"
        }),
      409,
      "task_run_handoff_conflict"
    );
    expectHttpError(
      () =>
        releaseTaskRun(claimed.run.id, {
          ...handoff,
          closeoutNote: { contentMarkdown: "Changed review note." }
        }),
      409,
      "task_run_handoff_conflict"
    );
    const linkedNotes = listNotes().filter((note) =>
      note.links.some(
        (link) => link.entityType === "task" && link.entityId === task.id
      )
    );
    assert.equal(linkedNotes.length, 1);
    assert.equal(linkedNotes[0]?.contentMarkdown, "Paused for review.");
    assert.equal(
      taskRunReleaseSchema.safeParse({
        actor: "Codex",
        completionReport: structuredCloseout.completionReport
      }).success,
      false
    );

    const quick = updateTask(task.id, { status: "done" });
    assert.equal(quick?.status, "done");
    assert.equal(quick?.completionReport, null);
    assert.equal(quick?.closeoutState, "deferred");
  });
});

test("PLAN-17 task reads normalize historical completion reports", async () => {
  await withIsolatedForge(() => {
    const { task } = createFixtureTask("legacy-closeout");
    getDatabase()
      .prepare(
        `UPDATE tasks
         SET status = 'done', completion_report_json = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify({
          completed_by: "codex",
          summary: "Historical closeout evidence remains readable.",
          modified_files: ["apps/api/src/repositories/tasks.ts"],
          verification: ["legacy fixture"]
        }),
        task.id
      );

    const saved = getTaskById(task.id);
    assert.equal(saved?.closeoutState, "complete");
    assert.deepEqual(saved?.completionReport, {
      workSummary: "Historical closeout evidence remains readable.",
      modifiedFiles: ["apps/api/src/repositories/tasks.ts"],
      linkedGitRefIds: []
    });
    assert.equal(
      listTasks().find((candidate) => candidate.id === task.id)?.closeoutState,
      "complete"
    );
  });
});

test("PLAN-17 onboarding publishes rich completion and distinct release contracts", async () => {
  const complete = AGENT_ONBOARDING_TOOL_INPUT_CATALOG.find(
    (entry) => entry.toolName === "forge_complete_task_run"
  );
  const release = AGENT_ONBOARDING_TOOL_INPUT_CATALOG.find(
    (entry) => entry.toolName === "forge_release_task_run"
  );
  assert.ok(complete);
  assert.ok(release);
  assert.match(complete.inputShape, /completionReport/);
  assert.match(complete.inputShape, /linkedGitRefIds/);
  assert.match(complete.inputShape, /gitRefs/);
  for (const bound of [
    "<=8000",
    "<=256",
    "<=512",
    "<=64",
    "<=128",
    "<=2048",
    "<=16000",
    "<=24"
  ]) {
    assert.match(complete.inputShape, new RegExp(bound.replace("<", "\\<")));
  }
  assert.ok(complete.notes.some((note) => /SHA-256/.test(note)));
  assert.ok(complete.notes.some((note) => /exact same terminal/i.test(note)));
  assert.ok(complete.notes.some((note) => /deferred/i.test(note)));
  assert.doesNotMatch(release.inputShape, /completionReport|gitRefs/);
  assert.ok(
    release.notes.some((note) => /never accepts completionReport/.test(note))
  );

  await withIsolatedForge(async (app) => {
    const cookie = issueTestOperatorSessionCookie(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding",
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      onboarding: {
        entityRouteModel: {
          actionEntities: {
            task_run: { notes: string[] };
          };
        };
      };
    };
    const notes =
      body.onboarding.entityRouteModel.actionEntities.task_run.notes;
    assert.ok(notes.some((note) => /linkedGitRefId/.test(note)));
    assert.ok(notes.some((note) => /SHA-256/.test(note)));
    assert.ok(notes.some((note) => /truthfully deferred/.test(note)));
    assert.ok(
      notes.some((note) => /Release accepts only handoff note/.test(note))
    );

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { cookie }
    });
    assert.equal(openApiResponse.statusCode, 200, openApiResponse.body);
    const openApi = openApiResponse.json() as {
      components: {
        schemas: Record<
          string,
          {
            required?: string[];
            properties?: Record<string, { description?: string }>;
          }
        >;
      };
      paths: Record<
        string,
        Record<string, { description?: string } | undefined>
      >;
    };
    assert.ok(
      openApi.components.schemas.Note?.required?.includes(
        "unavailableLinkCount"
      )
    );
    assert.match(
      openApi.components.schemas.Note?.properties?.links?.description ?? "",
      /Only live linked targets accessible/
    );
    assert.match(
      JSON.stringify(
        openApi.components.schemas.WorkItemGitRef?.properties?.rawUrl ?? {}
      ),
      /Unsafe legacy values are redacted to null/
    );
    assert.match(
      openApi.paths["/api/v1/task-runs/{id}/complete"]?.post?.description ?? "",
      /resolved before present-day linked-record validation/
    );
  });
});
