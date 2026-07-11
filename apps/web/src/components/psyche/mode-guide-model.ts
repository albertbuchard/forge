import type { ModeGuideSessionInput } from "@/lib/psyche-types";

export type ModeGuideDraft = {
  summary: string;
  copingResponse: string;
  childState: string;
  criticStyle: string;
  healthyContact: string;
  interpretationStance: "" | "fits" | "partly" | "uncertain" | "decline";
  correction: string;
  nextResponse: string;
  saveDecision: "" | "save" | "defer";
};

export const DEFAULT_MODE_GUIDE_DRAFT: ModeGuideDraft = {
  summary: "",
  copingResponse: "none",
  childState: "none",
  criticStyle: "none",
  healthyContact: "none",
  interpretationStance: "",
  correction: "",
  nextResponse: "",
  saveDecision: ""
};

const COPING_HYPOTHESES: Record<string, string> = {
  fight: "pushing back to restore safety or control",
  flight: "getting distance from pressure or threat",
  freeze: "going still while the situation felt difficult to process",
  detach: "reducing contact with difficult feeling",
  comply: "yielding to preserve connection or reduce conflict",
  overcompensate: "taking strong control before something painful could land"
};

const NEED_HYPOTHESES: Record<string, string> = {
  vulnerable: "care, safety, or reassurance",
  angry: "recognition, fairness, or a boundary",
  impulsive: "relief or room for a strong need",
  lonely: "contact or dependable connection",
  ashamed: "acceptance without attack"
};

const CRITIC_HYPOTHESES: Record<string, string> = {
  demanding:
    "A demanding inner voice may also have raised the standard or urgency",
  punitive: "A punishing inner voice may also have turned pain into blame"
};

const HEALTHY_CONTACT: Record<string, string> = {
  healthy_adult: "Some steady, reality-based perspective still seems reachable",
  happy_child:
    "Some playfulness, curiosity, or uncomplicated aliveness still seems reachable"
};

export function buildModeGuideHypothesis(draft: ModeGuideDraft) {
  const parts: string[] = [];
  const coping = COPING_HYPOTHESES[draft.copingResponse];
  const need = NEED_HYPOTHESES[draft.childState];
  const critic = CRITIC_HYPOTHESES[draft.criticStyle];
  const healthy = HEALTHY_CONTACT[draft.healthyContact];

  if (coping) {
    parts.push(
      `It sounds as though your system may have tried to help by ${coping}.`
    );
  }
  if (need) {
    parts.push(`Underneath that, there may have been a need for ${need}.`);
  }
  if (critic) {
    parts.push(`${critic}.`);
  }
  if (healthy) {
    parts.push(`${healthy}.`);
  }
  if (parts.length === 0) {
    parts.push(
      "What is present sounds mixed or not yet clear, and it may be more useful to stay curious than to force a label."
    );
  }

  return `${parts.join(" ")} This is a working hypothesis, not a diagnosis or a fact about you.`;
}

export function buildModeGuideSessionInput(
  draft: ModeGuideDraft
): ModeGuideSessionInput {
  const interpretationAccepted =
    draft.interpretationStance === "fits" ||
    draft.interpretationStance === "partly";
  const answers = [
    {
      questionKey: "coping_response",
      value: interpretationAccepted ? draft.copingResponse : "none"
    },
    {
      questionKey: "child_state",
      value: interpretationAccepted ? draft.childState : "none"
    },
    {
      questionKey: "critic_style",
      value: interpretationAccepted ? draft.criticStyle : "none"
    },
    {
      questionKey: "healthy_contact",
      value: interpretationAccepted ? draft.healthyContact : "none"
    },
    { questionKey: "reported_coping_response", value: draft.copingResponse },
    { questionKey: "reported_child_state", value: draft.childState },
    { questionKey: "reported_critic_style", value: draft.criticStyle },
    { questionKey: "reported_healthy_contact", value: draft.healthyContact },
    { questionKey: "interpretation_stance", value: draft.interpretationStance },
    { questionKey: "next_response", value: draft.nextResponse }
  ];

  const correction = draft.correction.trim();
  if (correction) {
    answers.push({ questionKey: "user_correction", value: correction });
  }

  return {
    summary: draft.summary.trim(),
    answers
  };
}

export function getModeGuideStepError(stepId: string, draft: ModeGuideDraft) {
  if (stepId === "moment" && !draft.summary.trim()) {
    return "Use your own words for the moment before continuing. Nothing is saved while you are in this flow.";
  }
  if (stepId === "check" && !draft.interpretationStance) {
    return "Choose whether the working hypothesis fits, partly fits, remains uncertain, or should be declined.";
  }
  if (stepId === "next-response" && !draft.nextResponse) {
    return "Choose the smallest response that feels useful now, including pausing without action.";
  }
  if (stepId === "consent" && !draft.saveDecision) {
    return "Choose whether to save this guided session or keep it unsaved for now.";
  }
  return undefined;
}
