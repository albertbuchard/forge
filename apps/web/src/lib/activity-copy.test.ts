import { describe, expect, it } from "vitest";
import {
  getExclusiveActivityEndDate,
  getReadableActivityDescription,
  getReadableActivityTitle,
  redactActivityText
} from "@/lib/activity-copy";

describe("activity display safety", () => {
  it("redacts credential-shaped values without hiding normal audit copy", () => {
    const text =
      "Rotated api_key=alpha-secret and Bearer abc.def.ghi at https://forge.test/callback?token=raw-token&view=activity";

    expect(redactActivityText(text)).toBe(
      "Rotated api_key=[redacted] and Bearer [redacted] at https://forge.test/callback?token=[redacted]&view=activity"
    );
    expect(redactActivityText("Token rotation completed safely")).toBe(
      "Token rotation completed safely"
    );
  });

  it("applies redaction to readable titles and descriptions", () => {
    const event = {
      title: "Connected with fg_live_privatevalue",
      description: "client_secret: very-secret",
      source: "system"
    };

    expect(getReadableActivityTitle(event)).not.toContain("privatevalue");
    expect(getReadableActivityDescription(event)).toBe(
      "client_secret: [redacted]"
    );
  });

  it("converts an inclusive date filter to a stable exclusive boundary", () => {
    expect(getExclusiveActivityEndDate("2026-12-31")).toBe("2027-01-01");
    expect(getExclusiveActivityEndDate("2026-02-29")).toBeUndefined();
    expect(getExclusiveActivityEndDate("not-a-date")).toBeUndefined();
  });
});
