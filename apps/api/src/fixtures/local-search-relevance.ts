import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEntityKind
} from "@/lib/knowledge-graph-types.js";
import type {
  LocalSearchDocument,
  LocalSearchEntityType
} from "../services/local-search.js";

export const LOCAL_SEARCH_RELEVANCE_FIXTURE_VERSION =
  "forge-local-search-relevance-v1";

type FixtureRecord = {
  entityType: LocalSearchEntityType;
  entityKind: KnowledgeGraphEntityKind | null;
  title: string;
  detail: string;
  body: string;
  sourceHref: string;
  graphHref?: string | null;
  importance?: number;
};

type RelevanceFixtureDocument = LocalSearchDocument & {
  entityType: LocalSearchEntityType;
};

function fixtureDocument(
  entityId: string,
  record: FixtureRecord
): RelevanceFixtureDocument {
  return {
    key: `${record.entityType}:${entityId}`,
    entityType: record.entityType,
    entityId,
    entityKind: record.entityKind,
    title: record.title,
    detail: record.detail,
    category: record.entityType
      .split("_")
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" "),
    sourceHref: record.sourceHref,
    graphHref:
      record.graphHref === undefined
        ? record.entityKind
          ? `/knowledge-graph?focus=${encodeURIComponent(`${record.entityType}:${entityId}`)}`
          : null
        : record.graphHref,
    updatedAt: "2026-08-09T09:00:00.000Z",
    importance: record.importance ?? 0,
    fields: [
      { key: "title", label: "Title", value: record.title, weight: 9 },
      {
        key: "description",
        label: "Description",
        value: record.detail,
        weight: 4
      },
      {
        key: "source_text",
        label: "Source text",
        value: record.body,
        weight: 2
      }
    ]
  };
}

