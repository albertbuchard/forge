import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { COURSE_PACKAGE_LIMITS } from "../../../packages/course-kit/src/index.js";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createAgentToken } from "./repositories/settings.js";
import { getDefaultUser } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { createAgentTokenSchema } from "./types.js";

function oversizedCoursePackage() {
  const lessonCount =
    Math.floor(
      COURSE_PACKAGE_LIMITS.totalActivities /
        COURSE_PACKAGE_LIMITS.lessonActivities
    ) + 1;
  const lessons = Array.from({ length: lessonCount }, (_, lessonIndex) => ({
    id: `lesson.${lessonIndex + 1}`,
    moduleId: "module.one",
    week: 1,
    day: (lessonIndex % 14) + 1,
    order: lessonIndex,
    title: `Lesson ${lessonIndex + 1}`,
    summary: "A bounded transfer fixture.",
    estimatedMinutes: 30,
    conceptIds: ["concept.one"],
    objectives: ["Verify the transfer boundary."],
    content: [{ type: "markdown" as const, markdown: "Bounded content." }],
    activities: Array.from(
      { length: COURSE_PACKAGE_LIMITS.lessonActivities },
      (_, activityIndex) => ({
        id: `activity.${lessonIndex + 1}.${activityIndex + 1}`,
        type: "recall" as const,
        title: `Activity ${activityIndex + 1}`,
        promptMarkdown: "Recall the bounded concept.",
        conceptIds: ["concept.one"],
        points: 1,
        estimatedMinutes: 1
      })
    )
  }));
  return {
    schemaVersion: "1.1" as const,
    course: {
      id: "course.learn-04-oversized",
      slug: "learn-04-oversized",
      version: "1.0.0",
      title: "LEARN-04 oversized fixture",
      description: "A compact package with excessive database fan-out.",
      authors: ["Forge"],
      license: "CC0-1.0",
      estimatedWeeks: 1,
      minutesPerWeek: 30,
      entryLessonId: lessons[0]!.id
    },
    concepts: [
      {
        id: "concept.one",
        slug: "concept-one",
        title: "Concept one",
        summary: "The bounded concept.",
        definitionMarkdown: "A bounded definition."
      }
    ],
    modules: [
      {
        id: "module.one",
        title: "Module one",
        description: "A bounded module.",
        order: 0,
        startWeek: 1,
        endWeek: 1,
        lessonIds: lessons.map((lesson) => lesson.id)
      }
    ],
    lessons,
    provenance: {
      generatedAt: "2026-08-12T00:00:00.000Z",
      contentHash: "",
      notes: "LEARN-04 bounded import fixture."
    }
  };
}

test("LEARN-04 keeps canonical course transfer behind the operator session", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-learn-04-readiness-")
  );
  const app = await buildServer({ dataRoot, seedDemoData: false });
  try {
    const operatorHeaders = {
      host: "127.0.0.1:4317",
      cookie: await issueTestOperatorSessionCookie(app)
    };
    const owner = getDefaultUser();
    const token = createAgentToken(
      createAgentTokenSchema.parse({
        label: "Course transfer boundary",
        agentLabel: "Course transfer boundary",
        scopes: ["read", "write"],
        scopePolicy: {
          userIds: [owner.id],
          projectIds: [],
          tagIds: []
        }
      }),
      { actor: "LEARN-04 test", source: "system" }
    ).token;
    const tokenHeaders = { authorization: `Bearer ${token}` };
    const courseId = "course.polynomials-etale-triple-covers";

    const exported = await app.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}/export`,
      headers: operatorHeaders
    });
    assert.equal(exported.statusCode, 200, exported.body);
    const coursePackage = exported.json();
    assert.equal(
      JSON.stringify(coursePackage).includes("referenceAnswerMarkdown"),
      true,
      "the operator package contains private assessment definitions"
    );

    const existingDenied = await app.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}/export`,
      headers: tokenHeaders
    });
    const missingDenied = await app.inject({
      method: "GET",
      url: "/api/v1/courses/course-that-does-not-exist/export",
      headers: tokenHeaders
    });
    assert.equal(existingDenied.statusCode, 403, existingDenied.body);
    assert.equal(missingDenied.statusCode, existingDenied.statusCode);
    assert.deepEqual(missingDenied.json(), existingDenied.json());

    const before = (
      getDatabase().prepare("SELECT COUNT(*) AS count FROM courses").get() as {
        count: number;
      }
    ).count;
    const importDenied = await app.inject({
      method: "POST",
      url: "/api/v1/courses/import",
      headers: tokenHeaders,
      payload: coursePackage
    });
    assert.equal(importDenied.statusCode, 403, importDenied.body);
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM courses")
          .get() as { count: number }
      ).count,
      before
    );

    const oversizedImport = await app.inject({
      method: "POST",
      url: "/api/v1/courses/import",
      headers: operatorHeaders,
      payload: oversizedCoursePackage()
    });
    assert.equal(oversizedImport.statusCode, 400, oversizedImport.body);
    assert.match(
      oversizedImport.body,
      new RegExp(
        `at most ${COURSE_PACKAGE_LIMITS.totalActivities} activities`,
        "u"
      )
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM courses")
          .get() as { count: number }
      ).count,
      before,
      "an oversized package must be rejected before any course row is written"
    );

    const operatorImport = await app.inject({
      method: "POST",
      url: "/api/v1/courses/import",
      headers: operatorHeaders,
      payload: coursePackage
    });
    assert.equal(operatorImport.statusCode, 201, operatorImport.body);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
