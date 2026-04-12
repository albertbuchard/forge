import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  Database,
  Download,
  FolderSearch,
  HardDrive,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MetricTile } from "@/components/ui/metric-tile";
import { ErrorState } from "@/components/ui/page-state";
import {
  createRuntimeDataBackup,
  downloadDataExport,
  ensureOperatorSession,
  getDataManagementState,
  patchDataManagementSettings,
  restoreRuntimeDataBackup,
  scanDataRecoveryCandidates,
  switchRuntimeDataRoot
} from "@/lib/api";
import type {
  DataBackupEntry,
  DataExportFormat,
  DataRecoveryCandidate,
  DataRootSwitchMode
} from "@/lib/data-management-types";
import { cn, formatDateTime } from "@/lib/utils";

type FeedbackTone = "neutral" | "success" | "warning";

type RootSwitchFlowValue = {
  mode: DataRootSwitchMode;
  targetDataRoot: string;
  createSafetyBackup: boolean;
};

type RestoreFlowValue = {
  createSafetyBackup: boolean;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatBackupFrequency(hours: number | null) {
  if (!hours) {
    return "Off";
  }
  if (hours === 1) {
    return "Every hour";
  }
  if (hours === 24) {
    return "Every day";
  }
  if (hours === 168) {
    return "Every week";
  }
  return `Every ${hours} hours`;
}

function formatBackupMode(mode: DataBackupEntry["mode"]) {
  switch (mode) {
    case "manual":
      return "Manual";
    case "automatic":
      return "Automatic";
    case "pre_restore":
      return "Safety backup before restore";
    case "pre_switch_root":
      return "Safety backup before folder change";
    default:
      return mode;
  }
}

function FeedbackBanner({
  tone,
  message
}: {
  tone: FeedbackTone;
  message: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] border px-4 py-3 text-sm leading-6",
        tone === "success"
          ? "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-100/88"
          : tone === "warning"
            ? "border-amber-400/20 bg-amber-500/[0.08] text-amber-100/88"
            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)]"
      )}
    >
      {message}
    </div>
  );
}

function DataFact({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof Database;
}) {
  return (
    <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="mt-3 break-all text-sm leading-6 text-[var(--ui-ink-soft)]">
        {value}
      </div>
    </div>
  );
}

