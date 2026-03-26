import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n";

describe("i18n", () => {
  it("returns English strings by key", () => {
    expect(translate("en", "common.routeLabels.today")).toBe("Today");
  });

  it("returns French strings by key", () => {
    expect(translate("fr", "common.routeLabels.today")).toBe("Aujourd'hui");
  });

  it("interpolates parameters", () => {
    expect(translate("en", "common.shell.savingOther", { count: 3 })).toBe("Saving 3 changes");
    expect(translate("fr", "common.shell.savingOther", { count: 3 })).toBe("Enregistrement de 3 modifications");
  });

  it("falls back to English when the active locale is missing a key", () => {
    expect(translate("fr", "common.navigation.create")).toBe("Créer");
  });
});