export const LOCAL_SEARCH_RELEVANCE_DOCUMENTS: RelevanceFixtureDocument[] = [
  fixtureDocument("goal_continuity", {
    entityType: "goal",
    entityKind: "goal",
    title: "Keep essential work available during outages",
    detail:
      "Make planning and capture resilient when the network is unavailable.",
    body: "offline continuity resilient planning mobile capture recovery",
    sourceHref: "/goals/goal_continuity",
    importance: 90
  }),
  fixtureDocument("project_orion", {
    entityType: "project",
    entityKind: "project",
    title: "Orion mobile continuity",
    detail: "Keep phone capture reliable through weak and missing connections.",
    body: "offline mobile capture synchronize later network outage",
    sourceHref: "/projects/project_orion",
    importance: 78
  }),
  fixtureDocument("task_rotate_keys", {
    entityType: "task",
    entityKind: "task",
    title: "Rotate backup encryption keys",
    detail: "Replace the recovery key and verify a restored archive.",
    body: "encrypted backup restore disaster recovery verification",
    sourceHref: "/tasks/task_rotate_keys",
    importance: 70
  }),
  fixtureDocument("strategy_evidence", {
    entityType: "strategy",
    entityKind: "strategy",
    title: "Verify evidence before expansion",
    detail: "Require a measured result before widening a release.",
    body: "evidence measurement bounded rollout publication readiness",
    sourceHref: "/strategies/strategy_evidence"
  }),
  fixtureDocument("habit_recovery_walk", {
    entityType: "habit",
    entityKind: "habit",
    title: "Evening recovery walk",
    detail: "Take a quiet walk after demanding work.",
    body: "recovery movement evening stress sleep consistency",
    sourceHref: "/habits?focus=habit_recovery_walk"
  }),
  fixtureDocument("tag_deep_work", {
    entityType: "tag",
    entityKind: "tag",
    title: "Deep work",
    detail: "Focused work without interruptions.",
    body: "concentration focus uninterrupted planning",
    sourceHref: "/tags?focus=tag_deep_work"
  }),
  fixtureDocument("note_restore", {
    entityType: "note",
    entityKind: "note",
    title: "Database restoration checklist",
    detail: "Steps for recovering an encrypted backup after a service failure.",
    body: "verify archive checksum decrypt backup restore database recovery drill",
    sourceHref: "/notes?focus=note_restore",
    importance: 65
  }),
  fixtureDocument("person_samira", {
    entityType: "person",
    entityKind: "person",
    title: "Samira Chen",
    detail: "Independent privacy and security reviewer.",
    body: "quarterly privacy review data minimization access controls",
    sourceHref: "/people/person_samira"
  }),
  fixtureDocument("insight_sleep_focus", {
    entityType: "insight",
    entityKind: "insight",
    title: "Consistent sleep supports morning focus",
    detail:
      "Stable sleep timing is associated with stronger first-session focus.",
    body: "sleep consistency morning focus recovery observation",
    sourceHref: "/knowledge-graph?focus=insight%3Ainsight_sleep_focus"
  }),
  fixtureDocument("event_cardiology", {
    entityType: "calendar_event",
    entityKind: "calendar_event",
    title: "Cardiology follow-up",
    detail: "Bring the exercise log and medication list.",
    body: "health appointment heart specialist calendar",
    sourceHref: "/calendar?focus=event_cardiology&focusType=calendar_event"
  }),
  fixtureDocument("block_writing", {
    entityType: "work_block_template",
    entityKind: "work_block",
    title: "Quiet writing sprint",
    detail: "A protected ninety-minute drafting block.",
    body: "writing focus template deep work draft",
    sourceHref: "/calendar?focus=block_writing&focusType=work_block_template"
  }),
  fixtureDocument("timebox_access_logs", {
    entityType: "task_timebox",
    entityKind: "timebox",
    title: "Review access logs",
    detail: "Inspect privileged access events before the privacy review.",
    body: "security audit access logs scheduled timebox",
    sourceHref: "/calendar?focus=timebox_access_logs&focusType=task_timebox"
  }),
  fixtureDocument("life_relocation", {
    entityType: "life_event",
    entityKind: null,
    title: "Relocation to Lausanne",
    detail: "Move home and establish the new daily routine.",
    body: "relocation move Lausanne housing transition preferences",
    sourceHref: "/life-events?focus=life_relocation"
  }),
  fixtureDocument("artifact_privacy_audit", {
    entityType: "artifact",
    entityKind: "artifact",
    title: "Quarterly privacy audit",
    detail: "Independent review of data access and retention controls.",
    body: "privacy review security evidence retention access control report",
    sourceHref: "/artifacts/artifact_privacy_audit"
  }),
  fixtureDocument("value_stewardship", {
    entityType: "psyche_value",
    entityKind: "value",
    title: "Careful stewardship",
    detail: "Protect people and their information when making decisions.",
    body: "privacy responsibility trust values",
    sourceHref: "/psyche/values?focus=value_stewardship#values-atlas"
  }),
  fixtureDocument("pattern_overcommit", {
    entityType: "behavior_pattern",
    entityKind: "pattern",
    title: "Overcommit after a successful week",
    detail: "Planning load rises too quickly after a short improvement.",
    body: "overcommit planning pattern capacity recovery",
    sourceHref: "/psyche/patterns?focus=pattern_overcommit#pattern-lanes"
  }),
  fixtureDocument("behavior_pause", {
    entityType: "behavior",
    entityKind: "behavior",
    title: "Pause before accepting new work",
    detail: "Review current capacity before making another commitment.",
    body: "capacity boundary deliberate response behavior",
    sourceHref: "/psyche/behaviors?focus=behavior_pause#behavior-columns"
  }),
  fixtureDocument("belief_speed", {
    entityType: "belief_entry",
    entityKind: "belief",
    title: "Speed determines worth",
    detail: "A belief that creates rushed decisions and hidden recovery costs.",
    body: "schema belief urgency perfection pressure",
    sourceHref: "/psyche/schemas-beliefs?focus=belief_speed"
  }),
  fixtureDocument("mode_editor", {
    entityType: "mode_profile",
    entityKind: "mode",
    title: "Patient editor",
    detail: "A calm mode for precise revision and quality checks.",
    body: "mode deliberate revision calm quality",
    sourceHref: "/psyche/modes?focus=mode_editor"
  }),
  fixtureDocument("mode_session_editor", {
    entityType: "mode_guide_session",
    entityKind: "mode_session",
    title: "Enter patient editor mode",
    detail: "A guided transition into careful revision.",
    body: "guided mode session breathing revision",
    sourceHref: "/psyche/modes/guide?focus=mode_session_editor"
  }),
  fixtureDocument("flashcard_recovery", {
    entityType: "flashcard",
    entityKind: "flashcard",
    title: "Recovery is part of the work",
    detail: "Remember to budget rest when planning difficult work.",
    body: "flashcard spaced repetition recovery planning",
    sourceHref: "/psyche/flashcards?focus=flashcard_recovery"
  }),
  fixtureDocument("event_type_transition", {
    entityType: "event_type",
    entityKind: "event_type",
    title: "Major transition",
    detail: "A durable change in home, work, or relationships.",
    body: "life transition relocation event taxonomy",
    sourceHref: "/knowledge-graph?focus=event_type%3Aevent_type_transition"
  }),
  fixtureDocument("emotion_grounded", {
    entityType: "emotion_definition",
    entityKind: "emotion",
    title: "Grounded",
    detail: "Steady, present, and able to choose deliberately.",
    body: "emotion calm stable present",
    sourceHref: "/knowledge-graph?focus=emotion_definition%3Aemotion_grounded"
  }),
  fixtureDocument("report_triggers", {
    entityType: "trigger_report",
    entityKind: "report",
    title: "Interruption trigger report",
    detail: "Review what repeatedly breaks focused work.",
    body: "trigger report interruptions concentration patterns",
    sourceHref: "/psyche/reports/report_triggers"
  }),
  fixtureDocument("catalog_workplace", {
    entityType: "preference_catalog",
    entityKind: null,
    title: "Workplace preferences",
    detail: "A catalog of environmental and collaboration preferences.",
    body: "preference catalog office remote quiet collaboration",
    sourceHref: "/preferences?focusCatalog=catalog_workplace"
  }),
  fixtureDocument("catalog_item_quiet", {
    entityType: "preference_catalog_item",
    entityKind: null,
    title: "Quiet room",
    detail: "A low-noise setting for concentrated work.",
    body: "preference catalog item quiet focus environment",
    sourceHref: "/preferences?focusCatalogItem=catalog_item_quiet"
  }),
  fixtureDocument("context_relocation", {
    entityType: "preference_context",
    entityKind: null,
    title: "Relocation decisions",
    detail: "Preferences that matter when choosing a new home and routine.",
    body: "relocation housing commute neighborhood preference context",
    sourceHref: "/preferences?focusContext=context_relocation"
  }),
  fixtureDocument("preference_walkable", {
    entityType: "preference_item",
    entityKind: null,
    title: "Walkable neighborhood",
    detail: "Prefer daily needs within a short walk.",
    body: "preference item relocation walking neighborhood",
    sourceHref: "/preferences?focusItem=preference_walkable"
  }),
  fixtureDocument("questionnaire_energy", {
    entityType: "questionnaire_instrument",
    entityKind: null,
    title: "Daily energy check",
    detail: "A short questionnaire about energy, sleep, and focus.",
    body: "questionnaire instrument energy sleep concentration",
    sourceHref: "/psyche/questionnaires/questionnaire_energy"
  }),
  fixtureDocument("sleep_consistent", {
    entityType: "sleep_session",
    entityKind: null,
    title: "Consistent eight-hour sleep",
    detail: "Sleep session with stable timing and strong recovery.",
    body: "sleep session consistency eight hours morning focus recovery",
    sourceHref: "/sleep?focus=sleep_consistent"
  }),
  fixtureDocument("workout_strength", {
    entityType: "workout_session",
    entityKind: null,
    title: "Full-body strength session",
    detail: "Moderate strength training followed by deliberate recovery.",
    body: "workout session strength training recovery exercise",
    sourceHref: "/sports/workouts/workout_strength"
  }),
  fixtureDocument("organization_helios", {
    entityType: "work_organization",
    entityKind: "work_organization",
    title: "Helios Clinical AI Institute",
    detail: "A target organization for causal health research and engineering.",
    body: "clinical artificial intelligence institute causal health research employer target",
    sourceHref: "/work/organizations/organization_helios"
  }),
  fixtureDocument("engagement_clinical_ml", {
    entityType: "work_engagement",
    entityKind: "work_engagement",
    title: "Clinical machine-learning research appointment",
    detail: "A current hybrid role with protected research time and an upcoming review.",
    body: "current work engagement clinical machine learning appointment workload research review",
    sourceHref: "/work/engagements/engagement_clinical_ml"
  }),
  fixtureDocument("campaign_remote_health", {
    entityType: "opportunity_campaign",
    entityKind: "opportunity_campaign",
    title: "Remote clinical AI transition campaign",
    detail: "An active search for research engineering roles that fit current work and recovery commitments.",
    body: "opportunity campaign job search remote clinical AI transition criteria current work recovery",
    sourceHref: "/work/campaigns/campaign_remote_health"
  }),
  fixtureDocument("opportunity_causal_health", {
    entityType: "job_opportunity",
    entityKind: "job_opportunity",
    title: "Causal health research engineer",
    detail: "A remote role combining causal inference, clinical data, and production model evaluation.",
    body: "job opportunity remote causal health research engineer clinical data production evaluation",
    sourceHref: "/work/opportunities/opportunity_causal_health"
  }),
  fixtureDocument("application_causal_health", {
    entityType: "job_application",
    entityKind: "job_application",
    title: "Submitted causal health application",
    detail: "A verified submission awaiting an employer response and follow-up date.",
    body: "job application submitted confirmation follow up employer response causal health",
    sourceHref: "/work/applications/application_causal_health"
  }),
  fixtureDocument("interview_research_panel", {
    entityType: "job_interview",
    entityKind: "job_interview",
    title: "Research engineering panel interview",
    detail: "A scheduled panel discussion with a protected preparation block.",
    body: "job interview research engineering panel scheduled preparation calendar",
    sourceHref: "/work/interviews/interview_research_panel"
  }),
  fixtureDocument("offer_hybrid_research", {
    entityType: "job_offer",
    entityKind: "job_offer",
    title: "Hybrid research engineering offer",
    detail: "An offer under review against relocation, workload, and compensation criteria.",
    body: "job offer hybrid research engineering comparison relocation workload compensation decision",
    sourceHref: "/work/offers/offer_hybrid_research"
  }),
  fixtureDocument("outreach_mentor_intro", {
    entityType: "work_outreach",
    entityKind: "work_outreach",
    title: "Mentor introduction request",
    detail: "A drafted networking message about the clinical AI transition campaign.",
    body: "work outreach mentor introduction networking drafted message clinical AI campaign",
    sourceHref: "/work/outreach/outreach_mentor_intro"
  })
];