export function SettingsDataPage() {
  const queryClient = useQueryClient();
  const [backupDirectory, setBackupDirectory] = useState("");
  const [backupFrequency, setBackupFrequency] = useState<string>("24");
  const [autoRepairEnabled, setAutoRepairEnabled] = useState(true);
  const [scanResults, setScanResults] = useState<DataRecoveryCandidate[]>([]);
  const [feedback, setFeedback] = useState<{
    tone: FeedbackTone;
    message: string;
  } | null>(null);
  const [rootDialogOpen, setRootDialogOpen] = useState(false);
  const [rootFlowValue, setRootFlowValue] = useState<RootSwitchFlowValue>({
    mode: "migrate_current",
    targetDataRoot: "",
    createSafetyBackup: true
  });
  const [rootDialogError, setRootDialogError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DataBackupEntry | null>(null);
  const [restoreFlowValue, setRestoreFlowValue] = useState<RestoreFlowValue>({
    createSafetyBackup: true
  });
  const [restoreDialogError, setRestoreDialogError] = useState<string | null>(null);

  const operatorSessionQuery = useQuery({
    queryKey: ["forge-operator-session"],
    queryFn: ensureOperatorSession
  });
  const operatorReady = operatorSessionQuery.isSuccess;

  const dataQuery = useQuery({
    queryKey: ["forge-data-management"],
    queryFn: getDataManagementState,
    enabled: operatorReady
  });

  const invalidateData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-operator-session"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-data-management"] })
    ]);
  };

  const savePolicyMutation = useMutation({
    mutationFn: () =>
      patchDataManagementSettings({
        backupDirectory,
        backupFrequencyHours:
          backupFrequency === "off" ? null : Number(backupFrequency),
        autoRepairEnabled
      }),
    onSuccess: async () => {
      setFeedback({
        tone: "success",
        message: "Backup settings saved."
      });
      await invalidateData();
    }
  });

  const backupMutation = useMutation({
    mutationFn: () => createRuntimeDataBackup("Manual backup from Settings → Data"),
    onSuccess: async () => {
      setFeedback({
        tone: "success",
        message: "Backup created."
      });
      await invalidateData();
    }
  });

  const scanMutation = useMutation({
    mutationFn: scanDataRecoveryCandidates,
    onSuccess: ({ candidates }) => {
      setScanResults(candidates);
      setFeedback({
        tone: candidates.some((candidate) => candidate.newerThanCurrent)
          ? "warning"
          : "neutral",
        message:
          candidates.length > 0
            ? `Found ${candidates.length} Forge ${candidates.length === 1 ? "copy" : "copies"} on disk.`
            : "No other Forge data copies were found in the scanned folders."
      });
    }
  });

  const switchRootMutation = useMutation({
    mutationFn: (value: RootSwitchFlowValue) =>
      switchRuntimeDataRoot({
        targetDataRoot: value.targetDataRoot,
        mode: value.mode,
        createSafetyBackup: value.createSafetyBackup
      }),
    onSuccess: async () => {
      setFeedback({
        tone: "success",
        message: "Forge is now using the selected data folder."
      });
      setRootDialogOpen(false);
      await invalidateData();
    }
  });

  const restoreMutation = useMutation({
    mutationFn: ({
      backupId,
      createSafetyBackup
    }: {
      backupId: string;
      createSafetyBackup: boolean;
    }) => restoreRuntimeDataBackup(backupId, createSafetyBackup),
    onSuccess: async () => {
      setFeedback({
        tone: "success",
        message: "Backup restored. Forge is now running from that restored state."
      });
      setRestoreTarget(null);
      await invalidateData();
    }
  });

  const exportMutation = useMutation({
    mutationFn: async (format: DataExportFormat) => {
      const result = await downloadDataExport(format);
      downloadBlob(result.blob, result.fileName ?? `forge-export.${format}`);
      return format;
    },
    onSuccess: (format) => {
      setFeedback({
        tone: "neutral",
        message: `Started download for ${format}.`
      });
    }
  });

  const data = dataQuery.data?.data;

  useEffect(() => {
    if (!data) {
      return;
    }
    setBackupDirectory((current) => current || data.settings.backupDirectory);
    setBackupFrequency((current) =>
      current || (data.settings.backupFrequencyHours ? String(data.settings.backupFrequencyHours) : "off")
    );
    setAutoRepairEnabled(data.settings.autoRepairEnabled);
    setRootFlowValue((current) => ({
      ...current,
      targetDataRoot: current.targetDataRoot || data.current.dataRoot
    }));
  }, [data]);

  const newestCandidate = useMemo(
    () => scanResults.find((candidate) => candidate.newerThanCurrent),
    [scanResults]
  );
  const selectedTargetCandidate = useMemo(() => {
    return scanResults.find(
      (candidate) => candidate.dataRoot === rootFlowValue.targetDataRoot.trim()
    );
  }, [rootFlowValue.targetDataRoot, scanResults]);

  const rootFlowSteps: Array<QuestionFlowStep<RootSwitchFlowValue>> = [
    {
      id: "mode",
      eyebrow: "Step 1",
      title: "What do you want Forge to do?",
      description:
        "Choose whether Forge should move the current data into a new folder or switch to a folder that already contains the right Forge data.",
      render: (value, setValue) => (
        <div className="grid gap-4">
          <FlowChoiceGrid
            value={value.mode}
            onChange={(mode) =>
              setValue({ mode: mode as DataRootSwitchMode })
            }
            options={[
              {
                value: "migrate_current",
                label: "Move the current data",
                description:
                  "Copy the live database, wiki files, and local secrets key into a new folder, then switch Forge to it."
              },
              {
                value: "adopt_existing",
                label: "Use an existing data folder",
                description:
                  "Keep the target folder as it is and point Forge at that existing database directly."
              }
            ]}
          />
          <label className="flex items-start gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.createSafetyBackup}
              onChange={(event) =>
                setValue({ createSafetyBackup: event.target.checked })
              }
            />
            <span className="text-sm leading-6 text-[var(--ui-ink-soft)]">
              Create one safety backup first.
            </span>
          </label>
        </div>
      )
    },
    {
      id: "folder",
      eyebrow: "Step 2",
      title:
        rootFlowValue.mode === "migrate_current"
          ? "Choose the new data folder"
          : "Choose the data folder to use",
      description:
        rootFlowValue.mode === "migrate_current"
          ? "Pick an empty folder for the moved Forge data."
          : "Pick the folder that already contains the Forge data you trust.",
      render: (value, setValue) => (
        <div className="grid gap-4">
          <FlowField
            label="Data folder"
            description="Forge will place or read the database, wiki files, and backups from here."
          >
            <Input
              value={value.targetDataRoot}
              onChange={(event) =>
                setValue({ targetDataRoot: event.target.value })
              }
              placeholder="/absolute/path/to/forge-data"
            />
          </FlowField>

          {selectedTargetCandidate ? (
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
              <div className="font-medium text-[var(--ui-ink-strong)]">
                Found on this machine
              </div>
              <div className="mt-2 break-all">
                {selectedTargetCandidate.databasePath}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/78">
                  {selectedTargetCandidate.sourceHint}
                </Badge>
                <Badge className="bg-white/[0.08] text-white/78">
                  {selectedTargetCandidate.counts.notes} notes
                </Badge>
                <Badge className="bg-white/[0.08] text-white/78">
                  {selectedTargetCandidate.counts.tasks} tasks
                </Badge>
                {selectedTargetCandidate.newerThanCurrent ? (
                  <Badge className="bg-amber-500/16 text-amber-100">
                    Newer than the current copy
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {rootFlowValue.mode === "migrate_current"
                ? "Forge will copy the current data into this folder and then switch over."
                : "If this folder already holds a Forge database, Forge will start using it after you confirm."}
            </div>
          )}
        </div>
      )
    }
  ];

  const restoreFlowSteps: Array<QuestionFlowStep<RestoreFlowValue>> = [
    {
      id: "review",
      eyebrow: "Step 1",
      title: "Review the backup you want to restore",
      description:
        "Restoring replaces the current database and wiki files with the selected backup.",
      render: (value, setValue) => (
        <div className="grid gap-4">
          <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
            <div className="font-medium text-[var(--ui-ink-strong)]">
              {restoreTarget ? formatDateTime(restoreTarget.createdAt) : "Selected backup"}
            </div>
            <div className="mt-2">
              {restoreTarget?.note || "Forge backup archive"}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className="bg-white/[0.08] text-white/78">
                {restoreTarget ? formatBackupMode(restoreTarget.mode) : "Backup"}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/78">
                {restoreTarget ? formatBytes(restoreTarget.sizeBytes) : "0 B"}
              </Badge>
              {restoreTarget?.includesWiki ? (
                <Badge className="bg-white/[0.08] text-white/78">
                  Includes wiki
                </Badge>
              ) : null}
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.createSafetyBackup}
              onChange={(event) =>
                setValue({ createSafetyBackup: event.target.checked })
              }
            />
            <span className="text-sm leading-6 text-[var(--ui-ink-soft)]">
              Create one safety backup of the current state first.
            </span>
          </label>
        </div>
      )
    },
    {
      id: "confirm",
      eyebrow: "Step 2",
      title: "Confirm the restore",
      description:
        "Use this only when you are confident this backup is the state you want back.",
      render: () => (
        <div className="rounded-[22px] border border-amber-400/20 bg-amber-500/[0.08] p-4 text-sm leading-6 text-amber-100/88">
          Forge will replace the live database and wiki files with this backup, then reopen the restored copy.
        </div>
      )
    }
  ];

  if (operatorSessionQuery.isLoading || dataQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Data"
        title="Loading data controls"
        description="Checking the live data folder, backup plan, and recovery tools."
        columns={3}
        blocks={6}
      />
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <ErrorState
        eyebrow="Data"
        error={operatorSessionQuery.error}
        onRetry={() => void operatorSessionQuery.refetch()}
      />
    );
  }

  if (dataQuery.isError || !data) {
    return (
      <ErrorState
        eyebrow="Data"
        error={dataQuery.error ?? new Error("Forge returned an empty data payload.")}
        onRetry={() => void dataQuery.refetch()}
      />
    );
  }

  const current = data.current;

  return (
    <>
      <div className="mx-auto grid w-full max-w-[1480px] gap-5">
        <PageHero
          eyebrow="Data, backups, recovery"
          title="Data"
          description="See where Forge is saving the live data, keep it protected with backups, look for a newer copy on disk if something goes wrong, and download the database or its structure when you need it."
          badge={`${current.integrityOk ? "Healthy" : "Needs attention"} · ${formatBytes(current.databaseSizeBytes)}`}
          actions={
            <>
              <Button
                variant="secondary"
                pending={scanMutation.isPending}
                pendingLabel="Scanning"
                onClick={() => void scanMutation.mutateAsync()}
              >
                <FolderSearch className="size-4" />
                Look for other Forge copies
              </Button>
              <Button
                pending={backupMutation.isPending}
                pendingLabel="Creating backup"
                onClick={() => void backupMutation.mutateAsync()}
              >
                <Archive className="size-4" />
                Create backup now
              </Button>
            </>
          }
        />

        <SettingsSectionNav />

        {operatorSessionQuery.data?.session ? (
          <div className="rounded-[20px] border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-100/88">
            You are managing Forge data as{" "}
            <span className="font-medium text-white">
              {operatorSessionQuery.data.session.actorLabel}
            </span>
            .
          </div>
        ) : null}

        {feedback ? (
          <FeedbackBanner tone={feedback.tone} message={feedback.message} />
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <Card className="grid gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Live data folder
                </div>
                <div className="mt-2 text-xl font-semibold text-[var(--ui-ink-strong)]">
                  {current.dataRoot}
                </div>
                <div className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                  This is the folder Forge is reading and writing right now.
                </div>
              </div>
              <Badge
                className={cn(
                  current.integrityOk
                    ? "bg-emerald-500/14 text-emerald-100"
                    : "bg-amber-500/14 text-amber-100"
                )}
              >
                {current.integrityMessage}
              </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DataFact
                label="Database file"
                value={current.databasePath}
                icon={Database}
              />
              <DataFact
                label="Folder layout"
                value={current.layout}
                icon={HardDrive}
              />
              <DataFact
                label="Last database change"
                value={
                  current.databaseLastModifiedAt
                    ? formatDateTime(current.databaseLastModifiedAt)
                    : "Unknown"
                }
                icon={RefreshCw}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <MetricTile label="Notes" value={current.counts.notes} />
              <MetricTile label="Goals" value={current.counts.goals} />
              <MetricTile label="Projects" value={current.counts.projects} />
              <MetricTile label="Tasks" value={current.counts.tasks} />
              <MetricTile label="Runs" value={current.counts.taskRuns} />
              <MetricTile label="Tags" value={current.counts.tags} />
            </div>
          </Card>

          <Card className="grid gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.12]">
                <ShieldCheck className="size-5 text-emerald-200" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                  Protection plan
                </div>
                <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Choose where backups go, how often Forge creates them, and whether scans should call out newer copies found elsewhere on disk.
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <MetricTile
                label="Automatic backup"
                value={formatBackupFrequency(data.settings.backupFrequencyHours)}
                detail={
                  data.settings.lastAutoBackupAt
                    ? `Last run ${formatDateTime(data.settings.lastAutoBackupAt)}`
                    : "No automatic backup recorded yet"
                }
              />
              <MetricTile
                label="Manual backup"
                value={
                  data.settings.lastManualBackupAt
                    ? formatDateTime(data.settings.lastManualBackupAt)
                    : "None yet"
                }
                detail={`${data.backups.length} backup${data.backups.length === 1 ? "" : "s"} saved`}
              />
            </div>

            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Backup folder
                </span>
                <Input
                  value={backupDirectory}
                  onChange={(event) => setBackupDirectory(event.target.value)}
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Automatic backup
                </span>
                <select
                  className="h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[var(--primary)]"
                  value={backupFrequency}
                  onChange={(event) => setBackupFrequency(event.target.value)}
                >
                  <option value="off">Off</option>
                  <option value="1">Every hour</option>
                  <option value="6">Every 6 hours</option>
                  <option value="24">Every day</option>
                  <option value="168">Every week</option>
                </select>
              </label>

              <label className="flex items-start gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={autoRepairEnabled}
                  onChange={(event) => setAutoRepairEnabled(event.target.checked)}
                />
                <span className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  When I scan, point out Forge copies that look newer than the one I am using now.
                </span>
              </label>

              <div className="flex flex-wrap gap-3">
                <Button
                  pending={savePolicyMutation.isPending}
                  pendingLabel="Saving"
                  onClick={() => void savePolicyMutation.mutateAsync()}
                >
                  Save backup settings
                </Button>
                <Button
                  variant="secondary"
                  pending={backupMutation.isPending}
                  pendingLabel="Creating backup"
                  onClick={() => void backupMutation.mutateAsync()}
                >
                  Create backup now
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="grid gap-4">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Change data folder
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Move today’s Forge data into a new folder, or switch to another folder that already contains the right Forge database.
              </div>
            </div>

            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
              <div className="font-medium text-[var(--ui-ink-strong)]">
                Current folder
              </div>
              <div className="mt-2 break-all">{current.dataRoot}</div>
              {selectedTargetCandidate ? (
                <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                  Selected scanned copy: {selectedTargetCandidate.dataRoot}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setRootFlowValue((currentValue) => ({
                    ...currentValue,
                    mode: "migrate_current",
                    targetDataRoot:
                      currentValue.targetDataRoot || current.dataRoot
                  }));
                  setRootDialogError(null);
                  setRootDialogOpen(true);
                }}
              >
                <HardDrive className="size-4" />
                Move current data
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setRootFlowValue((currentValue) => ({
                    ...currentValue,
                    mode: "adopt_existing",
                    targetDataRoot:
                      currentValue.targetDataRoot || current.dataRoot
                  }));
                  setRootDialogError(null);
                  setRootDialogOpen(true);
                }}
              >
                <RefreshCw className="size-4" />
                Use existing data folder
              </Button>
            </div>
          </Card>

          <Card className="grid gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Downloads
                </div>
                <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Download the live database itself, or export a structure and table snapshot in other formats.
                </div>
              </div>
              <Download className="size-5 text-[var(--ui-ink-faint)]" />
            </div>

            <div className="grid gap-3">
              {data.exportOptions.map((option) => (
                <div
                  key={option.format}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                      {option.label}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {option.description}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    pending={exportMutation.isPending}
                    pendingLabel="Preparing"
                    onClick={() => void exportMutation.mutateAsync(option.format)}
                  >
                    Download
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <Card className="grid gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Backup history
                </div>
                <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Go back to an older saved state if you need to undo a bad change.
                </div>
              </div>
              <Archive className="size-5 text-[var(--ui-ink-faint)]" />
            </div>
            <div className="grid gap-3">
              {data.backups.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-6 text-sm text-[var(--ui-ink-soft)]">
                  No backups yet. Create one now so you have a safe restore point.
                </div>
              ) : (
                data.backups.map((backup) => (
                  <div
                    key={backup.id}
                    className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                            {formatDateTime(backup.createdAt)}
                          </div>
                          <Badge className="bg-white/[0.08] text-white/78">
                            {formatBackupMode(backup.mode)}
                          </Badge>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                          {backup.note || "Forge backup archive"}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setRestoreFlowValue({ createSafetyBackup: true });
                          setRestoreDialogError(null);
                          setRestoreTarget(backup);
                        }}
                      >
                        Restore
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-[var(--ui-ink-faint)] md:grid-cols-2">
                      <div className="break-all">{backup.archivePath}</div>
                      <div>{formatBytes(backup.sizeBytes)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="grid gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Find other Forge copies
                </div>
                <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Search common folders on this machine for other Forge databases. Use this when Forge opened the wrong copy or when you think a newer copy exists somewhere else.
                </div>
              </div>
              <Button
                variant="secondary"
                pending={scanMutation.isPending}
                pendingLabel="Scanning"
                onClick={() => void scanMutation.mutateAsync()}
              >
                <FolderSearch className="size-4" />
                Scan now
              </Button>
            </div>

            <div className="grid gap-3">
              {scanResults.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-6 text-sm text-[var(--ui-ink-soft)]">
                  No scan results yet. Run a scan to compare the live data folder with other Forge copies on disk.
                </div>
              ) : (
                scanResults.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={cn(
                      "rounded-[22px] border p-4",
                      candidate.sameAsCurrent
                        ? "border-emerald-400/18 bg-emerald-500/[0.08]"
                        : candidate.newerThanCurrent
                          ? "border-amber-400/20 bg-amber-500/[0.08]"
                          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                            {candidate.dataRoot}
                          </div>
                          <Badge className="bg-white/[0.08] text-white/78">
                            {candidate.sourceHint}
                          </Badge>
                          {candidate.newerThanCurrent ? (
                            <Badge className="bg-amber-500/16 text-amber-100">
                              Newer than current
                            </Badge>
                          ) : null}
                          {candidate.sameAsCurrent ? (
                            <Badge className="bg-emerald-500/16 text-emerald-100">
                              Current copy
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-2 break-all text-sm text-[var(--ui-ink-soft)]">
                          {candidate.databasePath}
                        </div>
                      </div>
                      {!candidate.sameAsCurrent ? (
                        <Button
                          variant="secondary"
                        onClick={() => {
                          setRootFlowValue({
                            mode: "adopt_existing",
                            targetDataRoot: candidate.dataRoot,
                            createSafetyBackup: true
                          });
                          setRootDialogError(null);
                          setRootDialogOpen(true);
                        }}
                        >
                          Use this folder
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-[var(--ui-ink-faint)] md:grid-cols-5">
                      <div>{candidate.integrityMessage}</div>
                      <div>
                        {formatDateTime(
                          candidate.databaseLastModifiedAt ??
                            new Date().toISOString()
                        )}
                      </div>
                      <div>{formatBytes(candidate.databaseSizeBytes)}</div>
                      <div>{candidate.counts.notes} notes</div>
                      <div>{candidate.counts.tasks} tasks</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {newestCandidate ? (
              <div className="flex items-start gap-3 rounded-[20px] border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-100/88">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  Forge found a copy on disk that looks newer than the one you are using now. Review it carefully before switching.
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      <QuestionFlowDialog
        open={rootDialogOpen}
        onOpenChange={(open) => {
          setRootDialogOpen(open);
          if (!open) {
            setRootDialogError(null);
          }
        }}
        eyebrow="Data folder"
        title={
          rootFlowValue.mode === "migrate_current"
            ? "Move Forge data"
            : "Use an existing Forge data folder"
        }
        description="This guided flow keeps the folder change explicit and gives you a safety backup option first."
        value={rootFlowValue}
        onChange={setRootFlowValue}
        steps={rootFlowSteps}
        pending={switchRootMutation.isPending}
        pendingLabel={
          rootFlowValue.mode === "migrate_current" ? "Moving data" : "Switching folder"
        }
        submitLabel={
          rootFlowValue.mode === "migrate_current"
            ? "Move and switch"
            : "Use this folder"
        }
        error={
          rootDialogError ??
          (switchRootMutation.error instanceof Error
            ? switchRootMutation.error.message
            : null)
        }
        onSubmit={async () => {
          if (!rootFlowValue.targetDataRoot.trim()) {
            setRootDialogError("Choose a data folder first.");
            return;
          }
          setRootDialogError(null);
          await switchRootMutation.mutateAsync(rootFlowValue);
        }}
      />

      <QuestionFlowDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTarget(null);
            setRestoreDialogError(null);
          }
        }}
        eyebrow="Restore backup"
        title="Restore Forge backup"
        description="This flow replaces the live data with an older saved state."
        value={restoreFlowValue}
        onChange={setRestoreFlowValue}
        steps={restoreFlowSteps}
        pending={restoreMutation.isPending}
        pendingLabel="Restoring"
        submitLabel="Restore this backup"
        error={
          restoreDialogError ??
          (restoreMutation.error instanceof Error
            ? restoreMutation.error.message
            : null)
        }
        onSubmit={async () => {
          if (!restoreTarget) {
            setRestoreDialogError("Choose a backup first.");
            return;
          }
          setRestoreDialogError(null);
          await restoreMutation.mutateAsync({
            backupId: restoreTarget.id,
            createSafetyBackup: restoreFlowValue.createSafetyBackup
          });
        }}
      />
    </>
  );
}
