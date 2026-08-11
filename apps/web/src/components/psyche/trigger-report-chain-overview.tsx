import { Link } from "react-router-dom";
import { getEntityRoute } from "@/lib/note-helpers";
import type { TriggerReport } from "@/lib/psyche-types";
import type { CrudEntityType } from "@/lib/types";
import { cn } from "@/lib/utils";

type CatalogRecord = { id: string; title: string };

export type TriggerReportLinkCatalog = {
  eventTypes: CatalogRecord[];
  emotions: CatalogRecord[];
  patterns: CatalogRecord[];
  values: CatalogRecord[];
  goals: CatalogRecord[];
  projects: CatalogRecord[];
  tasks: CatalogRecord[];
  behaviors: CatalogRecord[];
  beliefs: CatalogRecord[];
  modes: CatalogRecord[];
};

type LinkedRecord = {
  id: string;
  label: string;
  category: string;
  href: string;
};

type LinkDefinition = {
  category: string;
  entityType: CrudEntityType;
  records: CatalogRecord[];
  ids: string[];
};

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function resolveTriggerReportLinks(
  report: TriggerReport,
  catalog: TriggerReportLinkCatalog
) {
  const definitions: LinkDefinition[] = [
    {
      category: "Event type",
      entityType: "event_type",
      records: catalog.eventTypes,
      ids: uniqueNonEmpty([report.eventTypeId])
    },
    {
      category: "Emotion",
      entityType: "emotion_definition",
      records: catalog.emotions,
      ids: uniqueNonEmpty(
        report.emotions.map((emotion) => emotion.emotionDefinitionId)
      )
    },
    {
      category: "Pattern",
      entityType: "behavior_pattern",
      records: catalog.patterns,
      ids: uniqueNonEmpty(report.linkedPatternIds)
    },
    {
      category: "Value",
      entityType: "psyche_value",
      records: catalog.values,
      ids: uniqueNonEmpty(report.linkedValueIds)
    },
    {
      category: "Goal",
      entityType: "goal",
      records: catalog.goals,
      ids: uniqueNonEmpty(report.linkedGoalIds)
    },
    {
      category: "Project",
      entityType: "project",
      records: catalog.projects,
      ids: uniqueNonEmpty(report.linkedProjectIds)
    },
    {
      category: "Task",
      entityType: "task",
      records: catalog.tasks,
      ids: uniqueNonEmpty(report.linkedTaskIds)
    },
    {
      category: "Behavior",
      entityType: "behavior",
      records: catalog.behaviors,
      ids: uniqueNonEmpty([
        ...report.linkedBehaviorIds,
        ...report.behaviors.map((behavior) => behavior.behaviorId)
      ])
    },
    {
      category: "Belief",
      entityType: "belief_entry",
      records: catalog.beliefs,
      ids: uniqueNonEmpty([
        ...report.linkedBeliefIds,
        ...report.thoughts.map((thought) => thought.beliefId)
      ])
    },
    {
      category: "Mode",
      entityType: "mode_profile",
      records: catalog.modes,
      ids: uniqueNonEmpty([
        ...report.linkedModeIds,
        ...report.modeTimeline.map((entry) => entry.modeId)
      ])
    }
  ];
  const visible: LinkedRecord[] = [];
  let unavailableCount = 0;

  for (const definition of definitions) {
    const recordsById = new Map(
      definition.records.map((record) => [record.id, record])
    );
    for (const id of definition.ids) {
      const record = recordsById.get(id);
      const href = record ? getEntityRoute(definition.entityType, id) : null;
      if (!record || !href) {
        unavailableCount += 1;
        continue;
      }
      visible.push({
        id,
        label: record.title,
        category: definition.category,
        href
      });
    }
  }

  return { visible, unavailableCount };
}

type ChainStage = {
  id: string;
  label: string;
  question: string;
  items: string[];
};

