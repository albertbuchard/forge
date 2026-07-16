import { describe, expect, it } from "vitest";

import {
  buildTriggerReportPatch,
  formatTriggerReportDateTimeLocal,
  isTriggerReportEditorDirty,
  rebaseTriggerReportEditor,
  toTriggerReportEditor
} from "@/pages/psyche-report-detail-page";
import type { TriggerReport } from "@/lib/psyche-types";

function buildReport(): TriggerReport {
  return {
    id: "report-1",
    domainId: "domain-1",
    title: "A difficult wait",
    status: "draft",
    eventTypeId: null,
    customEventType: "Difficult conversation",
    eventSituation: "They stopped replying after I asked for clarity.",
    occurredAt: "2026-07-15T00:15:00+14:00",
    bodyCues: ["Tight chest"],
    emotions: [],
    thoughts: [],
    behaviors: [],
    consequences: {
      selfShortTerm: [],
      selfLongTerm: [],
      othersShortTerm: [],
      othersLongTerm: []
    },
    linkedPatternIds: ["pattern-1"],
    linkedValueIds: ["value-1"],
    linkedGoalIds: ["goal-1"],
    linkedProjectIds: ["project-1"],
    linkedTaskIds: ["task-1"],
    linkedBehaviorIds: [],
    linkedBeliefIds: [],
    linkedModeIds: [],
    modeOverlays: [],
    schemaLinks: [],
    modeTimeline: [],
    nextMoves: [],
    memoryClarity: "partial",
    reflection: "The uncertainty was painful.",
    hypothesis: "One possibility is that withdrawal felt protective.",
    hypothesisFit: "partly_fits",
    hypothesisCorrection: "Anger was present too.",
    interpretationConsent: true,
    revision: 7,
    userId: "user_operator",
    user: null,
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z"
  };
}

describe("trigger report detail editing contract", () => {
  it("formats stored instants with local calendar components", () => {
    const instant = "2026-07-15T00:15:00+14:00";
    const date = new Date(instant);
    const expected = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    const expectedTime = [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0")
    ].join(":");

    expect(formatTriggerReportDateTimeLocal(instant)).toBe(
      `${expected}T${expectedTime}`
    );
    expect(toTriggerReportEditor(buildReport()).occurredAt).toBe(
      `${expected}T${expectedTime}`
    );
  });

  it("binds updates to the loaded revision and preserves unedited links", () => {
    const report = buildReport();
    const editor = toTriggerReportEditor(report);

    expect(buildTriggerReportPatch(editor)).toMatchObject({
      expectedRevision: 7,
      linkedPatternIds: ["pattern-1"],
      linkedValueIds: ["value-1"],
      linkedGoalIds: ["goal-1"],
      linkedProjectIds: ["project-1"],
      linkedTaskIds: ["task-1"],
      interpretationConsent: true,
      hypothesis: "One possibility is that withdrawal felt protective.",
      hypothesisFit: "partly_fits",
      hypothesisCorrection: "Anger was present too."
    });
  });

  it("writes edited pattern, value, goal, project, and task links", () => {
    const report = buildReport();
    const editor = {
      ...toTriggerReportEditor(report),
      linkedPatternIds: ["pattern-2"],
      linkedValueIds: ["value-2"],
      linkedGoalIds: ["goal-2"],
      linkedProjectIds: ["project-2"],
      linkedTaskIds: ["task-2"]
    };

    expect(buildTriggerReportPatch(editor)).toMatchObject({
      expectedRevision: 7,
      linkedPatternIds: ["pattern-2"],
      linkedValueIds: ["value-2"],
      linkedGoalIds: ["goal-2"],
      linkedProjectIds: ["project-2"],
      linkedTaskIds: ["task-2"]
    });
  });

  it("rebases local field changes onto a newer server revision", () => {
    const baselineReport = buildReport();
    const baseline = toTriggerReportEditor(baselineReport);
    const localDraft = {
      ...baseline,
      title: "My unsaved title",
      linkedPatternIds: ["pattern-local"]
    };
    const latestReport = {
      ...baselineReport,
      title: "Server title",
      eventSituation: "The situation was clarified elsewhere.",
      linkedGoalIds: ["goal-server"],
      revision: 8
    };

    expect(isTriggerReportEditorDirty(localDraft, baseline)).toBe(true);
    expect(
      rebaseTriggerReportEditor(baseline, localDraft, latestReport)
    ).toMatchObject({
      title: "My unsaved title",
      eventSituation: "The situation was clarified elsewhere.",
      linkedPatternIds: ["pattern-local"],
      linkedGoalIds: ["goal-server"],
      revision: 8
    });
  });

  it("clears interpretation fields when consent is withdrawn", () => {
    const report = buildReport();
    const editor = {
      ...toTriggerReportEditor(report),
      interpretationConsent: false
    };

    expect(buildTriggerReportPatch(editor)).toMatchObject({
      expectedRevision: 7,
      interpretationConsent: false,
      hypothesis: "",
      hypothesisFit: "not_reviewed",
      hypothesisCorrection: ""
    });
  });
});
