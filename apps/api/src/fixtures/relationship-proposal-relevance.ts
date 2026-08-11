import type { CrudEntityType } from "../types.js";
import type { RelationshipProposalSourceDocument } from "../services/relationship-proposals.js";

export const RELATIONSHIP_PROPOSAL_FIXTURE_VERSION =
  "forge-relationship-proposals-v1";
export const RELATIONSHIP_PROPOSAL_HELD_OUT_SHA256 =
  "a3f330984a5eebc81130ce3359ad8d984fee3356e06888584d348ed877386a19";

export type RelationshipProposalFixtureCase = {
  id: string;
  partition: "development" | "held_out";
  source: RelationshipProposalSourceDocument;
  target: RelationshipProposalSourceDocument;
  expected: {
    relationship: "supports" | "informs" | "related";
    sourceKey: string;
    targetKey: string;
  } | null;
  negativeKind: "same_title" | "deleted" | "unauthorized" | "unrelated" | null;
};

const OWNER = "fixture-owner";
const OTHER_OWNER = "fixture-other-owner";

function document(input: {
  id: string;
  entityType: CrudEntityType;
  topic: string;
  ownerUserId?: string;
  authorized?: boolean;
  deleted?: boolean;
}): RelationshipProposalSourceDocument {
  const title = `${input.topic} ${input.entityType.replaceAll("_", " ")}`;
  return {
    key: `${input.entityType}:${input.id}`,
    entityType: input.entityType,
    entityId: input.id,
    entityKind: null,
    title,
    detail: `Focused work concerning ${input.topic}.`,
    category: input.entityType.replaceAll("_", " "),
    sourceHref: `/fixture/${input.entityType}/${input.id}`,
    graphHref: `/knowledge-graph?focus=${input.entityType}%3A${input.id}`,
    updatedAt: "2026-08-09T10:00:00.000Z",
    importance: 50,
    fields: [
      {
        key: "description",
        label: "Description",
        value: `Evidence for ${input.topic}.`,
        weight: 1
      }
    ],
    ownerUserId: input.ownerUserId ?? OWNER,
    authorized: input.authorized ?? true,
    deleted: input.deleted ?? false
  };
}

function key(item: RelationshipProposalSourceDocument) {
  return `${item.entityType}:${item.entityId}`;
}

function positiveCase(input: {
  id: string;
  partition: "development" | "held_out";
  relationship: "supports" | "informs" | "related";
  sourceType: CrudEntityType;
  targetType: CrudEntityType;
  topic: string;
}): RelationshipProposalFixtureCase {
  const first = document({
    id: `${input.id}-a`,
    entityType: input.sourceType,
    topic: input.topic
  });
  const second = document({
    id: `${input.id}-b`,
    entityType: input.targetType,
    topic: input.topic
  });
  const ordered =
    input.relationship === "related" && key(first).localeCompare(key(second)) > 0
      ? [second, first]
      : [first, second];
  return {
    id: input.id,
    partition: input.partition,
    source: first,
    target: second,
    expected: {
      relationship: input.relationship,
      sourceKey: key(ordered[0]!),
      targetKey: key(ordered[1]!)
    },
    negativeKind: null
  };
}

function negativeCase(input: {
  id: string;
  partition: "development" | "held_out";
  kind: "same_title" | "deleted" | "unauthorized" | "unrelated";
  topic: string;
}): RelationshipProposalFixtureCase {
  const common = {
    id: `${input.id}-a`,
    entityType: "project" as const,
    topic: input.topic
  };
  const source = document(common);
  let target = document({
    id: `${input.id}-b`,
    entityType: "task",
    topic: `${input.topic} unrelated counterpart`
  });
  if (input.kind === "unauthorized" || input.kind === "same_title") {
    target = document({
      id: `${input.id}-b`,
      entityType: "task",
      topic: input.topic,
      ownerUserId: OTHER_OWNER,
      authorized: false
    });
    if (input.kind === "same_title") target.title = source.title;
  } else if (input.kind === "deleted") {
    target = document({
      id: `${input.id}-b`,
      entityType: "task",
      topic: input.topic,
      deleted: true
    });
  } else {
    target = document({
      id: `${input.id}-b`,
      entityType: "task",
      topic:
        input.partition === "development"
          ? "zephyr cobalt lantern"
          : "yarrow bronze telescope"
    });
  }
  return {
    id: input.id,
    partition: input.partition,
    source,
    target,
    expected: null,
    negativeKind: input.kind
  };
}

