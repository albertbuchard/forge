export type SurfaceHelp = {
  title: string;
  purpose: string;
  primaryAction: string;
  metricNote?: string;
};

export const SHELL_METRIC_HELP: Record<string, string> = {
  ap: "Action Points estimate remaining usable capacity today from the Life Force model. They combine baseline capacity, current drains, and scheduled recovery.",
  "instant-ap":
    "Instant AP per hour estimates the headroom Forge thinks you have right now. Positive values mean the current moment can absorb more work; low or negative values suggest recovery or lighter work.",
  streak:
    "The streak counts qualifying Forge activity days. It is a consistency signal, not a moral score.",
  xp: "XP comes from the auditable reward ledger. It summarizes completed work and meaningful captured evidence across Forge.",
  momentum:
    "Momentum combines recent XP, task movement, habit evidence, and streak context into a quick operating signal for the selected user scope."
};

const DEFAULT_SURFACE_HELP: SurfaceHelp = {
  title: "Forge surface",
  purpose:
    "This view is part of the Forge operating system. It keeps the current user scope, active work timer, search, creation tools, and navigation available while the page focuses on one domain.",
  primaryAction:
    "Use the page title, nearby chips, and visible action buttons to decide whether you are reviewing evidence, planning work, or executing the next task.",
  metricNote:
    "Numbers in Forge are decision-support signals. Open the local tooltips on metric labels to see exactly what each one means."
};

