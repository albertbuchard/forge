import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import type { AuthContext } from "../managers/contracts.js";
import type { AuthorizationManager } from "../managers/platform/authorization-manager.js";
import type { LlmManager } from "../managers/platform/llm-manager.js";
import {
  buildAutomaticMultipleChoiceFeedback,
  completeCourseAttempt,
  createCourseAttempt,
  createVoiceLearningSession,
  exportCoursePackage,
  getActivityForAssessment,
  getCourseAttemptResult,
  getConceptDetail,
  getCourseDetail,
  getLearningSession,
  importCoursePackage,
  listConcepts,
  listCourses,
  upgradeCourseEnrollment
} from "../repositories/courses.js";
import { getDefaultUser } from "../repositories/users.js";
import { assessCourseResponse } from "../services/course-assessment.js";

type CourseRouteDependencies = {
  authenticate(headers: Record<string, unknown>): AuthContext;
  authorization: AuthorizationManager;
  llm: Pick<LlmManager, "runTextPrompt">;
};

const userQuerySchema = z.object({
  userId: z.string().trim().min(1).max(160).optional()
});

const learnQuerySchema = userQuerySchema.extend({
  lessonId: z.string().trim().min(1).max(160).optional()
});

const conceptListQuerySchema = userQuerySchema.extend({
  courseId: z.string().trim().min(1).max(160).optional(),
  query: z.string().trim().max(200).optional(),
  dueOnly: z.enum(["true", "false"]).optional()
});

const attemptBodySchema = z
  .object({
    userId: z.string().trim().min(1).max(160).optional(),
    answerMarkdown: z.string().trim().min(1).max(60_000),
    deliveryMode: z.enum(["visual", "voice"]).default("visual"),
    voiceSessionToken: z.string().uuid().optional(),
    voiceConfirmation: z.literal(true).optional(),
    idempotencyKey: z.string().trim().min(8).max(160).optional()
  })
  .strict()
  .superRefine((body, context) => {
    if (
      body.deliveryMode === "voice" &&
      (!body.voiceSessionToken ||
        body.voiceConfirmation !== true ||
        !body.idempotencyKey)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Voice submissions require a current voiceSessionToken, Albert's confirmation, and an idempotencyKey."
      });
    }
    if (
      body.deliveryMode === "visual" &&
      (body.voiceSessionToken || body.voiceConfirmation)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Voice session fields may only be used when deliveryMode is voice."
      });
    }
  });

const voiceSessionBodySchema = z
  .object({
    userId: z.string().trim().min(1).max(160).optional(),
    week: z.number().int().min(1).max(500),
    day: z.number().int().min(1).max(31)
  })
  .strict();

const attemptRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["answerMarkdown"],
    properties: {
      userId: { type: "string", minLength: 1, maxLength: 160 },
      answerMarkdown: { type: "string", minLength: 1, maxLength: 60_000 },
      deliveryMode: { type: "string", enum: ["visual", "voice"] },
      voiceSessionToken: { type: "string", format: "uuid" },
      voiceConfirmation: { type: "boolean", const: true },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 160 }
    }
  },
  response: {
    200: { $ref: "courseAttemptResult#" },
    201: { $ref: "courseAttemptResult#" },
    202: { $ref: "courseAttemptResult#" }
  }
} as const;

const voiceSessionRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["week", "day"],
    properties: {
      userId: { type: "string", minLength: 1, maxLength: 160 },
      week: { type: "integer", minimum: 1, maximum: 500 },
      day: { type: "integer", minimum: 1, maximum: 31 }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["outline", "session", "voice"],
      properties: {
        outline: { type: "object", additionalProperties: true },
        session: { type: "object", additionalProperties: true },
        voice: {
          type: "object",
          additionalProperties: false,
          required: [
            "token",
            "expiresAt",
            "lessonId",
            "deliveryPolicy"
          ],
          properties: {
            token: { type: "string", format: "uuid" },
            expiresAt: { type: "string", format: "date-time" },
            lessonId: { type: "string" },
            deliveryPolicy: {
              type: "object",
              additionalProperties: false,
              required: [
                "contentOrder",
                "disclosure",
                "answerFormatting",
                "confirmation",
                "persistence"
              ],
              properties: {
                contentOrder: { type: "string", const: "source_order" },
                disclosure: {
                  type: "string",
                  const: "one_block_or_activity_at_a_time"
                },
                answerFormatting: { type: "string" },
                confirmation: { type: "string" },
                persistence: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
} as const;

function rejectUnknownBodyFields(
  body: unknown,
  allowedFields: ReadonlySet<string>,
  code: string
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const unknownFields = Object.keys(body).filter(
    (field) => !allowedFields.has(field)
  );
  if (unknownFields.length > 0) {
    throw new HttpError(
      400,
      code,
      `Unsupported request fields: ${unknownFields.join(", ")}.`
    );
  }
}

function resolveUserId(auth: AuthContext, requested?: string) {
  const fallback = getDefaultUser().id;
  if (auth.session) return requested ?? fallback;
  const allowed = auth.token?.scopePolicy.userIds ?? [];
  const resolved = requested ?? allowed[0] ?? fallback;
  if (allowed.length > 0 && !allowed.includes(resolved)) {
    throw new HttpError(
      403,
      "course_user_scope_denied",
      "The requested learner is outside this token's user scope."
    );
  }
  return resolved;
}

function requireRead(
  deps: CourseRouteDependencies,
  headers: Record<string, unknown>
) {
  const auth = deps.authenticate(headers);
  deps.authorization.requireAuthenticatedActor(auth, {
    routeFamily: "courses"
  });
  deps.authorization.requireAnyTokenScope(auth, ["read", "write"], {
    routeFamily: "courses"
  });
  return auth;
}

function requireWrite(
  deps: CourseRouteDependencies,
  headers: Record<string, unknown>
) {
  const auth = deps.authenticate(headers);
  deps.authorization.requireAuthenticatedActor(auth, {
    routeFamily: "courses"
  });
  deps.authorization.requireAnyTokenScope(auth, ["write"], {
    routeFamily: "courses"
  });
  return auth;
}

export async function registerCourseRoutes(
  app: FastifyInstance,
  deps: CourseRouteDependencies
) {
  app.addSchema({
    $id: "courseAttemptResult",
    type: "object",
    additionalProperties: false,
    required: [
      "attemptId",
      "status",
      "score",
      "grade",
      "pointsAwarded",
      "feedback",
      "deliveryMode",
      "lessonAttemptOrdinal",
      "activityAttemptOrdinal",
      "progress",
      "nextLessonId"
    ],
    properties: {
      attemptId: { type: "string" },
      status: {
        type: "string",
        enum: ["assessing", "assessed", "needs_review"]
      },
      score: { anyOf: [{ type: "number" }, { type: "null" }] },
      grade: { anyOf: [{ type: "string" }, { type: "null" }] },
      pointsAwarded: { type: "integer" },
      feedback: {
        anyOf: [
          { type: "object", additionalProperties: true },
          { type: "null" }
        ]
      },
      deliveryMode: { type: "string", enum: ["visual", "voice"] },
      lessonAttemptOrdinal: { type: "integer", minimum: 1 },
      activityAttemptOrdinal: { type: "integer", minimum: 1 },
      progress: { type: "object", additionalProperties: true },
      nextLessonId: {
        anyOf: [{ type: "string" }, { type: "null" }]
      }
    }
  });

  app.get("/api/v1/courses", async (request) => {
    const auth = requireRead(deps, request.headers as Record<string, unknown>);
    const query = userQuerySchema.parse(request.query ?? {});
    return { courses: listCourses(resolveUserId(auth, query.userId)) };
  });

  app.post(
    "/api/v1/courses/import",
    { bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      requireWrite(deps, request.headers as Record<string, unknown>);
      const result = importCoursePackage(request.body ?? {});
      reply.code(201);
      return result;
    }
  );

  app.get("/api/v1/courses/:courseId/export", async (request, reply) => {
    requireRead(deps, request.headers as Record<string, unknown>);
    const params = z
      .object({ courseId: z.string().trim().min(1).max(160) })
      .parse(request.params);
    const coursePackage = exportCoursePackage(params.courseId);
    reply.header(
      "Content-Type",
      "application/vnd.forge.course+json; charset=utf-8"
    );
    reply.header(
      "Content-Disposition",
      `attachment; filename="${coursePackage.course.slug}.forge-course.json"`
    );
    return coursePackage;
  });

  app.post("/api/v1/courses/:courseId/upgrade", async (request) => {
    const auth = requireWrite(
      deps,
      request.headers as Record<string, unknown>
    );
    const params = z
      .object({ courseId: z.string().trim().min(1).max(160) })
      .parse(request.params);
    const body = userQuerySchema.parse(request.body ?? {});
    return upgradeCourseEnrollment(
      params.courseId,
      resolveUserId(auth, body.userId)
    );
  });

  app.get("/api/v1/courses/:courseId", async (request) => {
    const auth = requireRead(deps, request.headers as Record<string, unknown>);
    const params = z
      .object({ courseId: z.string().trim().min(1).max(160) })
      .parse(request.params);
    const query = userQuerySchema.parse(request.query ?? {});
    return getCourseDetail(params.courseId, resolveUserId(auth, query.userId));
  });

  app.get("/api/v1/courses/:courseId/learn", async (request) => {
    const auth = requireRead(deps, request.headers as Record<string, unknown>);
    const params = z
      .object({ courseId: z.string().trim().min(1).max(160) })
      .parse(request.params);
    const query = learnQuerySchema.parse(request.query ?? {});
    return getLearningSession(
      params.courseId,
      resolveUserId(auth, query.userId),
      query.lessonId
    );
  });

  app.post(
    "/api/v1/courses/:courseId/voice-session",
    {
      schema: voiceSessionRouteSchema,
      preValidation: async (request) => {
        rejectUnknownBodyFields(
          request.body,
          new Set(["userId", "week", "day"]),
          "course_voice_session_unknown_field"
        );
      }
    },
    async (request) => {
      const auth = requireWrite(
        deps,
        request.headers as Record<string, unknown>
      );
      const params = z
        .object({ courseId: z.string().trim().min(1).max(160) })
        .parse(request.params);
      const body = voiceSessionBodySchema.parse(request.body ?? {});
      return createVoiceLearningSession({
        courseId: params.courseId,
        userId: resolveUserId(auth, body.userId),
        week: body.week,
        day: body.day
      });
    }
  );

  app.post(
    "/api/v1/courses/:courseId/lessons/:lessonId/activities/:activityId/attempts",
    {
      schema: attemptRouteSchema,
      preValidation: async (request) => {
        rejectUnknownBodyFields(
          request.body,
          new Set([
            "userId",
            "answerMarkdown",
            "deliveryMode",
            "voiceSessionToken",
            "voiceConfirmation",
            "idempotencyKey"
          ]),
          "course_attempt_unknown_field"
        );
      }
    },
    async (request, reply) => {
      const auth = requireWrite(
        deps,
        request.headers as Record<string, unknown>
      );
      const params = z
        .object({
          courseId: z.string().trim().min(1).max(160),
          lessonId: z.string().trim().min(1).max(160),
          activityId: z.string().trim().min(1).max(160)
        })
        .parse(request.params);
      const body = attemptBodySchema.parse(request.body ?? {});
      const userId = resolveUserId(auth, body.userId);
      const attempt = createCourseAttempt({
        ...params,
        userId,
        answerMarkdown: body.answerMarkdown,
        deliveryMode: body.deliveryMode,
        voiceSessionToken: body.voiceSessionToken,
        idempotencyKey: body.idempotencyKey
      });
      if (attempt.existing) {
        const result = getCourseAttemptResult(attempt.attemptId, userId);
        reply.code(result.status === "assessing" ? 202 : 200);
        return result;
      }
      const assessmentContext = getActivityForAssessment(
        params.courseId,
        params.lessonId,
        params.activityId,
        userId
      );
      const assessment =
        assessmentContext.activity.type === "multiple_choice"
          ? {
              feedback: buildAutomaticMultipleChoiceFeedback(
                assessmentContext.activity,
                body.answerMarkdown,
                assessmentContext.gradeScale
              ),
              provider: "forge-deterministic",
              model: "multiple-choice-v1"
            }
          : await assessCourseResponse(deps.llm, {
              courseTitle: assessmentContext.course.title,
              lessonTitle: assessmentContext.lesson.title,
              activity: assessmentContext.activity,
              concepts: assessmentContext.concepts,
              answerMarkdown: body.answerMarkdown,
              gradeScale: assessmentContext.gradeScale,
              allowedMisconceptionIds: assessmentContext.allowedMisconceptionIds
            });
      const result = completeCourseAttempt({
        attemptId: attempt.attemptId,
        userId,
        activity: assessmentContext.activity,
        feedback: assessment.feedback,
        provider: assessment.provider,
        model: assessment.model,
        nextLessonId: assessmentContext.nextLessonId
      });
      reply.code(201);
      return result;
    }
  );

  app.get("/api/v1/concepts", async (request) => {
    const auth = requireRead(deps, request.headers as Record<string, unknown>);
    const query = conceptListQuerySchema.parse(request.query ?? {});
    return {
      concepts: listConcepts(resolveUserId(auth, query.userId), {
        courseId: query.courseId,
        query: query.query,
        dueOnly: query.dueOnly === "true"
      })
    };
  });

  app.get("/api/v1/concepts/:conceptId", async (request) => {
    const auth = requireRead(deps, request.headers as Record<string, unknown>);
    const params = z
      .object({ conceptId: z.string().trim().min(1).max(160) })
      .parse(request.params);
    const query = userQuerySchema.parse(request.query ?? {});
    return getConceptDetail(
      params.conceptId,
      resolveUserId(auth, query.userId)
    );
  });
}