function formatOccurrence(value: string | null) {
  if (!value) return "Occurrence time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Occurrence time is invalid";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function buildTriggerReportChain(report: TriggerReport): ChainStage[] {
  const consequences = [
    ...report.consequences.selfShortTerm,
    ...report.consequences.selfLongTerm,
    ...report.consequences.othersShortTerm,
    ...report.consequences.othersLongTerm
  ];
  const hypothesisItems = report.interpretationConsent
    ? [
        report.reflection,
        report.hypothesis,
        report.hypothesisCorrection
          ? `Your correction: ${report.hypothesisCorrection}`
          : ""
      ]
    : [report.reflection];

  return [
    {
      id: "spark",
      label: "Spark",
      question: "What happened?",
      items: [
        formatOccurrence(report.occurredAt),
        report.customEventType,
        report.eventSituation,
        report.memoryClarity === "unspecified"
          ? "Memory clarity not recorded"
          : `Memory clarity: ${report.memoryClarity}`
      ]
    },
    {
      id: "wave",
      label: "Wave",
      question: "What moved through you?",
      items: [
        ...report.bodyCues,
        ...report.emotions.map(
          (emotion) => `${emotion.label} · intensity ${emotion.intensity}/100`
        )
      ]
    },
    {
      id: "script",
      label: "Script",
      question: "What did the mind say?",
      items: report.thoughts.map((thought) => thought.text)
    },
    {
      id: "lens",
      label: "Lens",
      question: "What meaning did you make?",
      items: hypothesisItems
    },
    {
      id: "state",
      label: "State",
      question: "Which modes took the wheel?",
      items: [
        ...report.modeOverlays,
        ...report.modeTimeline.map(
          (entry) => `${entry.stage}: ${entry.label}${entry.note ? ` — ${entry.note}` : ""}`
        )
      ]
    },
    {
      id: "move",
      label: "Move",
      question: "What did you do or want to do?",
      items: report.behaviors.map((behavior) => behavior.text)
    },
    {
      id: "horizon",
      label: "Horizon",
      question: "What followed?",
      items: consequences
    },
    {
      id: "pivot",
      label: "Pivot",
      question: "What is the next response?",
      items: report.nextMoves
    }
  ].map((stage) => ({
    ...stage,
    items: stage.items.map((item) => item.trim()).filter(Boolean)
  }));
}

export function TriggerReportChainOverview({
  report,
  catalog,
  linkCatalogStatus = "ready",
  activeStageId,
  onStageChange
}: {
  report: TriggerReport;
  catalog: TriggerReportLinkCatalog;
  linkCatalogStatus?: "loading" | "error" | "ready";
  activeStageId: string;
  onStageChange: (stageId: string) => void;
}) {
  const stages = buildTriggerReportChain(report);
  const links = resolveTriggerReportLinks(report, catalog);

  return (
    <section
      aria-labelledby="trigger-report-chain-overview-title"
      className="grid min-w-0 gap-4 rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-4 md:p-5"
    >
      <div>
        <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          Episode at a glance
        </div>
        <h2
          id="trigger-report-chain-overview-title"
          className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]"
        >
          Spark to Pivot
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
          Read the stored episode in order. Open any stage below to inspect or
          correct its full evidence without losing the whole chain.
        </p>
      </div>

      <ol className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage, index) => {
          const visibleItems = stage.items.slice(0, 3);
          const remainingCount = stage.items.length - visibleItems.length;
          return (
            <li key={stage.id} className="min-w-0">
              <button
                type="button"
                aria-label={`Open ${stage.label} stage`}
                aria-pressed={activeStageId === stage.id}
                className={cn(
                  "grid min-h-44 w-full min-w-0 content-start gap-2 rounded-[22px] border p-4 text-left transition",
                  activeStageId === stage.id
                    ? "border-[color-mix(in_srgb,var(--tertiary)_58%,var(--ui-border-subtle)_42%)] bg-[var(--ui-accent-soft)]"
                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] hover:bg-[var(--ui-surface-hover)]"
                )}
                onClick={() => onStageChange(stage.id)}
              >
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  {index + 1}. {stage.label}
                </span>
                <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
                  {stage.question}
                </span>
                {visibleItems.length > 0 ? (
                  <span className="grid gap-1.5 text-sm leading-5 text-[var(--ui-ink-soft)]">
                    {visibleItems.map((item, itemIndex) => (
                      <span
                        key={`${stage.id}:${itemIndex}`}
                        className="break-words [overflow-wrap:anywhere]"
                      >
                        {item}
                      </span>
                    ))}
                    {remainingCount > 0 ? (
                      <span className="text-xs text-[var(--ui-ink-faint)]">
                        +{remainingCount} more stored {remainingCount === 1 ? "item" : "items"}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-sm text-[var(--ui-ink-faint)]">
                    Not recorded yet.
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Linked records
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {linkCatalogStatus === "loading" ? (
            <span className="text-sm text-[var(--ui-ink-faint)]">
              Linked records are still loading.
            </span>
          ) : null}
          {linkCatalogStatus === "error" ? (
            <span role="alert" className="text-sm text-[var(--ui-ink-soft)]">
              Linked record details are unavailable right now. Stored links
              remain attached to the report.
            </span>
          ) : null}
          {linkCatalogStatus === "ready"
            ? links.visible.map((link) => (
            <Link
              key={`${link.category}:${link.id}`}
              to={link.href}
              className="inline-flex min-h-11 min-w-0 items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm font-medium text-[var(--ui-ink-medium)] hover:text-[var(--ui-ink-strong)]"
            >
              <span className="break-words [overflow-wrap:anywhere]">
                {link.category}: {link.label}
              </span>
            </Link>
              ))
            : null}
          {linkCatalogStatus === "ready" && links.unavailableCount > 0 ? (
            <span className="inline-flex min-h-11 items-center rounded-full border border-[var(--ui-border-subtle)] px-3 py-2 text-sm text-[var(--ui-ink-soft)]">
              {links.unavailableCount} linked{" "}
              {links.unavailableCount === 1 ? "record is" : "records are"}{" "}
              unavailable in this view
            </span>
          ) : null}
          {linkCatalogStatus === "ready" &&
          links.visible.length === 0 &&
          links.unavailableCount === 0 ? (
            <span className="text-sm text-[var(--ui-ink-faint)]">
              No linked records yet.
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
