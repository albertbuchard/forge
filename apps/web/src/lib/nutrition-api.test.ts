import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNutritionAppearanceCheckin,
  createNutritionBodyCheckin,
  createNutritionCheckinMutationKey,
  createNutritionGutCheckin,
  createNutritionSubjectiveCheckin
} from "./api";

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 201,
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

describe("nutrition check-in API retries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends stable per-domain idempotency keys with selected-user scope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ checkin: { id: "checkin_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createNutritionBodyCheckin(
      { weightKg: 78 },
      ["user_forge_bot"],
      "batch-1:body"
    );
    await createNutritionAppearanceCheckin(
      { leanness: 7 },
      ["user_forge_bot"],
      "batch-1:appearance"
    );
    await createNutritionSubjectiveCheckin(
      { energy: 8 },
      ["user_forge_bot"],
      "batch-1:subjective"
    );
    await createNutritionGutCheckin(
      { bloating: 2 },
      ["user_forge_bot"],
      "batch-1:gut"
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const expected = [
      ["body-checkins", "batch-1:body"],
      ["appearance-checkins", "batch-1:appearance"],
      ["subjective-checkins", "batch-1:subjective"],
      ["gut-checkins", "batch-1:gut"]
    ] as const;
    expected.forEach(([route, key], index) => {
      const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
      expect(url).toContain(
        `/api/v1/health/weight-loss/${route}?userIds=user_forge_bot`
      );
      expect(new Headers(init.headers).get("Idempotency-Key")).toBe(key);
    });
  });

  it("keeps the header optional for existing single-check-in callers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ checkin: { id: "checkin_2" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createNutritionBodyCheckin({ weightKg: 78 }, ["user_operator"]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Idempotency-Key")).toBe(false);
  });

  it("creates retry keys when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    const key = createNutritionCheckinMutationKey();
    expect(key).toMatch(/^weight-loss-checkin-\d+-[a-z0-9]+$/);
  });
});
