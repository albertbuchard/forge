import { describe, expect, it } from "vitest";
import { ForgeApiError, describeApiError } from "./api-error";

describe("describeApiError", () => {
  it("formats structured Forge API errors with validation details", () => {
    const error = new ForgeApiError({
      status: 409,
      code: "idempotency_conflict",
      message: "Idempotency key already used with a different payload.",
      requestPath: "/api/v1/tasks",
      details: [{ path: "title", message: "Must match original payload" }]
    });

    expect(describeApiError(error)).toEqual({
      title: "Request failed (409)",
      description: "Idempotency key already used with a different payload. title: Must match original payload",
      code: "idempotency_conflict"
    });
  });

  it("falls back gracefully for generic errors", () => {
    expect(describeApiError(new Error("Backend offline"))).toEqual({
      title: "Something went wrong",
      description: "Backend offline",
      code: "unknown_error"
    });
  });
});