const DEVELOPMENT_SUPPORT_TOPICS = [
  "alpine migration ledger",
  "birch release checklist",
  "cobalt training cadence",
  "delta archive cleanup",
  "ember writing practice",
  "fjord budget forecast",
  "granite mobility routine",
  "harbor client renewal",
  "indigo garden redesign",
  "juniper reading syllabus",
  "keystone hiring rubric",
  "lunar sleep protocol",
  "meadow nutrition baseline",
  "nickel security review",
  "opal language immersion",
  "prairie family calendar",
  "quartz research synthesis",
  "river product launch",
  "summit savings target",
  "timber conference proposal"
] as const;
const DEVELOPMENT_INFORM_TOPICS = [
  "atlas customer interviews",
  "brisk usability findings",
  "canyon recovery signals",
  "dahlia pricing evidence",
  "elm onboarding observations",
  "falcon retention analysis",
  "garnet coaching notes",
  "hearth workload evidence",
  "iris accessibility findings",
  "jasmine market signals",
  "kiln prototype feedback",
  "lagoon travel research",
  "marble energy observations",
  "nectar habit evidence",
  "orchid survey findings",
  "pebble planning evidence",
  "quill architecture notes",
  "reed learning analysis",
  "spruce risk observations",
  "tulip roadmap evidence"
] as const;
const DEVELOPMENT_RELATED_TOPICS = [
  "amber creative workshop",
  "brook community dinner",
  "cedar home renovation",
  "drift cycling expedition",
  "echo music rehearsal",
  "flint emergency planning",
  "grove mentoring program",
  "horizon photography project",
  "ivory donation campaign",
  "jetty coastal restoration",
  "kestrel speaking practice",
  "linen wardrobe inventory",
  "mosaic design system",
  "nova astronomy journal",
  "oasis hydration experiment",
  "plume editorial calendar",
  "quarry workshop maintenance",
  "raven volunteer schedule",
  "saffron recipe collection",
  "thistle neighborhood map"
] as const;
const HELD_OUT_SUPPORT_TOPICS = [
  "aurora certification pathway",
  "banyan strength progression",
  "coral contract renewal",
  "denim household inventory",
  "equinox focus ritual",
  "fern portfolio refresh",
  "glacier marathon preparation",
  "hazel scholarship application",
  "island language milestone",
  "jade retirement contribution"
] as const;
const HELD_OUT_INFORM_TOPICS = [
  "acorn interview evidence",
  "beacon recovery observations",
  "citrus adoption findings",
  "dune collaboration signals",
  "evergreen sleep evidence",
  "fable navigation findings",
  "ginger appetite observations",
  "helium performance evidence",
  "inkwell reader findings",
  "jigsaw planning observations"
] as const;
const HELD_OUT_RELATED_TOPICS = [
  "aster ceramics studio",
  "bramble hiking itinerary",
  "copper film archive",
  "dove neighborhood gathering",
  "estuary wildlife survey",
  "foxglove rehearsal schedule",
  "galaxy telescope journal",
  "honey cookbook revision",
  "isotope museum exhibit",
  "jute textile workshop"
] as const;

const supportSourceTypes: CrudEntityType[] = [
  "task",
  "project",
  "strategy",
  "habit"
];
const informSourceTypes: CrudEntityType[] = [
  "note",
  "insight",
  "artifact",
  "trigger_report"
];
const informTargetTypes: CrudEntityType[] = ["goal", "project", "task", "habit"];
const relatedPairs: Array<[CrudEntityType, CrudEntityType]> = [
  ["project", "task"],
  ["habit", "calendar_event"],
  ["psyche_value", "behavior_pattern"],
  ["preference_context", "preference_item"],
  ["life_event", "calendar_event"]
];

function buildPositivePartition(
  partition: "development" | "held_out",
  supportTopics: readonly string[],
  informTopics: readonly string[],
  relatedTopics: readonly string[]
) {
  return [
    ...supportTopics.map((topic, index) =>
      positiveCase({
        id: `${partition}-supports-${index + 1}`,
        partition,
        relationship: "supports",
        sourceType: supportSourceTypes[index % supportSourceTypes.length]!,
        targetType: "goal",
        topic
      })
    ),
    ...informTopics.map((topic, index) =>
      positiveCase({
        id: `${partition}-informs-${index + 1}`,
        partition,
        relationship: "informs",
        sourceType: informSourceTypes[index % informSourceTypes.length]!,
        targetType: informTargetTypes[index % informTargetTypes.length]!,
        topic
      })
    ),
    ...relatedTopics.map((topic, index) => {
      const [sourceType, targetType] = relatedPairs[index % relatedPairs.length]!;
      return positiveCase({
        id: `${partition}-related-${index + 1}`,
        partition,
        relationship: "related",
        sourceType,
        targetType,
        topic
      });
    })
  ];
}

function buildNegativePartition(
  partition: "development" | "held_out",
  count: number
) {
  const kinds = [
    "same_title",
    "deleted",
    "unauthorized",
    "unrelated"
  ] as const;
  return Array.from({ length: count }, (_, index) =>
    negativeCase({
      id: `${partition}-negative-${index + 1}`,
      partition,
      kind: kinds[index % kinds.length]!,
      topic: `${partition === "development" ? "devonly" : "sealedonly"} negative ${index + 1}`
    })
  );
}

export const RELATIONSHIP_PROPOSAL_DEVELOPMENT_CASES = [
  ...buildPositivePartition(
    "development",
    DEVELOPMENT_SUPPORT_TOPICS,
    DEVELOPMENT_INFORM_TOPICS,
    DEVELOPMENT_RELATED_TOPICS
  ),
  ...buildNegativePartition("development", 20)
];

export const RELATIONSHIP_PROPOSAL_HELD_OUT_CASES = [
  ...buildPositivePartition(
    "held_out",
    HELD_OUT_SUPPORT_TOPICS,
    HELD_OUT_INFORM_TOPICS,
    HELD_OUT_RELATED_TOPICS
  ),
  ...buildNegativePartition("held_out", 10)
];
