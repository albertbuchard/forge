import { afterEach, describe, expect, it, vi } from "vitest";
const diagnosticMocks = vi.hoisted(() => ({
  publishUiDiagnosticLog: vi.fn()
}));
vi.mock("./diagnostics", () => diagnosticMocks);
import { getForgeLearningSession, submitForgeCourseAttempt } from "./api";

describe("Course learning request cancellation", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("passes the route query AbortSignal to the course fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ lesson: { id: "lesson-a" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getForgeLearningSession({
      courseId: "course-a",
      lessonId: "lesson-a",
      signal: controller.signal
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it("aborts a delayed lesson without issuing another request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = getForgeLearningSession({
      courseId: "course-a",
      lessonId: "lesson-a",
      signal: controller.signal
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(diagnosticMocks.publishUiDiagnosticLog).not.toHaveBeenCalled();
  });

  it("sends the caller's stable idempotency key with a course attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ attemptId: "attempt-a" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await submitForgeCourseAttempt({
      courseId: "course-a",
      lessonId: "lesson-a",
      activityId: "activity-a",
      userId: "learner-a",
      answerMarkdown: "A complete answer.",
      idempotencyKey: "attempt-key-stable"
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      answerMarkdown: "A complete answer.",
      idempotencyKey: "attempt-key-stable"
    });
  });
});
