import type { PreferenceItemScore } from "@/lib/types";

export function PreferenceEvidencePanel({
  score,
  contextName,
  modelVersion
}: {
  score: PreferenceItemScore;
  contextName: string;
  modelVersion: string;
}) {
  const hasManualControls =
    Boolean(score.manualStatus) ||
    typeof score.manualScore === "number" ||
    typeof score.confidenceLock === "number" ||
    score.frozen;

  return (
    <div className="grid gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Why this score
        </div>
        <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
          Inferred in {contextName} with model {modelVersion}.
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Inferred score", score.latentScore.toFixed(2)],
          ["Confidence", `${Math.round(score.confidence * 100)}%`],
          ["Total evidence", score.evidenceCount],
          ["Effective status", score.manualStatus ?? score.status]
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[var(--ui-ink-faint)]">{label}</div>
            <div className="font-medium text-[var(--ui-ink-strong)]">
              {value}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Wins", score.pairwiseWins],
          ["Losses", score.pairwiseLosses],
          ["Ties", score.pairwiseTies],
          ["Signals", score.signalCount]
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[var(--ui-ink-faint)]">{label}</div>
            <div className="font-medium text-[var(--ui-ink-strong)]">
              {value}
            </div>
          </div>
        ))}
      </div>
      {score.explanation.length > 0 ? (
        <ul className="grid list-disc gap-1 pl-5 text-sm leading-6 text-[var(--ui-ink-soft)]">
          {score.explanation.slice(0, 4).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-[var(--ui-ink-soft)]">
          No supporting evidence yet. The score remains uncertain until
          comparisons or direct signals are recorded.
        </div>
      )}
      {score.conflictCount > 0 ? (
        <div className="rounded-[14px] bg-[var(--ui-warning-soft)] px-3 py-2 text-sm text-[var(--ui-ink-medium)]">
          {score.conflictCount} conflicting signal
          {score.conflictCount === 1 ? " reduces" : "s reduce"} confidence.
        </div>
      ) : null}
      {hasManualControls ? (
        <div className="rounded-[14px] bg-[var(--ui-accent-soft)] px-3 py-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
          Manual model controls are active. They can replace the inferred status
          or score, lock confidence, or mark the item as frozen for review.
          Supporting evidence remains visible underneath those controls.
        </div>
      ) : null}
      {score.item?.sourceEntityType && score.item.sourceEntityId ? (
        <div className="text-xs text-[var(--ui-ink-faint)]">
          Source: {score.item.sourceEntityType} · {score.item.sourceEntityId}
        </div>
      ) : (
        <div className="text-xs text-[var(--ui-ink-faint)]">
          Source: direct preference item
        </div>
      )}
    </div>
  );
}
