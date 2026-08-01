import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { buildCourseOpenApiPaths } from "./course-openapi.js";
import { closeDatabase } from "./db.js";

const operatorCookie = issueTestOperatorSessionCookie;

test("course OpenAPI documents open lesson navigation without a lock response", () => {
  const paths = buildCourseOpenApiPaths() as {
    "/api/v1/courses/{courseId}/learn": {
      get: { description: string; responses: Record<string, unknown> };
    };
  };
  const operation = paths["/api/v1/courses/{courseId}/learn"].get;
  assert.equal(operation.responses["409"], undefined);
  assert.match(
    operation.description,
    /Every published lesson and section is available in any order/u
  );
});

test("course routes expose a learner-safe voice session without locking later lessons", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-course-route-test-")
  );
  const app = await buildServer({ dataRoot, seedDemoData: false });
  try {
    const cookie = await operatorCookie(app);
    const headers = {
      host: "127.0.0.1:4317",
      cookie
    };
    const catalogResponse = await app.inject({
      method: "GET",
      url: "/api/v1/courses",
      headers
    });
    assert.equal(catalogResponse.statusCode, 200);
    const catalog = catalogResponse.json() as {
      courses: Array<{ id: string; version: string }>;
    };
    assert.deepEqual(
      catalog.courses
        .map((course) => [course.id, course.version])
        .sort((left, right) => left[0].localeCompare(right[0])),
      [
        ["course.cpge-mathematics-concours-fluency", "1.8.0"],
        ["course.polynomials-etale-triple-covers", "3.1.0"]
      ]
    );

    const voiceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/courses/course.polynomials-etale-triple-covers/voice-session",
      headers,
      payload: { week: 1, day: 1 }
    });
    assert.equal(voiceResponse.statusCode, 200);
    const voice = voiceResponse.json() as {
      outline: { lessons: Array<{ unlocked: boolean }> };
      session: {
        flow: {
          blockedByActivityId: string | null;
          submittableActivityIds: string[];
        };
        lesson: {
          id: string;
          content: unknown[];
          activities: Array<{ id: string }>;
        };
      };
      voice: {
        token: string;
        lessonId: string;
        deliveryPolicy: { disclosure: string; persistence: string };
      };
    };
    assert.equal(voice.voice.lessonId, voice.session.lesson.id);
    assert.equal(voice.session.flow.blockedByActivityId, null);
    assert.ok(voice.session.flow.submittableActivityIds.length > 1);
    assert.ok(voice.session.lesson.activities.length > 1);
    assert.equal(
      voice.voice.deliveryPolicy.disclosure,
      "one_block_or_activity_at_a_time"
    );
    assert.match(
      voice.voice.deliveryPolicy.persistence,
      /Do not submit or store audio/u
    );
    assert.equal(voice.outline.lessons[0]?.unlocked, true);
    assert.equal(voice.outline.lessons[1]?.unlocked, true);
    const learnerPayload = JSON.stringify(voice.session);
    assert.doesNotMatch(learnerPayload, /referenceAnswerMarkdown/u);
    assert.doesNotMatch(learnerPayload, /correctOptionIds/u);

    const futureResponse = await app.inject({
      method: "GET",
      url: "/api/v1/courses/course.polynomials-etale-triple-covers/learn?lessonId=term-0-week-1-day-2",
      headers
    });
    assert.equal(futureResponse.statusCode, 200);
    assert.equal(
      (futureResponse.json() as { lesson: { id: string } }).lesson.id,
      "term-0-week-1-day-2"
    );

    const unknownVoiceField = await app.inject({
      method: "POST",
      url: "/api/v1/courses/course.polynomials-etale-triple-covers/lessons/term-0-week-1-day-1/activities/term-0-week-1-day-1-function-data/attempts",
      headers,
      payload: {
        answerMarkdown: "A confirmed answer.",
        deliveryMode: "voice",
        voiceSessionToken: voice.voice.token,
        voiceConfirmation: true,
        idempotencyKey: "voice-route-test-answer-1",
        audio: "must-not-be-accepted"
      }
    });
    assert.equal(unknownVoiceField.statusCode, 400);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
