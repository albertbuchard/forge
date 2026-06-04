import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHero } from "@/components/shell/page-hero";
import {
  companionSyncLabBoxLayerFixtures,
  classifyCompanionSyncLabGap,
  companionSyncLabGapFixtures,
  companionSyncLabSourceFixtures,
  companionSyncLabTimelineFixtures,
  previewCompanionSyncLabTimeline
} from "@/features/companion-sync-lab-fixtures";

function formatObservedAt(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Waiting for device update";
}

const labCardClass =
  "grid min-w-0 gap-4 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5";
const labFixtureClass =
  "grid min-w-0 gap-2 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4";
const labColumnClass =
  "grid min-w-0 gap-2 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3";
const labSmallCardClass =
  "rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-xs text-[var(--ui-ink-soft)]";
const labEyebrowClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const labSubEyebrowClass =
  "text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]";
const labTitleClass = "text-sm font-medium text-[var(--ui-ink-strong)]";
const labBodyClass = "text-[var(--ui-ink-soft)]";
const labFaintClass = "text-[var(--ui-ink-faint)]";
const labWarningBadgeClass =
  "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
const labSuccessBadgeClass =
  "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]";
const labDangerBadgeClass =
  "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]";
const labUserBadgeClass = "bg-[var(--ui-accent-soft)] text-[var(--primary)]";

