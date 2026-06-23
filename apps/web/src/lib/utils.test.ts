import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges utility class input", () => {
    expect(cn("px-4", "text-white", undefined)).toBe("px-4 text-white");
  });
});