export const LOCAL_SEARCH_RELEVANCE_EDGES: KnowledgeGraphEdge[] = [
  {
    id: "edge_continuity_orion",
    source: "goal:goal_continuity",
    target: "project:project_orion",
    relationKind: "goal_project",
    family: "structural",
    label: "Includes project",
    strength: 1,
    directional: true,
    structural: true
  },
  {
    id: "edge_restore_task",
    source: "note:note_restore",
    target: "task:task_rotate_keys",
    relationKind: "note_link",
    family: "contextual",
    label: "Explains recovery task",
    strength: 0.8,
    directional: true,
    structural: false
  },
  {
    id: "edge_privacy_reviewer",
    source: "artifact:artifact_privacy_audit",
    target: "person:person_samira",
    relationKind: "entity_link",
    family: "contextual",
    label: "Reviewed by",
    strength: 0.8,
    directional: true,
    structural: false
  },
  {
    id: "edge_sleep_insight",
    source: "insight:insight_sleep_focus",
    target: "habit:habit_recovery_walk",
    relationKind: "habit_link",
    family: "contextual",
    label: "Supports recovery habit",
    strength: 0.7,
    directional: true,
    structural: false
  },
  {
    id: "edge_value_behavior",
    source: "psyche_value:value_stewardship",
    target: "behavior:behavior_pause",
    relationKind: "behavior_value",
    family: "taxonomy",
    label: "Expressed by behavior",
    strength: 0.7,
    directional: true,
    structural: false
  },
  {
    id: "edge_pattern_belief",
    source: "behavior_pattern:pattern_overcommit",
    target: "belief_entry:belief_speed",
    relationKind: "pattern_belief",
    family: "taxonomy",
    label: "Reinforces belief",
    strength: 0.7,
    directional: true,
    structural: false
  },
  {
    id: "edge_behavior_pattern",
    source: "behavior:behavior_pause",
    target: "behavior_pattern:pattern_overcommit",
    relationKind: "behavior_pattern",
    family: "taxonomy",
    label: "Responds to pattern",
    strength: 0.7,
    directional: true,
    structural: false
  }
];

