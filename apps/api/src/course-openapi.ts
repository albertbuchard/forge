const jsonContent = (schema: Record<string, unknown>) => ({
  "application/json": { schema }
});

const errorResponse = {
  description: "Forge error response",
  content: jsonContent({ $ref: "#/components/schemas/ErrorResponse" })
};

const userIdParameter = {
  name: "userId",
  in: "query",
  required: false,
  schema: { type: "string", maxLength: 160 }
};

const courseIdParameter = {
  name: "courseId",
  in: "path",
  required: true,
  schema: { type: "string", maxLength: 160 }
};

const conceptIdParameter = {
  name: "conceptId",
  in: "path",
  required: true,
  schema: { type: "string", maxLength: 160 }
};

const packageSchema = {
  type: "object",
  required: ["schemaVersion", "course", "modules", "lessons", "provenance"],
  additionalProperties: true,
  properties: {
    schemaVersion: { type: "string", enum: ["1.0"] },
    course: { type: "object", additionalProperties: true },
    presentation: { type: "object", additionalProperties: true },
    grading: { type: "object", additionalProperties: true },
    concepts: { type: "array", items: { type: "object" } },
    conceptRefs: { type: "array", items: { type: "object" } },
    modules: { type: "array", items: { type: "object" } },
    lessons: { type: "array", items: { type: "object" } },
    provenance: { type: "object", additionalProperties: true }
  }
};

export function buildCourseOpenApiPaths(): Record<string, unknown> {
  return {
    "/api/v1/courses": {
      get: {
        summary: "List installed courses and learner progress",
        tags: ["Courses"],
        parameters: [userIdParameter],
        responses: {
          "200": {
            description: "Installed courses",
            content: jsonContent({
              type: "object",
              required: ["courses"],
              properties: {
                courses: { type: "array", items: { type: "object" } }
              }
            })
          },
          "403": errorResponse
        }
      }
    },
    "/api/v1/courses/import": {
      post: {
        summary: "Validate and import a Forge course package",
        description:
          "Verifies package references and the canonical SHA-256 hash. Conflicting concept definitions and mutation of a course with learner evidence are rejected.",
        tags: ["Courses"],
        requestBody: {
          required: true,
          content: jsonContent(packageSchema)
        },
        responses: {
          "201": {
            description: "Imported course and entity counts",
            content: jsonContent({ type: "object" })
          },
          "409": errorResponse,
          "422": errorResponse
        }
      }
    },
    "/api/v1/courses/{courseId}/export": {
      get: {
        summary: "Export the canonical validated Forge course package",
        tags: ["Courses"],
        parameters: [courseIdParameter],
        responses: {
          "200": {
            description: "Portable Forge course package",
            content: {
              "application/vnd.forge.course+json": { schema: packageSchema },
              "application/json": { schema: packageSchema }
            }
          },
          "404": errorResponse,
          "500": errorResponse
        }
      }
    },
    "/api/v1/courses/{courseId}": {
      get: {
        summary: "Read a course syllabus, concepts, and learner progress",
        tags: ["Courses"],
        parameters: [courseIdParameter, userIdParameter],
        responses: {
          "200": {
            description: "Course detail",
            content: jsonContent({ type: "object" })
          },
          "404": errorResponse
        }
      }
    },
    "/api/v1/courses/{courseId}/learn": {
      get: {
        summary: "Read a learner-safe immersive lesson session",
        description:
          "Instructor references, correct option ids, answer explanations, and extension assessment data are removed before serialization.",
        tags: ["Courses"],
        parameters: [
          courseIdParameter,
          userIdParameter,
          {
            name: "lessonId",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 160 }
          }
        ],
        responses: {
          "200": {
            description: "Learner-safe lesson session",
            content: jsonContent({ type: "object" })
          },
          "404": errorResponse
        }
      }
    },
    "/api/v1/courses/{courseId}/lessons/{lessonId}/activities/{activityId}/attempts":
      {
        post: {
          summary: "Submit and assess one course activity attempt",
          description:
            "Deterministic activities are graded locally. Written mathematics uses the configured Forge model and withholds the grade when structured assessment is unavailable.",
          tags: ["Courses"],
          parameters: [
            courseIdParameter,
            {
              name: "lessonId",
              in: "path",
              required: true,
              schema: { type: "string", maxLength: 160 }
            },
            {
              name: "activityId",
              in: "path",
              required: true,
              schema: { type: "string", maxLength: 160 }
            }
          ],
          requestBody: {
            required: true,
            content: jsonContent({
              type: "object",
              required: ["answerMarkdown"],
              properties: {
                userId: { type: "string", maxLength: 160 },
                answerMarkdown: {
                  type: "string",
                  minLength: 1,
                  maxLength: 60000
                }
              }
            })
          },
          responses: {
            "201": {
              description: "Saved attempt and structured assessment",
              content: jsonContent({ type: "object" })
            },
            "404": errorResponse,
            "409": errorResponse
          }
        }
      },
    "/api/v1/concepts": {
      get: {
        summary: "List first-class concepts and learner mastery",
        tags: ["Concepts"],
        parameters: [
          userIdParameter,
          {
            name: "courseId",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 160 }
          },
          {
            name: "query",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 200 }
          },
          {
            name: "dueOnly",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["true", "false"] }
          }
        ],
        responses: {
          "200": {
            description: "Concept entities and mastery dimensions",
            content: jsonContent({
              type: "object",
              required: ["concepts"],
              properties: {
                concepts: { type: "array", items: { type: "object" } }
              }
            })
          }
        }
      }
    },
    "/api/v1/concepts/{conceptId}": {
      get: {
        summary: "Read a concept entity and its cross-course evidence",
        tags: ["Concepts"],
        parameters: [conceptIdParameter, userIdParameter],
        responses: {
          "200": {
            description: "Concept detail",
            content: jsonContent({ type: "object" })
          },
          "404": errorResponse
        }
      }
    }
  };
}
