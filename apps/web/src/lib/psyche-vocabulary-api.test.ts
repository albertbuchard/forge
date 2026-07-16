import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmotionDefinition,
  createEventType,
  listEmotionDefinitions,
  listEventTypes
} from "./api";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Psyche vocabulary API client", () => {
  it("sends repeated owner scopes on event and emotion reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ eventTypes: [] }))
      .mockResolvedValueOnce(jsonResponse({ emotions: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listEventTypes(["user_1", "user_2"]);
    await listEmotionDefinitions(["user_1", "user_2"]);

    for (const [rawUrl] of fetchMock.mock.calls as Array<[string]>) {
      const url = new URL(rawUrl, "http://forge.local");
      expect(url.searchParams.getAll("userIds")).toEqual(["user_1", "user_2"]);
    }
  });

  it("keeps stable retry keys on dedicated UI creates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ eventType: {} }))
      .mockResolvedValueOnce(jsonResponse({ emotion: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await createEventType(
      { label: "Feedback rupture", description: "", userId: "user_1" },
      { idempotencyKey: "event-retry" }
    );
    await createEmotionDefinition(
      {
        label: "Exposed alarm",
        description: "",
        category: "threat",
        userId: "user_1"
      },
      { idempotencyKey: "emotion-retry" }
    );

    const eventInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const emotionInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(eventInit.headers).get("Idempotency-Key")).toBe(
      "event-retry"
    );
    expect(new Headers(emotionInit.headers).get("Idempotency-Key")).toBe(
      "emotion-retry"
    );
  });
});