function cloneFixtureDocumentForOtherUser(
  document: RelevanceFixtureDocument
): RelevanceFixtureDocument {
  const otherId = `${document.entityId}_other`;
  const replaceRecordId = (value: string | null) =>
    value
      ?.replaceAll(
        encodeURIComponent(document.entityId),
        encodeURIComponent(otherId)
      )
      .replaceAll(document.entityId, otherId) ?? null;
  return {
    ...document,
    key: `${document.entityType}:${otherId}`,
    entityId: otherId,
    sourceHref: replaceRecordId(document.sourceHref) ?? document.sourceHref,
    graphHref: replaceRecordId(document.graphHref),
    // Every other-user record deliberately has the same visible title. This
    // makes a permission failure observable instead of letting title matching
    // conceal it.
    fields: document.fields.map((field) => ({ ...field }))
  };
}

export const LOCAL_SEARCH_RELEVANCE_PARTITIONS = {
  allowed: LOCAL_SEARCH_RELEVANCE_DOCUMENTS,
  other: LOCAL_SEARCH_RELEVANCE_DOCUMENTS.map(cloneFixtureDocumentForOtherUser)
} as const;

export const LOCAL_SEARCH_RELEVANCE_ALL_DOCUMENTS = [
  ...LOCAL_SEARCH_RELEVANCE_PARTITIONS.allowed,
  ...LOCAL_SEARCH_RELEVANCE_PARTITIONS.other
];

