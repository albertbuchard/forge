import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  TriggerReportChainOverview,
  type TriggerReportLinkCatalog
} from "@/components/psyche/trigger-report-chain-overview";
import type { TriggerReport } from "@/lib/psyche-types";

const report: TriggerReport = {
  id: "report_1",
  domainId: "psyche",
  title: "A difficult wait",
  status: "reviewed",
  eventTypeId: "event_type_1",
  customEventType: "Difficult conversation",
  eventSituation: "They stopped replying after I asked for clarity.",
  occurredAt: "2026-08-10T20:15:00.000Z",
  bodyCues: ["Chest tightened"],
  emotions: [
    {
      id: "emotion_1",
      emotionDefinitionId: "emotion_definition_1",
      label: "Fear",
      intensity: 80,
      note: ""
    }
  ],
  thoughts: [
    {
      id: "thought_1",
      text: "I will be abandoned.",
      parentMode: "",
      criticMode: "",
      beliefId: "belief_unavailable"
    }
  ],
  behaviors: [
    {
      id: "behavior_row_1",
      text: "Reached for the phone repeatedly.",
      mode: "",
      behaviorId: "behavior_1"
    }
  ],
  consequences: {
    selfShortTerm: ["Lost the evening"],
    selfLongTerm: [],
    othersShortTerm: [],
    othersLongTerm: []
  },
  linkedPatternIds: ["pattern_1"],
  linkedValueIds: ["value_1"],
  linkedGoalIds: ["goal_1"],
  linkedProjectIds: [],
  linkedTaskIds: [],
  linkedBehaviorIds: ["behavior_1"],
  linkedBeliefIds: [],
  linkedModeIds: [],
  modeOverlays: ["Vulnerable child"],
  schemaLinks: [],
  modeTimeline: [
    {
      id: "timeline_1",
      stage: "Wave",
      modeId: "mode_1",
      label: "Vulnerable child",
      note: "Wanted reassurance"
    }
  ],
  nextMoves: ["Wait ten minutes before sending another message."],
  memoryClarity: "partial",
  reflection: "Silence felt more certain than the evidence supported.",
  hypothesis: "Withdrawal may have felt protective.",
  hypothesisFit: "partly_fits",
  hypothesisCorrection: "I also wanted to avoid escalating the conversation.",
  interpretationConsent: true,
  revision: 2,
  userId: "user_operator",
  user: null,
  createdAt: "2026-08-10T21:00:00.000Z",
  updatedAt: "2026-08-11T08:00:00.000Z"
};

const catalog: TriggerReportLinkCatalog = {
  eventTypes: [{ id: "event_type_1", title: "Difficult conversation" }],
  emotions: [{ id: "emotion_definition_1", title: "Fear" }],
  patterns: [{ id: "pattern_1", title: "Reassurance loop" }],
  values: [{ id: "value_1", title: "Honesty" }],
  goals: [{ id: "goal_1", title: "Secure connection" }],
  projects: [],
  tasks: [],
  behaviors: [{ id: "behavior_1", title: "Pause before checking" }],
  beliefs: [],
  modes: [{ id: "mode_1", title: "Vulnerable child" }]
};

describe("PSY-11 trigger report chain overview", () => {
  it("keeps the whole episode ordered, exposes corrections, and opens available links", () => {
    const onStageChange = vi.fn();
    render(
      <MemoryRouter>
        <TriggerReportChainOverview
          report={report}
          catalog={catalog}
          activeStageId="spark"
          onStageChange={onStageChange}
        />
      </MemoryRouter>
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(
      screen.getByText(
        "Your correction: I also wanted to avoid escalating the conversation."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Goal: Secure connection" })
    ).toHaveAttribute("href", "/goals/goal_1");
    expect(
      screen.getByRole("link", { name: "Behavior: Pause before checking" })
    ).toHaveAttribute("href", "/psyche/behaviors?focus=behavior_1#behavior-columns");
    expect(
      screen.getByRole("link", { name: "Event type: Difficult conversation" })
    ).toHaveAttribute(
      "href",
      "/psyche/reports?vocabulary=event_type&focusVocabulary=event_type_1"
    );
    expect(screen.getByRole("link", { name: "Emotion: Fear" })).toHaveAttribute(
      "href",
      "/psyche/reports?vocabulary=emotion_definition&focusVocabulary=emotion_definition_1"
    );
    expect(
      screen.getByText("1 linked record is unavailable in this view")
    ).toBeInTheDocument();
    expect(screen.queryByText("belief_unavailable")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Pivot stage" }));
    expect(onStageChange).toHaveBeenCalledWith("pivot");
  });

  it("states which stages and links are not recorded", () => {
    const emptyReport: TriggerReport = {
      ...report,
      bodyCues: [],
      emotions: [],
      thoughts: [],
      behaviors: [],
      consequences: {
        selfShortTerm: [],
        selfLongTerm: [],
        othersShortTerm: [],
        othersLongTerm: []
      },
      linkedPatternIds: [],
      linkedValueIds: [],
      linkedGoalIds: [],
      linkedBehaviorIds: [],
      eventTypeId: null,
      modeOverlays: [],
      modeTimeline: [],
      nextMoves: [],
      reflection: "",
      hypothesis: "",
      hypothesisCorrection: "",
      interpretationConsent: false
    };
    render(
      <MemoryRouter>
        <TriggerReportChainOverview
          report={emptyReport}
          catalog={catalog}
          activeStageId="spark"
          onStageChange={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getAllByText("Not recorded yet.")).toHaveLength(7);
    expect(screen.getByText("No linked records yet.")).toBeInTheDocument();
  });
});
