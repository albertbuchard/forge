import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function readForgeJson(rootDir: string) {
  return JSON.parse(
    await readFile(path.join(rootDir, "forge.json"), "utf8")
  ) as Record<string, unknown>;
}

test("startup exports forge.json when the runtime settings file is missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-settings-file-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const filePath = path.join(rootDir, "forge.json");
    await access(filePath);
    const payload = await readForgeJson(rootDir);
    assert.equal(payload.themePreference, "obsidian");
    assert.equal(
      (payload.execution as { maxActiveTasks: number }).maxActiveTasks,
      2
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("forge.json overrides writable settings and is rewritten as a full snapshot", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-settings-file-override-")
  );
  await writeFile(
    path.join(rootDir, "forge.json"),
    `${JSON.stringify(
      {
        profile: {
          operatorName: "File Operator"
        },
        execution: {
          maxActiveTasks: 4,
          timeAccountingMode: "parallel"
        },
        themePreference: "solar"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      settings: {
        themePreference: string;
        profile: { operatorName: string; operatorEmail: string };
        execution: { maxActiveTasks: number; timeAccountingMode: string };
        security: { integrityScore: number };
      };
    };
    assert.equal(body.settings.themePreference, "solar");
    assert.equal(body.settings.profile.operatorName, "File Operator");
    assert.equal(body.settings.execution.maxActiveTasks, 4);
    assert.equal(body.settings.execution.timeAccountingMode, "parallel");

    const filePayload = await readForgeJson(rootDir);
    assert.equal(filePayload.themePreference, "solar");
    assert.equal(
      (
        filePayload.profile as {
          operatorName: string;
          operatorEmail: string;
        }
      ).operatorName,
      "File Operator"
    );
    assert.equal(
      (
        filePayload.execution as {
          maxActiveTasks: number;
          timeAccountingMode: string;
        }
      ).maxActiveTasks,
      4
    );
    assert.equal(
      typeof (filePayload.security as { integrityScore: number })
        .integrityScore,
      "number"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("settings API writes forge.json after UI-style updates and token mutations", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-settings-file-mirror-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        themePreference: "paper",
        localePreference: "fr",
        execution: {
          maxActiveTasks: 5,
          timeAccountingMode: "primary_only"
        }
      }
    });
    assert.equal(updateResponse.statusCode, 200);

    let filePayload = await readForgeJson(rootDir);
    assert.equal(filePayload.themePreference, "paper");
    assert.equal(filePayload.localePreference, "fr");
    assert.equal(
      (
        filePayload.execution as {
          maxActiveTasks: number;
          timeAccountingMode: string;
        }
      ).timeAccountingMode,
      "primary_only"
    );

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Mirror test token",
        scopes: ["read", "write"]
      }
    });
    assert.equal(tokenResponse.statusCode, 201);

    filePayload = await readForgeJson(rootDir);
    assert.equal(
      Array.isArray(
        (filePayload.agentTokens as Array<{ label: string }> | undefined) ?? []
      ),
      true
    );
    assert.equal(
      ((filePayload.agentTokens as Array<{ label: string }> | undefined) ?? [])
        .length,
      1
    );
    assert.equal(
      ((filePayload.agentTokens as Array<{ label: string }> | undefined) ??
        [])[0]?.label,
      "Mirror test token"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("doctor reports invalid forge.json files and keeps the database-backed settings active", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-settings-file-invalid-")
  );
  await writeFile(
    path.join(rootDir, "forge.json"),
    "{not valid json\n",
    "utf8"
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const settingsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(settingsResponse.statusCode, 200);
    assert.equal(
      (settingsResponse.json() as { settings: { themePreference: string } })
        .settings.themePreference,
      "obsidian"
    );

    const doctorResponse = await app.inject({
      method: "GET",
      url: "/api/v1/doctor",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(doctorResponse.statusCode, 200);
    const doctorBody = doctorResponse.json() as {
      doctor: {
        ok: boolean;
        settingsFile: {
          path: string;
          exists: boolean;
          valid: boolean;
          syncState: string;
          parseError: string | null;
        };
        warnings: string[];
      };
    };
    assert.equal(doctorBody.doctor.ok, false);
    assert.equal(doctorBody.doctor.settingsFile.exists, true);
    assert.equal(doctorBody.doctor.settingsFile.valid, false);
    assert.equal(doctorBody.doctor.settingsFile.syncState, "invalid");
    assert.match(doctorBody.doctor.settingsFile.path, /forge\.json$/);
    assert.ok(doctorBody.doctor.settingsFile.parseError);
    assert.ok(
      doctorBody.doctor.warnings.some((warning) =>
        warning.includes("forge.json is invalid")
      )
    );
    assert.ok(
      (doctorBody.doctor as { issues: Array<{ id: string; summary: string }> })
        .issues.some((issue) => issue.id === "settings.file.valid")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("doctor exposes explicit integrity details and safe fix application", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-doctor-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const doctorResponse = await app.inject({
      method: "GET",
      url: "/api/v1/doctor",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(doctorResponse.statusCode, 200);
    const doctorBody = doctorResponse.json() as {
      doctor: {
        integrity: { score: number; headline: string };
        checks: Array<{ id: string; status: string }>;
        fixProposals: Array<{ id: string; kind: string }>;
      };
    };
    assert.equal(typeof doctorBody.doctor.integrity.score, "number");
    assert.match(doctorBody.doctor.integrity.headline, /Doctor|consistency/i);
    assert.ok(
      doctorBody.doctor.checks.some(
        (check) => check.id === "storage.sqlite.integrity"
      )
    );
    assert.ok(
      doctorBody.doctor.fixProposals.some(
        (fix) => fix.id === "settings.integrity.refresh"
      )
    );

    getDatabase()
      .prepare("UPDATE app_settings SET integrity_score = 98 WHERE id = 1")
      .run();
    const fixResponse = await app.inject({
      method: "POST",
      url: "/api/v1/doctor/fixes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        fixIds: ["settings.integrity.refresh"]
      }
    });
    assert.equal(fixResponse.statusCode, 200);
    const fixBody = fixResponse.json() as {
      results: Array<{ fixId: string; status: string }>;
    };
    assert.deepEqual(fixBody.results[0], {
      fixId: "settings.integrity.refresh",
      status: "applied",
      summary: "Stored Settings integrity audit timestamp was refreshed."
    });
    const settingsRow = getDatabase()
      .prepare("SELECT integrity_score AS score FROM app_settings WHERE id = 1")
      .get() as { score: number };
    assert.equal(settingsRow.score, 100);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
