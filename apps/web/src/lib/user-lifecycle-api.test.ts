import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deactivateUser,
  getUserDeactivationPreview,
  reactivateUser,
  setUserOwnershipDefault
} from "./api";

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

describe("user lifecycle API contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps preview read-only and sends stable lifecycle idempotency keys in exact bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockJsonResponse({ preview: {}, receipt: {}, user: {} })
      );
    vi.stubGlobal("fetch", fetchMock);

    await getUserDeactivationPreview("user_bot", "user_operator");
    await deactivateUser({
      userId: "user_bot",
      replacementUserId: "user_operator",
      reason: "Transfer responsibility.",
      disconnectActiveSessions: true,
      idempotencyKey: "stable-deactivation-key"
    });
    await reactivateUser({
      userId: "user_bot",
      reason: "Approved return.",
      idempotencyKey: "stable-reactivation-key"
    });
    await setUserOwnershipDefault({
      userId: "user_bot",
      ownerUserId: "user_operator",
      idempotencyKey: "stable-default-key"
    });

    const preview = new URL(
      String(fetchMock.mock.calls[0]?.[0]),
      "http://forge.local"
    );
    expect(preview.pathname).toBe(
      "/api/v1/users/user_bot/deactivation-preview"
    );
    expect(preview.searchParams.get("replacementUserId")).toBe("user_operator");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin"
    });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("method");
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        replacementUserId: "user_operator",
        reason: "Transfer responsibility.",
        disconnectActiveSessions: true,
        idempotencyKey: "stable-deactivation-key"
      })
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        reason: "Approved return.",
        idempotencyKey: "stable-reactivation-key"
      })
    });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        ownerUserId: "user_operator",
        idempotencyKey: "stable-default-key"
      })
    });
  });
});
