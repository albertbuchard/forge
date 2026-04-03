import { useMemo, useState, type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, Search, Trash2 } from "lucide-react";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/page-state";
import { deleteEntities, ensureOperatorSession, getSettingsBin, restoreEntities } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CrudEntityType, DeletedEntityRecord } from "@/lib/types";

const ENTITY_LABELS: Record<CrudEntityType, string> = {
  goal: "Goals",
  project: "Projects",
  task: "Tasks",
  habit: "Habits",
  tag: "Tags",
  note: "Notes",
  insight: "Insights",
  psyche_value: "Values",
  behavior_pattern: "Patterns",
  behavior: "Behaviors",
  belief_entry: "Beliefs",
  mode_profile: "Modes",
  mode_guide_session: "Mode guides",
  event_type: "Event types",
  emotion_definition: "Emotions",
  trigger_report: "Reports",
  calendar_event: "Calendar events",
  work_block_template: "Work blocks",
  task_timebox: "Timeboxes"
};

const ENTITY_BADGE_KIND: Record<CrudEntityType, ComponentProps<typeof EntityBadge>["kind"] | null> = {
  goal: "goal",
  project: "project",
  task: "task",
  habit: "habit",
  tag: null,
  note: null,
  insight: "report",
  psyche_value: "value",
  behavior_pattern: "pattern",
  behavior: "behavior",
  belief_entry: "belief",
  mode_profile: "mode",
  mode_guide_session: "mode",
  event_type: null,
  emotion_definition: null,
  trigger_report: "report",
  calendar_event: null,
  work_block_template: null,
  task_timebox: null
};

function formatDeletedAt(value: string) {
  return new Date(value).toLocaleString();
}

