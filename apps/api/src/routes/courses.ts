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
  exportCoursePackage,
  getActivityForAssessment,
  getConceptDetail,
  getCourseDetail,
  getLearningSession,
  importCoursePackage,
  listConcepts,
  listCourses
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

const attemptBodySchema = z.object({
  userId: z.string().trim().min(1).max(160).optional(),
  answerMarkdown: z.string().trim().min(1).max(60_000)
});

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
    "/api/v1/courses/:courseId/lessons/:lessonId/activities/:activityId/attempts",
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
      const assessmentContext = getActivityForAssessment(
        params.courseId,
        params.lessonId,
        params.activityId
      );
      const attempt = createCourseAttempt({
        ...params,
        userId,
        answerMarkdown: body.answerMarkdown
      });
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
