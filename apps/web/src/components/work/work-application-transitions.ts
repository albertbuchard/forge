export const APPLICATION_TRANSITIONS: Record<string, string[]> = {
  planned: ["preparing", "withdrawn", "closed"],
  preparing: ["blocked_on_user_input", "ready_for_review", "withdrawn"],
  blocked_on_user_input: ["preparing", "ready_for_review", "withdrawn"],
  ready_for_review: ["preparing", "ready_to_submit", "withdrawn"],
  ready_to_submit: ["preparing", "withdrawn"],
  submitted: ["acknowledged", "screening", "rejected", "ghosted", "withdrawn"],
  acknowledged: [
    "screening",
    "interviewing",
    "assessment",
    "rejected",
    "ghosted",
    "withdrawn"
  ],
  screening: ["interviewing", "assessment", "rejected", "ghosted", "withdrawn"],
  interviewing: [
    "assessment",
    "references",
    "offer",
    "rejected",
    "ghosted",
    "withdrawn"
  ],
  assessment: [
    "interviewing",
    "references",
    "offer",
    "rejected",
    "ghosted",
    "withdrawn"
  ],
  references: ["offer", "rejected", "ghosted", "withdrawn"],
  offer: ["declined_by_candidate", "withdrawn", "closed"],
  accepted: ["closed"],
  declined_by_candidate: ["closed"],
  withdrawn: ["closed"],
  rejected: ["closed"],
  ghosted: ["screening", "interviewing", "rejected", "closed"],
  closed: []
};