export const LOCAL_SEARCH_RELEVANCE_OTHER_USER_TOMBSTONES = new Set(
  LOCAL_SEARCH_RELEVANCE_PARTITIONS.other.map((document) => document.key)
);

export type LocalSearchRelevanceJudgment = {
  documentKey: string;
  entityType: LocalSearchEntityType;
  relevance: 0 | 1 | 2 | 3;
};

export type LocalSearchRelevanceQuery = {
  id: string;
  query: string;
  partition: "allowed";
  judgments: LocalSearchRelevanceJudgment[];
};

const documentByEntityType = new Map(
  LOCAL_SEARCH_RELEVANCE_PARTITIONS.allowed.map((document) => [
    document.entityType,
    document
  ])
);

function documentFor(entityType: LocalSearchEntityType) {
  const document = documentByEntityType.get(entityType);
  if (!document) {
    throw new Error(`Missing local-search fixture for ${entityType}.`);
  }
  return document;
}

function judgmentsFor(
  primaryType: LocalSearchEntityType,
  secondaryType?: LocalSearchEntityType
): LocalSearchRelevanceJudgment[] {
  const primary = documentFor(primaryType);
  const primaryOther = cloneFixtureDocumentForOtherUser(primary);
  const judgments: LocalSearchRelevanceJudgment[] = [
    {
      documentKey: primary.key,
      entityType: primary.entityType,
      relevance: 3
    },
    {
      documentKey: primaryOther.key,
      entityType: primaryOther.entityType,
      relevance: 0
    }
  ];
  if (secondaryType && secondaryType !== primaryType) {
    const secondary = documentFor(secondaryType);
    const secondaryOther = cloneFixtureDocumentForOtherUser(secondary);
    judgments.push(
      {
        documentKey: secondary.key,
        entityType: secondary.entityType,
        relevance: 2
      },
      {
        documentKey: secondaryOther.key,
        entityType: secondaryOther.entityType,
        relevance: 0
      }
    );
  }
  return judgments;
}

