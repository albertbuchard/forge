import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkbenchFlowVersionSummary } from "@/lib/types";

function describeVersion(version: WorkbenchFlowVersionSummary) {
  const action =
    version.changeKind === "restored" && version.restoredFromRevision
      ? `restored from version ${version.restoredFromRevision}`
      : version.changeKind;
  return `${action} · ${version.nodeCount} nodes · ${version.publicInputCount} inputs · ${version.publishedOutputCount} outputs`;
}

export function WorkbenchFlowVersionHistory({
  currentRevision,
  versions,
  loading,
  unavailable,
  onRestore
}: {
  currentRevision: number;
  versions: WorkbenchFlowVersionSummary[];
  loading: boolean;
  unavailable: boolean;
  onRestore: (revision: number) => Promise<void>;
}) {
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restoreSelected() {
    if (selectedRevision === null) return;
    setPending(true);
    setError(null);
    try {
      await onRestore(selectedRevision);
      setSelectedRevision(null);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Forge could not restore that flow version."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="workbench-flow-version-history-title"
      className="grid gap-4 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5"
    >
      <div className="flex items-start gap-3">
        <History aria-hidden="true" className="mt-1 size-5" />
        <div>
          <h2
            id="workbench-flow-version-history-title"
            className="font-display text-xl text-[var(--ui-ink-strong)]"
          >
            Version history
          </h2>
          <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            Every accepted save creates a revision. Restoring keeps the current
            history and creates another revision.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ui-ink-soft)]">Loading versions…</p>
      ) : unavailable ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          Version history is unavailable. The flow remains editable.
        </p>
      ) : (
        <ol className="grid gap-2">
          {versions.map((version) => {
            const isCurrent = version.revision === currentRevision;
            return (
              <li
                key={version.revision}
                className="flex flex-col gap-3 rounded-2xl border border-[var(--ui-border-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-[var(--ui-ink-strong)]">
                    Version {version.revision}
                    {isCurrent ? " · Current" : ""}
                  </p>
                  <p className="text-sm text-[var(--ui-ink-soft)]">
                    {describeVersion(version)}
                  </p>
                </div>
                {!isCurrent ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => {
                      setSelectedRevision(version.revision);
                      setError(null);
                    }}
                  >
                    <RotateCcw aria-hidden="true" className="size-4" />
                    Restore version {version.revision}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {selectedRevision !== null ? (
        <div
          role="alertdialog"
          aria-labelledby="workbench-flow-restore-title"
          className="grid gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--ui-warning-soft)] p-4"
        >
          <div>
            <h3
              id="workbench-flow-restore-title"
              className="font-medium text-[var(--ui-ink-strong)]"
            >
              Restore version {selectedRevision}?
            </h3>
            <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
              Forge will create version {currentRevision + 1}. It will not erase
              the current revision.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              className="min-h-11"
              pending={pending}
              pendingLabel="Restoring…"
              onClick={() => void restoreSelected()}
            >
              Confirm restore
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={() => setSelectedRevision(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
