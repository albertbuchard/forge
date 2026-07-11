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
      energy: "7"
    });

    expect(payloads.body).toMatchObject({
      weightKg: null,
      waistCm: null,
      bodyFatPercent: null
    });
    expect(payloads.subjective).toMatchObject({
      energy: 7,
      hunger: null,
      cravings: null
    });
    expect(payloads.gut.bloating).toBeNull();
    expect(payloads.appearance.facePuffiness).toBeNull();
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
  });
});