type HeldOutPair = readonly [
  primary: LocalSearchEntityType,
  secondary: LocalSearchEntityType,
  query: string
];

const HELD_OUT_QUERY_PAIRS: readonly HeldOutPair[] = [
  [
    "goal",
    "project",
    "which plan keeps critical work and phone capture available when connections disappear"
  ],
  [
    "task",
    "goal",
    "change the backup key after proving the archive can be recovered and keep essential work safe"
  ],
  [
    "project",
    "note",
    "phone notes for synchronizing later and recovering the local database"
  ],
  [
    "note",
    "task",
    "instructions to decrypt and restore the database plus replace its recovery secret"
  ],
  [
    "strategy",
    "work_engagement",
    "measured rollout strategy for improving a current clinical research appointment"
  ],
  [
    "work_organization",
    "strategy",
    "clinical research organization that requires measured evidence before expanding"
  ],
  [
    "sleep_session",
    "job_opportunity",
    "remote health research opportunity that protects a stable sleep schedule"
  ],
  [
    "job_application",
    "habit",
    "follow up on the submitted application while preserving the evening recovery walk"
  ],
  [
    "work_block_template",
    "job_interview",
    "protected ninety minute drafting block for research panel interview preparation"
  ],
  [
    "trigger_report",
    "tag",
    "review recurring interruptions that damage concentration"
  ],
  [
    "work_organization",
    "opportunity_campaign",
    "clinical AI organization targeted by the active remote transition search"
  ],
  [
    "artifact",
    "person",
    "who independently reviews the quarterly report on privacy retention"
  ],
  [
    "person",
    "task_timebox",
    "Samira's scheduled inspection of privileged log events"
  ],
  [
    "insight",
    "work_engagement",
    "morning focus observation connected to the current clinical research appointment"
  ],
  [
    "job_offer",
    "insight",
    "hybrid research offer decision informed by evidence about stable morning focus"
  ],
  [
    "life_event",
    "work_outreach",
    "relocation transition and mentor introduction for clinical AI work"
  ],
  [
    "event_type",
    "calendar_event",
    "a durable home transition alongside a dated specialist visit"
  ],
  [
    "work_outreach",
    "work_block_template",
    "draft a mentor introduction message inside a protected writing block"
  ],
  [
    "task_timebox",
    "job_opportunity",
    "scheduled review of the remote causal health research opportunity"
  ],
  [
    "preference_context",
    "job_offer",
    "compare the hybrid research offer against relocation and commute preferences"
  ],
  ["psyche_value", "artifact", "privacy responsibility and retention evidence"],
  ["behavior", "psyche_value", "careful capacity decisions protect trust"],
  [
    "behavior_pattern",
    "belief_entry",
    "overcommitment driven by urgency pressure"
  ],
  ["behavior", "behavior_pattern", "pause before accepting more work"],
  ["mode_profile", "belief_entry", "patient calm instead of rushed perfection"],
  [
    "mode_guide_session",
    "mode_profile",
    "guided transition into calm revision"
  ],
  [
    "flashcard",
    "mode_guide_session",
    "guided reminder that recovery supports work"
  ],
  [
    "job_application",
    "flashcard",
    "application follow up reminder that recovery remains part of the work"
  ],
  ["life_event", "event_type", "relocation as a durable life transition"],
  [
    "emotion_definition",
    "mode_profile",
    "grounded calm and deliberate choices"
  ],
  ["trigger_report", "tag", "report repeated focus interruptions"],
  [
    "preference_catalog",
    "preference_catalog_item",
    "quiet workplace preferences"
  ],
  [
    "preference_catalog_item",
    "preference_item",
    "quiet walkable daily environment"
  ],
  [
    "preference_context",
    "preference_item",
    "walkable neighborhood relocation preference"
  ],
  [
    "preference_catalog",
    "questionnaire_instrument",
    "work environment energy preferences"
  ],
  ["questionnaire_instrument", "sleep_session", "daily sleep and energy check"],
  [
    "opportunity_campaign",
    "workout_session",
    "active job search that must fit alongside strength training recovery"
  ],
  ["workout_session", "habit", "evening movement and exercise recovery"],
  [
    "emotion_definition",
    "belief_entry",
    "grounded response to urgency pressure"
  ],
  [
    "calendar_event",
    "job_interview",
    "scheduled specialist visit and research panel interview"
  ]
];