export function CompanionSyncLabPage() {
  return (
    <div className="mx-auto grid min-w-0 w-full max-w-[1180px] gap-5">
      <PageHero
        title="Companion Sync Lab"
        description="Deterministic fixtures for source-state reconciliation and movement gap repair. This route is dev-only and exists to make QA faster than recreating every phone state by hand."
        badge="Dev only"
      />

      <section className="grid min-w-0 gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className={labCardClass}>
          <div>
            <div className={labEyebrowClass}>Source matrix</div>
            <div className={`mt-2 text-sm leading-6 ${labBodyClass}`}>
              These rows mirror the pairing source-state contract that the web
              and phone now share.
            </div>
          </div>
          <div className="grid gap-3">
            {companionSyncLabSourceFixtures.map((fixture) => (
              <div key={fixture.id} className={labFixtureClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={labTitleClass}>{fixture.title}</div>
                  <Badge tone={fixture.desiredEnabled ? "signal" : "meta"}>
                    {fixture.desiredEnabled ? "Enabled" : "Off"}
                  </Badge>
                  <Badge tone="meta">
                    {fixture.desiredEnabled === fixture.appliedEnabled
                      ? "Applied"
                      : "Pending on phone"}
                  </Badge>
                </div>
                <div
                  className={`grid gap-1 text-xs ${labBodyClass} sm:grid-cols-2`}
                >
                  <div>Authorization: {fixture.authorizationStatus}</div>
                  <div>
                    Sync eligible: {fixture.syncEligible ? "Yes" : "No"}
                  </div>
                  <div>Desired: {fixture.desiredEnabled ? "On" : "Off"}</div>
                  <div>Applied: {fixture.appliedEnabled ? "On" : "Off"}</div>
                  <div className="sm:col-span-2">
                    Last observed: {formatObservedAt(fixture.lastObservedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className={labCardClass}>
          <div>
            <div className={labEyebrowClass}>Gap classifier</div>
            <div className={`mt-2 text-sm leading-6 ${labBodyClass}`}>
              Every gap resolves to exactly one of <code>stay</code>,{" "}
              <code>trip</code>, or <code>missing</code>.
            </div>
          </div>
          <div className="grid gap-3">
            {companionSyncLabGapFixtures.map((fixture) => {
              const preview = classifyCompanionSyncLabGap(fixture);
              return (
                <div key={fixture.id} className={labFixtureClass}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className={labTitleClass}>{fixture.title}</div>
                    <Badge
                      tone={
                        preview.kind === "missing"
                          ? "meta"
                          : preview.kind === "trip"
                            ? "signal"
                            : "default"
                      }
                    >
                      {preview.kind}
                    </Badge>
                    <Badge tone="meta">{preview.origin}</Badge>
                    {preview.suppressedShortJump ? (
                      <Badge className={labWarningBadgeClass}>
                        Suppressed short jump
                      </Badge>
                    ) : null}
                  </div>
                  <div
                    className={`grid gap-1 text-xs ${labBodyClass} sm:grid-cols-2`}
                  >
                    <div>Gap: {Math.round(fixture.gapSeconds / 60)} min</div>
                    <div>
                      Displacement:{" "}
                      {fixture.displacementMeters === null
                        ? "unknown"
                        : `${Math.round(fixture.displacementMeters)} m`}
                    </div>
                    <div>
                      Start boundary:{" "}
                      {fixture.hasStartBoundary ? "present" : "missing"}
                    </div>
                    <div>
                      End boundary:{" "}
                      {fixture.hasEndBoundary ? "present" : "missing"}
                    </div>
                  </div>
                  <div className={`text-sm leading-6 ${labBodyClass}`}>
                    {preview.reason}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      <Card className={labCardClass}>
        <div>
          <div className={labEyebrowClass}>Coverage preview</div>
          <div className={`mt-2 text-sm leading-6 ${labBodyClass}`}>
            These fixtures normalize a full window and highlight whether any
            interval would still be left uncovered.
          </div>
        </div>
        <div className="grid gap-3">
          {companionSyncLabTimelineFixtures.map((fixture) => {
            const preview = previewCompanionSyncLabTimeline(fixture);
            return (
              <div key={fixture.id} className={labFixtureClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={labTitleClass}>{fixture.title}</div>
                  <Badge
                    className={
                      preview.uncoveredIntervals.length === 0
                        ? labSuccessBadgeClass
                        : labDangerBadgeClass
                    }
                  >
                    {preview.uncoveredIntervals.length === 0
                      ? "Coverage locked"
                      : "Coverage broken"}
                  </Badge>
                  <Badge tone="meta">
                    {preview.segments.length} normalized segment
                    {preview.segments.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="grid gap-2">
                  {preview.segments.map((segment) => (
                    <div
                      key={segment.id}
                      className="flex flex-wrap items-center gap-2 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-xs text-[var(--ui-ink-soft)]"
                    >
                      <Badge
                        tone={
                          segment.kind === "trip"
                            ? "signal"
                            : segment.kind === "missing"
                              ? "meta"
                              : "default"
                        }
                      >
                        {segment.kind}
                      </Badge>
                      <Badge tone="meta">{segment.origin}</Badge>
                      <span>
                        {new Date(segment.startedAt).toLocaleTimeString()} →{" "}
                        {new Date(segment.endedAt).toLocaleTimeString()}
                      </span>
                      <span className={labFaintClass}>{segment.title}</span>
                    </div>
                  ))}
                </div>
                {preview.uncoveredIntervals.length > 0 ? (
                  <div className="grid gap-2">
                    {preview.uncoveredIntervals.map((interval) => (
                      <div
                        key={`${interval.startedAt}-${interval.endedAt}`}
                        className={`rounded-[14px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-3 py-2 text-xs ${labDangerBadgeClass}`}
                      >
                        Uncovered:{" "}
                        {new Date(interval.startedAt).toLocaleTimeString()} →{" "}
                        {new Date(interval.endedAt).toLocaleTimeString()}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className={labCardClass}>
        <div>
          <div className={labEyebrowClass}>Canonical box layers</div>
          <div className={`mt-2 text-sm leading-6 ${labBodyClass}`}>
            Raw phone measurements stay immutable. Forge generates automatic
            boxes from them, user-defined boxes override them, and the final
            projected boxes are what both the web and iPhone should render.
          </div>
        </div>
        <div className="grid gap-4">
          {companionSyncLabBoxLayerFixtures.map((fixture) => (
            <div key={fixture.id} className={labFixtureClass}>
              <div className="flex flex-wrap items-center gap-2">
                <div className={labTitleClass}>{fixture.title}</div>
                <Badge tone="meta">Raw: {fixture.rawMeasurements.length}</Badge>
                <Badge tone="meta">
                  Automatic: {fixture.automaticBoxes.length}
                </Badge>
                <Badge tone="meta">User: {fixture.userBoxes.length}</Badge>
                <Badge tone="signal">
                  Projected: {fixture.projectedBoxes.length}
                </Badge>
              </div>
              <div className="grid gap-3 xl:grid-cols-4">
                <div className={labColumnClass}>
                  <div className={labSubEyebrowClass}>Raw measurements</div>
                  {fixture.rawMeasurements.map((entry) => (
                    <div key={entry.id} className={labSmallCardClass}>
                      <div className="font-medium text-[var(--ui-ink-strong)]">
                        {entry.label}
                      </div>
                      <div>
                        {new Date(entry.startedAt).toLocaleTimeString()} →{" "}
                        {new Date(entry.endedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={labColumnClass}>
                  <div className={labSubEyebrowClass}>Automatic boxes</div>
                  {fixture.automaticBoxes.map((entry) => (
                    <div key={entry.id} className={labSmallCardClass}>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            entry.kind === "trip"
                              ? "signal"
                              : entry.kind === "missing"
                                ? "meta"
                                : "default"
                          }
                        >
                          {entry.kind}
                        </Badge>
                        <Badge tone="meta">{entry.origin}</Badge>
                      </div>
                      <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
                        {entry.title}
                      </div>
                      <div>
                        {new Date(entry.startedAt).toLocaleTimeString()} →{" "}
                        {new Date(entry.endedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={labColumnClass}>
                  <div className={labSubEyebrowClass}>User-defined boxes</div>
                  {fixture.userBoxes.map((entry) => (
                    <div key={entry.id} className={labSmallCardClass}>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={entry.kind === "missing" ? "meta" : "default"}
                        >
                          {entry.kind}
                        </Badge>
                        <Badge className={labUserBadgeClass}>
                          {entry.origin}
                        </Badge>
                      </div>
                      <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
                        {entry.title}
                      </div>
                      <div>
                        {new Date(entry.startedAt).toLocaleTimeString()} →{" "}
                        {new Date(entry.endedAt).toLocaleTimeString()}
                      </div>
                      <div className={`mt-1 ${labFaintClass}`}>
                        Overrides {entry.overrideCount} automatic box
                        {entry.overrideCount === 1 ? "" : "es"}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={labColumnClass}>
                  <div className={labSubEyebrowClass}>
                    Projected visible boxes
                  </div>
                  {fixture.projectedBoxes.map((entry) => (
                    <div key={entry.id} className={labSmallCardClass}>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            entry.kind === "trip"
                              ? "signal"
                              : entry.kind === "missing"
                                ? "meta"
                                : "default"
                          }
                        >
                          {entry.kind}
                        </Badge>
                        <Badge tone="meta">{entry.sourceKind}</Badge>
                      </div>
                      <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
                        {entry.title}
                      </div>
                      <div>
                        {new Date(entry.startedAt).toLocaleTimeString()} →{" "}
                        {new Date(entry.endedAt).toLocaleTimeString()}
                      </div>
                      <div className={`mt-1 ${labFaintClass}`}>
                        {entry.origin}
                        {entry.overrideCount > 0
                          ? ` · overrides ${entry.overrideCount}`
                          : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