const SURFACE_HELP_BY_ID: Record<string, SurfaceHelp> = {
  overview: {
    title: "Overview",
    purpose:
      "Overview is the daily command page. It combines momentum, Life Force, active goals, active projects, top tasks, health context, and recent evidence into one scan.",
    primaryAction:
      "Start here when you need to choose what matters next. Open the top task, inspect the body-signal block, or jump into Today when the next move is unclear.",
    metricNote:
      "Momentum, AP, XP, and streak are summary signals. They are meant to point attention, not replace judgement."
  },
  "life-force": {
    title: "Life Force",
    purpose:
      "Life Force models daily Action Point capacity, current drains, recovery, and the editable weekly capacity curve.",
    primaryAction:
      "Use it to understand whether the next work block should be heavy, light, or delayed until recovery improves.",
    metricNote:
      "AP and AP/hour are local planning units. They are not medical or physiological measurements."
  },
  goals: {
    title: "Goals",
    purpose:
      "Goals describe long-range direction and keep projects, tasks, habits, and evidence connected to something larger.",
    primaryAction:
      "Review goal progress, open a goal detail page, and check whether current projects still point at the right horizon."
  },
  habits: {
    title: "Habits",
    purpose:
      "Habits track recurring commitments, check-ins, streak evidence, and reward signals.",
    primaryAction:
      "Use this view to check in, inspect habit drift, and decide which routines need adjustment."
  },
  projects: {
    title: "Projects",
    purpose:
      "Projects are PRD-backed initiatives that connect goals, strategies, issues, tasks, ownership, and delivery state.",
    primaryAction:
      "Open project detail for PRD context, or switch to hierarchy when you need the full goal-to-task chain."
  },
  strategies: {
    title: "Strategies",
    purpose:
      "Strategies capture the reasoning layer between goals and execution. They explain why the work is arranged this way.",
    primaryAction:
      "Use this view to inspect strategy graphs and check whether active work still follows the intended plan."
  },
  preferences: {
    title: "Preferences",
    purpose:
      "Preferences store pairwise judgments, profiles, and model state that help Forge and agents understand taste and priorities.",
    primaryAction:
      "Use it when Forge needs clearer ranking signals or when agent recommendations feel misaligned."
  },
  calendar: {
    title: "Calendar",
    purpose:
      "Calendar turns planning into timeboxes and provider-backed scheduled commitments.",
    primaryAction:
      "Use it to inspect the week, move timeboxes, and keep commitments visible next to execution work."
  },
  "knowledge-graph": {
    title: "Knowledge Graph",
    purpose:
      "Knowledge Graph shows Forge entities and links as a living map so goals, tasks, notes, wiki pages, Psyche records, and evidence do not stay isolated.",
    primaryAction:
      "Search or focus a node when you need context around an entity before editing or executing work."
  },
  workbench: {
    title: "Workbench",
    purpose:
      "Workbench organizes graph flows, AI tools, published outputs, and reusable operations.",
    primaryAction:
      "Open a flow when you need a structured tool process instead of a normal page action."
  },
  movement: {
    title: "Movement",
    purpose:
      "Movement explains trips, stays, places, and location-derived context from the companion sync.",
    primaryAction:
      "Use it to understand where time went, verify movement import quality, and connect place context to daily planning."
  },
  sleep: {
    title: "Sleep",
    purpose:
      "Sleep presents canonical nights, recovery context, and raw segment evidence without making transport fragments the main product object.",
    primaryAction:
      "Use it to check whether today should be a heavy training/work day or a recovery-biased day."
  },
  sports: {
    title: "Sports",
    purpose:
      "Sports is the workout cockpit: sessions, routes, preserved HealthKit evidence, friendly activity names, and per-workout drill-down.",
    primaryAction:
      "Open a workout when you need the evidence behind a training-load or heart-rate conclusion."
  },
  "training-load": {
    title: "Training Load",
    purpose:
      "Training Load estimates cardiovascular stress from workouts, heart-rate timelines, adaptive HRR zones, and recent vitals.",
    primaryAction:
      "Use it to decide whether the next block should build aerobic base, hold load, sharpen intensity, or recover.",
    metricNote:
      "ACWR, strain, HR zones, and VO2max are coaching signals. They are not clinical diagnosis and should be interpreted with session context."
  },
  vitals: {
    title: "Vitals",
    purpose:
      "Vitals gathers body signals such as resting heart rate, HRV, VO2max, breathing, and body metrics.",
    primaryAction:
      "Use it to inspect recovery trends and confirm whether a single number is stable or just a sparse reading."
  },
  kanban: {
    title: "Kanban",
    purpose:
      "Kanban is the execution board for active work items and lane movement.",
    primaryAction:
      "Move work deliberately between backlog, focus, in progress, blocked, and done. Open task detail for execution notes."
  },
  today: {
    title: "Today",
    purpose:
      "Today narrows Forge to immediate commitments, planned work, due habits, and the next meaningful actions.",
    primaryAction:
      "Use it when the system feels too broad and you need a single practical runway."
  },
  work: {
    title: "Work",
    purpose:
      "Work keeps current and planned jobs, contracts, appointments, freelance engagements, check-ins, opportunity searches, applications, and career transitions in one connected area.",
    primaryAction:
      "Review each current engagement and its next action, record a quick check-in, or turn on Looking for opportunities to create or resume a search campaign.",
    metricNote:
      "Work check-ins use anchored responses and preserve each observation. Trends describe recorded experience over time; they do not diagnose health or invent values between check-ins."
  },
  rewards: {
    title: "Trophy Hall",
    purpose:
      "Trophy Hall explains XP, levels, streaks, achievements, cosmetic unlocks, and the Forge Smith state from the reward ledger.",
    primaryAction:
      "Use it to understand what behavior earned rewards and what current next targets mean."
  },
  notes: {
    title: "Notes",
    purpose:
      "Notes store evidence, thoughts, linked context, and local memory that can attach to Forge entities.",
    primaryAction:
      "Capture raw context here, then link it to goals, projects, tasks, Psyche records, or wiki pages."
  },
  wiki: {
    title: "KarpaWiki",
    purpose:
      "KarpaWiki is the durable knowledge surface for authored pages, imported material, links, summaries, and entity memory.",
    primaryAction:
      "Search before creating, then write or ingest when the knowledge should become reusable."
  },
  psyche: {
    title: "Psyche",
    purpose:
      "Psyche tracks values, modes, behaviors, beliefs, patterns, reports, questionnaires, and flashcards as reflective records.",
    primaryAction:
      "Use it to turn mental-state evidence into structured reminders, behavior maps, and reviewable reports."
  },
  activity: {
    title: "Activity",
    purpose:
      "Activity is the event log for work, imports, edits, agent actions, and recent system evidence.",
    primaryAction:
      "Use it to audit what changed and jump back to the entity that produced the evidence."
  },
  insights: {
    title: "Insights",
    purpose:
      "Insights stores recommendations and realizations that may need to become real Forge records.",
    primaryAction:
      "Review each insight, then apply, link, or dismiss it so it does not remain vague advice."
  },
  review: {
    title: "Weekly Review",
    purpose:
      "Weekly Review turns recent evidence into a closeout: wins, calibration, unfinished loops, and next-week direction.",
    primaryAction:
      "Use it at the end of a week to convert activity into decisions and written memory."
  },
  settings: {
    title: "Settings",
    purpose:
      "Settings controls runtime configuration, data tools, users, agents, mobile pairing, models, rewards, logs, and recovery surfaces.",
    primaryAction:
      "Use it for configuration or maintenance. Avoid changing data paths unless you explicitly intend a storage migration."
  }
};

export function getSurfaceHelp(routeId: string | undefined): SurfaceHelp {
  if (!routeId) {
    return DEFAULT_SURFACE_HELP;
  }
  const normalizedRouteId = routeId.split(":")[0] ?? routeId;
  return (
    SURFACE_HELP_BY_ID[routeId] ??
    SURFACE_HELP_BY_ID[normalizedRouteId] ??
    DEFAULT_SURFACE_HELP
  );
}