export function SettingsBinPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedEntityTypes, setSelectedEntityTypes] = useState<CrudEntityType[]>([]);

  const operatorSessionQuery = useQuery({
    queryKey: ["forge-operator-session"],
    queryFn: ensureOperatorSession
  });
  const operatorReady = operatorSessionQuery.isSuccess;

  const binQuery = useQuery({
    queryKey: ["forge-settings-bin"],
    queryFn: getSettingsBin,
    enabled: operatorReady
  });

  const invalidateBin = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("forge-")
    });
  };

  const restoreMutation = useMutation({
    mutationFn: (record: DeletedEntityRecord) =>
      restoreEntities({
        operations: [{ entityType: record.entityType, id: record.entityId }]
      }),
    onSuccess: invalidateBin
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (record: DeletedEntityRecord) =>
      deleteEntities({
        operations: [{ entityType: record.entityType, id: record.entityId, mode: "hard" }]
      }),
    onSuccess: invalidateBin
  });

  const bulkRestoreMutation = useMutation({
    mutationFn: (items: DeletedEntityRecord[]) =>
      restoreEntities({
        operations: items.map((record) => ({ entityType: record.entityType, id: record.entityId }))
      }),
    onSuccess: invalidateBin
  });

  const bulkHardDeleteMutation = useMutation({
    mutationFn: (items: DeletedEntityRecord[]) =>
      deleteEntities({
        operations: items.map((record) => ({ entityType: record.entityType, id: record.entityId, mode: "hard" as const }))
      }),
    onSuccess: invalidateBin
  });

  const records = binQuery.data?.bin.records ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const entityTypeMatch = selectedEntityTypes.length === 0 || selectedEntityTypes.includes(record.entityType);
      if (!entityTypeMatch) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        record.title,
        record.subtitle ?? "",
        record.entityType,
        record.entityId,
        record.deletedByActor ?? "",
        record.deletedSource ?? "",
        record.deleteReason ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, records, selectedEntityTypes]);
  const groupedRecords = useMemo(() => {
    const grouped = new Map<CrudEntityType, DeletedEntityRecord[]>();
    for (const record of filteredRecords) {
      const list = grouped.get(record.entityType) ?? [];
      list.push(record);
      grouped.set(record.entityType, list);
    }
    return [...grouped.entries()].sort((a, b) => ENTITY_LABELS[a[0]].localeCompare(ENTITY_LABELS[b[0]]));
  }, [filteredRecords]);
  const availableEntityTypes = useMemo(
    () =>
      [...new Set(records.map((record) => record.entityType))].sort((left, right) => ENTITY_LABELS[left].localeCompare(ENTITY_LABELS[right])),
    [records]
  );

  function toggleEntityType(entityType: CrudEntityType) {
    setSelectedEntityTypes((current) =>
      current.includes(entityType) ? current.filter((entry) => entry !== entityType) : [...current, entityType]
    );
  }

  async function hardDeleteVisible() {
    if (filteredRecords.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Permanently delete ${filteredRecords.length} item${filteredRecords.length === 1 ? "" : "s"} from the bin? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    await bulkHardDeleteMutation.mutateAsync(filteredRecords);
  }

  if (operatorSessionQuery.isLoading || binQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Settings"
        title="Loading bin"
        description="Loading deleted items and restore controls."
        columns={2}
        blocks={6}
      />
    );
  }

  if (operatorSessionQuery.isError) {
    return <ErrorState eyebrow="Settings" error={operatorSessionQuery.error} onRetry={() => void operatorSessionQuery.refetch()} />;
  }

  if (binQuery.isError) {
    return <ErrorState eyebrow="Settings" error={binQuery.error} onRetry={() => void binQuery.refetch()} />;
  }

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Bin"
        description="Restore soft-deleted items or permanently remove them when you really mean it."
        badge={`${binQuery.data?.bin.totalCount ?? 0} deleted items`}
      />

      <SettingsSectionNav />

      <Card className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="grid gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Find deleted items</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, id, reason, or source" className="pl-11" />
            </div>
            <div className="flex flex-wrap gap-2">
              {availableEntityTypes.map((entityType) => {
                const active = selectedEntityTypes.includes(entityType);
                return (
                  <button
                    key={entityType}
                    type="button"
                    onClick={() => toggleEntityType(entityType)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
                      active
                        ? "border-[var(--primary)]/30 bg-[var(--primary)]/[0.16] text-[var(--primary)]"
                        : "border-white/10 bg-white/[0.04] text-white/58 hover:bg-white/[0.08] hover:text-white"
                    )}
                  >
                    {ENTITY_LABELS[entityType]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:max-w-[22rem] lg:justify-end">
            <Button
              variant="secondary"
              size="sm"
              disabled={filteredRecords.length === 0}
              pending={bulkRestoreMutation.isPending}
              pendingLabel="Restoring"
              onClick={() => void bulkRestoreMutation.mutateAsync(filteredRecords)}
            >
              <ArchiveRestore className="size-4" />
              <span>Restore visible</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={filteredRecords.length === 0}
              pending={bulkHardDeleteMutation.isPending}
              pendingLabel="Deleting"
              onClick={() => void hardDeleteVisible()}
            >
              <Trash2 className="size-4" />
              <span>Delete visible forever</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-white/55">
          <span>{filteredRecords.length} visible</span>
          {selectedEntityTypes.length > 0 ? <span>{selectedEntityTypes.length} type filters active</span> : null}
          {normalizedQuery ? <span>Search: “{query.trim()}”</span> : null}
        </div>
      </Card>

      {records.length === 0 ? (
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Deleted items</div>
          <div className="mt-4 text-white/72">Nothing is in the bin right now.</div>
        </Card>
      ) : groupedRecords.length === 0 ? (
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Deleted items</div>
          <div className="mt-4 text-white/72">No deleted items match the current search or filters.</div>
        </Card>
      ) : (
        <div className="grid gap-5">
          {groupedRecords.map(([entityType, items]) => {
            const badgeKind = ENTITY_BADGE_KIND[entityType];
            return (
              <Card key={entityType}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {badgeKind ? <EntityBadge kind={badgeKind} label={ENTITY_LABELS[entityType]} compact /> : null}
                    {!badgeKind ? (
                      <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/55">
                        {ENTITY_LABELS[entityType]}
                      </div>
                    ) : null}
                    <div className="text-sm text-white/55">{items.length} deleted</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {items.map((record) => (
                    <div
                      key={`${record.entityType}:${record.entityId}`}
                      className="grid gap-3 rounded-[22px] border border-white/8 bg-white/[0.04] p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="text-lg font-medium text-white">{record.title}</div>
                        {record.subtitle ? <div className="mt-1 text-sm text-white/62">{record.subtitle}</div> : null}
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/45">
                          <span>Deleted {formatDeletedAt(record.deletedAt)}</span>
                          {record.deletedByActor ? <span>By {record.deletedByActor}</span> : null}
                          {record.deletedSource ? <span>Source {record.deletedSource}</span> : null}
                          {record.deleteReason ? <span>Reason: {record.deleteReason}</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-start justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          pending={restoreMutation.isPending}
                          pendingLabel="Restoring"
                          onClick={() => void restoreMutation.mutateAsync(record)}
                        >
                          <ArchiveRestore className="size-4" />
                          <span>Restore</span>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          pending={hardDeleteMutation.isPending}
                          pendingLabel="Deleting"
                          onClick={() => void hardDeleteMutation.mutateAsync(record)}
                        >
                          <Trash2 className="size-4" />
                          <span>Delete forever</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
