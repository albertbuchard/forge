import { describe, expect, it } from "vitest";
import {
  buildCheckinPayloads,
  buildInitialCheckinDraft,
  validateCheckinDraft
} from "./weight-loss-checkin-dialog";

describe("weight-loss check-in truthfulness", () => {
  it("keeps blank optional fields missing instead of converting them to zero", () => {
    const payloads = buildCheckinPayloads({
      ...buildInitialCheckinDraft(),
      energy: "7",
      subjectiveNotes: "Low energy after lunch",
      gutNotes: "Sensitive gut-only context",
      appearanceNotes: "Private appearance-only context",
      bodyNotes: "Body-only measurement context"
    });

    expect(payloads.body).toMatchObject({
      weightKg: null,
      waistCm: null,
      bodyFatPercent: null
    });
    expect(payloads.subjective).toMatchObject({
      energy: 7,
      hunger: null,
      cravings: null,
      notes: "Low energy after lunch"
    });
    expect(payloads.gut.bloating).toBeNull();
    expect(payloads.gut.notes).toBe("Sensitive gut-only context");
    expect(payloads.appearance.facePuffiness).toBeNull();
    expect(payloads.appearance.notes).toBe("Private appearance-only context");
    expect(payloads.body.notes).toBe("Body-only measurement context");
    expect(JSON.stringify(payloads.subjective)).not.toContain("gut-only");
    expect(JSON.stringify(payloads.appearance)).not.toContain("gut-only");
  });

  it("requires one real signal and rejects ratings outside their stated scale", () => {
    expect(validateCheckinDraft(buildInitialCheckinDraft())).toMatch(
      /at least one measurement or signal/i
    );
    expect(
      validateCheckinDraft({
        ...buildInitialCheckinDraft(),
        cravings: "11"
      })
    ).toMatch(/between 0 and 10/i);
    expect(
      validateCheckinDraft({
        ...buildInitialCheckinDraft(),
        weightKg: "84.2",
        bloating: "0"
      })
    ).toBeNull();
    expect(
      validateCheckinDraft({
        ...buildInitialCheckinDraft(),
        energy: "7",
        gutNotes: "This would otherwise be discarded silently"
      })
    ).toMatch(/gut rating before saving gut context/i);
  });
});