if (HELD_OUT_QUERY_PAIRS.length !== 40) {
  throw new Error("The local-search held-out fixture must contain 40 queries.");
}

// This acceptance set is intentionally separate from development queries. Its
// checksum is fixed below before ranker validation and is asserted by the
// readiness test. Production ranking code never imports this fixture module.
export const LOCAL_SEARCH_HELD_OUT_QUERIES: LocalSearchRelevanceQuery[] =
  HELD_OUT_QUERY_PAIRS.map(([primary, secondary, query], index) => ({
    id: `heldout-${String(index + 1).padStart(2, "0")}`,
    query,
    partition: "allowed",
    judgments: judgmentsFor(primary, secondary)
  }));

const DEVELOPMENT_SINGLE_FAMILY_QUERIES =
  LOCAL_SEARCH_RELEVANCE_PARTITIONS.allowed.flatMap((document, index) => [
    {
      id: `development-${String(index * 2 + 1).padStart(2, "0")}`,
      query: document.title.toLocaleLowerCase("en"),
      partition: "allowed" as const,
      judgments: judgmentsFor(document.entityType)
    },
    {
      id: `development-${String(index * 2 + 2).padStart(2, "0")}`,
      query: document.detail.toLocaleLowerCase("en"),
      partition: "allowed" as const,
      judgments: judgmentsFor(document.entityType)
    }
  ]);

// These development queries were written independently of the held-out set.
// Neither set is transformed, suffixed, or otherwise derived from the other.
const DEVELOPMENT_CROSS_FAMILY_QUERY_PAIRS: readonly HeldOutPair[] = [
  ["goal", "project", "keep mobile plans usable without connectivity"],
  ["task", "goal", "verify restored work and rotate its recovery key"]
];

export const LOCAL_SEARCH_DEVELOPMENT_QUERIES: LocalSearchRelevanceQuery[] = [
  ...DEVELOPMENT_SINGLE_FAMILY_QUERIES,
  ...DEVELOPMENT_CROSS_FAMILY_QUERY_PAIRS.map(
    ([primary, secondary, query], index) => ({
      id: `development-${String(
        index + LOCAL_SEARCH_RELEVANCE_DOCUMENTS.length * 2 + 1
      ).padStart(2, "0")}`,
      query,
      partition: "allowed" as const,
      judgments: judgmentsFor(primary, secondary)
    })
  )
];

if (LOCAL_SEARCH_DEVELOPMENT_QUERIES.length !== 80) {
  throw new Error(
    "The local-search development fixture must contain 80 queries."
  );
}

export const LOCAL_SEARCH_HELD_OUT_QUERY_SHA256 =
  "85b6b4a2aefbd743a9d2e9b6a62c396b6353ad39635db19085cd1a26d1a41631";
