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
    schemaVersion: { type: "string", enum: ["1.0", "1.1"] },
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
          "Verifies package references and the canonical SHA-256 hash. Course releases are immutable; importing a new version preserves versioned enrollments and exact activity snapshots.",
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
    "/api/v1/courses/{courseId}/upgrade": {
      post: {
        summary: "Move one enrollment to the latest immutable course release",
        description:
          "Carries only passed activities whose exact assessment definition is unchanged. Returns the carried and remaining activity identifiers as an audit receipt.",
        tags: ["Courses"],
        parameters: [courseIdParameter],
        requestBody: {
          required: false,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            properties: {
              userId: { type: "string", maxLength: 160 }
            }
          })
        },
        responses: {
          "200": {
            description: "Versioned enrollment upgrade receipt",
            content: jsonContent({ type: "object" })
          },
          "404": errorResponse,
          "409": errorResponse
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
          "Every published lesson and section is available in any order. Forge reports incomplete earlier work as guidance while removing instructor references, correct option ids, answer explanations, and extension assessment data before serialization.",
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
    "/api/v1/courses/{courseId}/voice-session": {
      post: {
        summary: "Start a privacy-safe voice-guided lesson session",
        description:
          "Returns the full course outline, one learner-safe week/day lesson, an expiring lesson-scoped token, and a source-order delivery policy. The session stores no audio or transcript.",
        tags: ["Courses"],
        parameters: [courseIdParameter],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["week", "day"],
            properties: {
              userId: { type: "string", maxLength: 160 },
              week: { type: "integer", minimum: 1, maximum: 500 },
              day: { type: "integer", minimum: 1, maximum: 31 }
            }
          })
        },
        responses: {
          "200": {
            description:
              "Course outline, learner-safe lesson session, and expiring voice scope",
            content: jsonContent({
              type: "object",
              additionalProperties: false,
              required: ["outline", "session", "voice"],
              properties: {
                outline: { type: "object" },
                session: { type: "object" },
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
                    deliveryPolicy: { type: "object" }
                  }
                }
              }
            })
          },
          "404": errorResponse,
          "409": errorResponse
        }
      }
    },
    "/api/v1/courses/{courseId}/lessons/{lessonId}/activities/{activityId}/attempts":
      {
        post: {
          summary: "Submit and assess one course activity attempt",
          description:
            "Deterministic activities are graded locally. Written mathematics uses the configured Forge model and withholds the grade when structured assessment is unavailable. Voice delivery submits only Albert's confirmed text answer; audio and separate transcripts are not accepted.",
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
              additionalProperties: false,
              required: ["answerMarkdown"],
              properties: {
                userId: { type: "string", maxLength: 160 },
                answerMarkdown: {
                  type: "string",
                  minLength: 1,
                  maxLength: 60000
                },
                deliveryMode: {
                  type: "string",
                  enum: ["visual", "voice"],
                  default: "visual"
                },
                voiceSessionToken: { type: "string", format: "uuid" },
                voiceConfirmation: { type: "boolean", enum: [true] },
                idempotencyKey: {
                  type: "string",
                  minLength: 8,
                  maxLength: 160
                }
              }
            })
          },
          responses: {
            "200": {
              description: "Original result for an exact idempotent retry",
              content: jsonContent({ type: "object" })
            },
            "201": {
              description:
                "Saved attempt, attempt ordinals, assessment, progress, and suggested next lesson",
              content: jsonContent({ type: "object" })
            },
            "202": {
              description:
                "Original attempt for an exact retry is still being assessed",
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
