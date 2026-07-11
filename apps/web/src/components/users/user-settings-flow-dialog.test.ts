import { describe, expect, it } from "vitest";
import { findDuplicateUserHandle } from "@/components/users/user-settings-flow-dialog";
import type { UserSummary } from "@/lib/types";

function user(id: string, handle: string, displayName = handle): UserSummary {
  return {
    id,
    kind: "human",
    handle,
    displayName,
    description: "",
    accentColor: "#112233",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  };
}

describe("findDuplicateUserHandle", () => {
  it("treats handles as case-insensitive durable identities", () => {
    const existing = user("user_1", "Planner-Bot", "Planner Bot");

    expect(findDuplicateUserHandle([existing], " planner-bot ")).toBe(existing);
  });

  it("allows an existing user to keep its own handle", () => {
    const existing = user("user_1", "planner-bot");

    expect(
      findDuplicateUserHandle([existing], "planner-bot", existing.id)
    ).toBeUndefined();
  });
});
