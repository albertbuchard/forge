import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Download,
  Eye,
  FileJson,
  GalleryVerticalEnd,
  Inbox,
  Laptop,
  PackageCheck,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { DistributionCenter } from "@/components/distribution-center";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  commitLaunchpadImport,
  decideLaunchpadReview,
  deleteLaunchpadFeedback,
  getLaunchpadFeedback,
  getLaunchpadOnboarding,
  installLaunchpadPackage,
  listLaunchpadImports,
  listLaunchpadPackageInstalls,
  listLaunchpadPackages,
  listLaunchpadReviews,
  previewLaunchpadImport,
  previewLaunchpadPackage,
  removeLaunchpadPackageInstall,
  rollbackLaunchpadImport,
  updateLaunchpadFeedback,
  updateLaunchpadOnboarding
} from "@/lib/api";
import type {
  ProductImportItem,
  ProductImportPreview,
  ProductImportSource,
  ProductOutcomeKey,
  ProductPackage,
  ProductPackagePreview,
  ProductReviewItem
} from "@/lib/product-launchpad-types";
import { cn } from "@/lib/utils";

type LaunchpadTab = "outcomes" | "imports" | "gallery" | "reviews" | "privacy" | "distribution";

const TABS: Array<{ key: LaunchpadTab; label: string; icon: typeof Rocket }> = [
  { key: "outcomes", label: "Outcomes", icon: Rocket },
  { key: "imports", label: "Import", icon: Upload },
  { key: "gallery", label: "Gallery", icon: GalleryVerticalEnd },
  { key: "reviews", label: "Review queue", icon: Inbox },
  { key: "privacy", label: "Privacy feedback", icon: ShieldCheck },
  { key: "distribution", label: "Install & update", icon: Laptop }
];

const OUTCOME_COPY: Record<
  ProductOutcomeKey,
  { title: string; description: string }
> = {
  plan_week: {
    title: "Plan a useful week",
    description: "Choose the result that matters, protect time for it, and close the loop."
  },
  daily_reflection: {
    title: "Build a daily reflection loop",
    description: "Create one small reflection habit and one reusable prompt."
  },
  research_project: {
    title: "Start a research project",
    description: "Move from a precise question through evidence to a defensible synthesis."
  }
};

function reviewActionLabels(item: ProductReviewItem) {
  switch (item.kind) {
    case "relationship_proposal":
      return { accept: "Create link", reject: "Reject link" };
    case "agent_proposal":
      return { accept: "Approve action", reject: "Reject action" };
    case "artifact_enrichment":
      return { accept: "Apply metadata", reject: "Reject metadata" };
    default:
      return { accept: "Accept", reject: "Dismiss" };
  }
}

function reviewEvidenceSummary(item: ProductReviewItem) {
  const evidenceCount = item.evidence.length;
  const action = Object.entries(item.proposedAction)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .slice(0, 3)
    .map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()}: ${String(value)}`)
    .join(" · ");
  return [action, evidenceCount > 0 ? `${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");
}

const IMPORT_SOURCES: Array<{ value: ProductImportSource; label: string }> = [
  { value: "markdown", label: "Markdown" },
  { value: "obsidian", label: "Obsidian" },
  { value: "notion", label: "Notion" },
  { value: "todoist", label: "Todoist" },
  { value: "apple_reminders", label: "Apple Reminders" },
  { value: "calendar", label: "Calendar" },
  { value: "github_issues", label: "GitHub Issues" },
  { value: "linear", label: "Linear" }
];

function readString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeImportRecord(
  value: unknown,
  index: number,
  source: ProductImportSource
): ProductImportItem {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { content: String(value ?? "") };
  const content = readString(record, "content", "body", "description", "text") ?? "";
  const firstLine = content.split(/\r?\n/u).find((line) => line.trim())?.trim();
  const defaultType =
    source === "calendar"
      ? "calendar_event"
      : source === "markdown" || source === "obsidian" || source === "notion"
        ? "note"
        : "task";
  const rawType = readString(record, "recordType", "record_type", "type");
  const recordType = ["note", "task", "calendar_event"].includes(rawType ?? "")
    ? (rawType as ProductImportItem["recordType"])
    : defaultType;
  return {
    sourceId:
      readString(record, "sourceId", "source_id", "id", "path", "url") ??
      `${source}-${index + 1}`,
    recordType,
    title:
      readString(record, "title", "name", "summary") ??
      firstLine?.replace(/^#+\s*/u, "").slice(0, 240) ??
      `Imported ${recordType.replace("_", " ")} ${index + 1}`,
    content,
    status: readString(record, "status", "state"),
    dueAt: readString(record, "dueAt", "due_at", "due", "startAt", "start_at"),
    sourceUrl: readString(record, "sourceUrl", "source_url", "url", "html_url"),
    metadata: record
  };
}

async function parseImportFile(file: File, source: ProductImportSource) {
  const text = await file.text();
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Import previews are limited to 8 MiB.");
  }
  if (
    source === "markdown" ||
    source === "obsidian" ||
    file.name.toLowerCase().endsWith(".md")
  ) {
    return [
      normalizeImportRecord(
        { id: file.name, title: file.name.replace(/\.md$/iu, ""), content: text },
        0,
        source
      )
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Choose a JSON export for this source, or a Markdown file for Markdown/Obsidian.");
  }
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? ((parsed as Record<string, unknown>).items ??
        (parsed as Record<string, unknown>).records ??
        (parsed as Record<string, unknown>).data)
      : null;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("The export must contain a non-empty items, records, or data array.");
  }
  if (records.length > 500) {
    throw new Error("Review imports in batches of at most 500 records.");
  }
  return records.map((record, index) => normalizeImportRecord(record, index, source));
}

export function LaunchpadPage() {
  const shell = useForgeShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerUserId =
    shell.selectedUserIds.length === 1
      ? shell.selectedUserIds[0]
      : (shell.snapshot.users.find((user) => user.id === "user_operator")?.id ??
        shell.snapshot.users.find((user) => user.kind === "human")?.id ??
        "");
  const rawTab = searchParams.get("tab");
  const activeTab = TABS.some((tab) => tab.key === rawTab)
    ? (rawTab as LaunchpadTab)
    : "outcomes";
  const [packagePreview, setPackagePreview] = useState<ProductPackagePreview | null>(null);
  const [importSource, setImportSource] = useState<ProductImportSource>("markdown");
  const [importPreview, setImportPreview] = useState<ProductImportPreview | null>(null);
  const [importDecisions, setImportDecisions] = useState<Record<string, "create" | "skip">>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeConfirmationId, setRemoveConfirmationId] = useState<string | null>(null);
  const [rollbackConfirmationId, setRollbackConfirmationId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeys = useRef(new Map<string, string>());
  const operationKey = (fingerprint: string) => {
    const existing = idempotencyKeys.current.get(fingerprint);
    if (existing) return existing;
    const created = `launchpad-${crypto.randomUUID()}`;
    idempotencyKeys.current.set(fingerprint, created);
    return created;
  };

  const packagesQuery = useQuery({
    queryKey: ["forge-launchpad-packages"],
    queryFn: listLaunchpadPackages
  });
  const onboardingQuery = useQuery({
    queryKey: ["forge-launchpad-onboarding", ownerUserId],
    enabled: Boolean(ownerUserId),
    queryFn: () => getLaunchpadOnboarding(ownerUserId)
  });
  const installsQuery = useQuery({
    queryKey: ["forge-launchpad-package-installs", ownerUserId],
    enabled: Boolean(ownerUserId),
    queryFn: () => listLaunchpadPackageInstalls(ownerUserId)
  });
  const importsQuery = useQuery({
    queryKey: ["forge-launchpad-imports", ownerUserId],
    enabled: Boolean(ownerUserId) && activeTab === "imports",
    queryFn: () => listLaunchpadImports(ownerUserId)
  });
  const reviewsQuery = useQuery({
    queryKey: ["forge-launchpad-reviews", ownerUserId],
    enabled: Boolean(ownerUserId) && activeTab === "reviews",
    queryFn: () => listLaunchpadReviews(ownerUserId)
  });
  const feedbackQuery = useQuery({
    queryKey: ["forge-launchpad-feedback", ownerUserId],
    enabled: Boolean(ownerUserId) && activeTab === "privacy",
    queryFn: () => getLaunchpadFeedback(ownerUserId)
  });

  const outcomePackages = useMemo(
    () =>
      (packagesQuery.data?.packages ?? []).filter(
        (entry) => entry.kind === "starter_pack" && entry.outcomeKey
      ),
    [packagesQuery.data]
  );
  const offlineDecisionItems = (shell.offlineMutationOutbox?.entries ?? []).filter(
    (entry) => ["conflicted", "needs_decision", "rejected"].includes(entry.state)
  );

  const previewPackageMutation = useMutation({
    mutationFn: (productPackage: ProductPackage) =>
      previewLaunchpadPackage({ ownerUserId, packageId: productPackage.id }),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (response) => setPackagePreview(response.preview),
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Forge could not preview that package.")
  });

  const installPackageMutation = useMutation({
    mutationFn: () => {
      const fingerprint = `package:${packagePreview!.package.id}:${packagePreview!.package.manifestSha256}`;
      return installLaunchpadPackage({
        ownerUserId,
        packageId: packagePreview!.package.id,
        manifestSha256: packagePreview!.package.manifestSha256,
        idempotencyKey: operationKey(fingerprint)
      });
    },
    onSuccess: async (response) => {
      idempotencyKeys.current.delete(
        `package:${response.install.packageId}:${packagePreview!.package.manifestSha256}`
      );
      const first = response.install.createdEntities[0];
      setNotice(`Installed ${packagePreview?.package.title ?? "starter pack"}.`);
      setPackagePreview(null);
      await Promise.all([shell.refresh(), onboardingQuery.refetch(), installsQuery.refetch()]);
      if (first) navigate(first.href);
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Forge could not install that package.")
  });

  const removePackageMutation = useMutation({
    mutationFn: (installId: string) =>
      removeLaunchpadPackageInstall(installId, ownerUserId),
    onSuccess: async () => {
      setNotice("The starter pack records were moved to the bin in reverse dependency order.");
      setRemoveConfirmationId(null);
      await Promise.all([shell.refresh(), installsQuery.refetch()]);
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "Forge could not remove that starter pack.")
  });

  const onboardingMutation = useMutation({
    mutationFn: (outcomeKey: ProductOutcomeKey | null) =>
      updateLaunchpadOnboarding({
        ownerUserId,
        outcomeKey,
        currentStep: outcomeKey ? "review_pack" : "complete",
        status: outcomeKey ? "in_progress" : "skipped"
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(["forge-launchpad-onboarding", ownerUserId], response);
    }
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: () =>
      updateLaunchpadOnboarding({
        ownerUserId,
        outcomeKey: onboardingQuery.data?.onboarding.outcomeKey ?? null,
        currentStep: "complete",
        status: "complete"
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(["forge-launchpad-onboarding", ownerUserId], response);
      const href = response.onboarding.lastResultHref || "/overview";
      navigate(href);
    }
  });

  const importPreviewMutation = useMutation({
    mutationFn: async (file: File) => {
      const items = await parseImportFile(file, importSource);
      return previewLaunchpadImport({
        ownerUserId,
        sourceKind: importSource,
        sourceLabel: file.name,
        items
      });
    },
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (response) => {
      setImportPreview(response.preview);
      setImportDecisions(
        Object.fromEntries(
          response.preview.items.map((item) => [
            item.sourceId,
            item.duplicate ? "skip" : "create"
          ])
        )
      );
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Forge could not preview that import.")
  });

  const importCommitMutation = useMutation({
    mutationFn: () => {
      const reviewedDecisions = importPreview!.items.map((item) => ({
        sourceId: item.sourceId,
        action: importDecisions[item.sourceId] ?? "skip"
      }));
      const fingerprint = `import:${importPreview!.previewId}:${importPreview!.payloadFingerprint}:${JSON.stringify(reviewedDecisions)}`;
      return commitLaunchpadImport({
        ownerUserId,
        previewId: importPreview!.previewId,
        payloadFingerprint: importPreview!.payloadFingerprint,
        idempotencyKey: operationKey(fingerprint),
        decisions: reviewedDecisions
      });
    },
    onSuccess: async (response) => {
      if (importPreview) {
        for (const key of idempotencyKeys.current.keys()) {
          if (key.startsWith(`import:${importPreview.previewId}:`)) {
            idempotencyKeys.current.delete(key);
          }
        }
      }
      setNotice(
        `Imported ${response.import.created.length} record${response.import.created.length === 1 ? "" : "s"}; skipped ${response.import.skipped.length}.`
      );
      setImportPreview(null);
      await Promise.all([
        shell.refresh(),
        importsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["forge-launchpad-reviews"] })
      ]);
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Forge could not apply that import.")
  });

  const rollbackImportMutation = useMutation({
    mutationFn: (importId: string) => rollbackLaunchpadImport(importId, ownerUserId),
    onSuccess: async () => {
      setNotice("The records created by that import were moved to the bin. Its receipt remains available.");
      setRollbackConfirmationId(null);
      await Promise.all([shell.refresh(), importsQuery.refetch()]);
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "Forge could not roll back that import.")
  });

  const reviewMutation = useMutation({
    mutationFn: ({ itemId, revision, decision }: { itemId: string; revision: number; decision: "accept" | "reject" }) =>
      decideLaunchpadReview(itemId, {
        ownerUserId,
        expectedRevision: revision,
        decision
      }),
    onSuccess: () => reviewsQuery.refetch()
  });

  const feedbackMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      updateLaunchpadFeedback({
        ownerUserId,
        enabled,
        consentVersion: enabled ? "privacy-feedback-v1" : null
      }),
    onSuccess: (response) =>
      queryClient.setQueryData(["forge-launchpad-feedback", ownerUserId], response)
  });

  const deleteFeedbackMutation = useMutation({
    mutationFn: () => deleteLaunchpadFeedback(ownerUserId),
    onSuccess: () => feedbackQuery.refetch()
  });

  if (!ownerUserId) {
    return <ErrorState error={new Error("Forge needs one local human identity before Launchpad can create owner-scoped records.")} />;
  }

  return (
    <div className="grid gap-6 pb-10">
      <PageHero
        eyebrow="Launchpad"
        title="Reach a useful result before learning every screen"
        titleText="Forge Launchpad"
        description="Choose an outcome, inspect every proposed change, import existing work, and keep unresolved decisions in one review queue."
        badge={<Badge tone="signal">Production setup</Badge>}
      />

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Launchpad sections">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium",
                activeTab === tab.key
                  ? "border-[color-mix(in_srgb,var(--primary)_42%,var(--ui-border-subtle))] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                  : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
              )}
              onClick={() => setSearchParams({ tab: tab.key })}
            >
              <Icon className="size-4" /> {tab.label}
            </button>
          );
        })}
      </nav>

      {notice ? <Card className="border-[color-mix(in_srgb,var(--success)_32%,var(--ui-border-subtle))] bg-[var(--ui-success-soft)] text-sm">{notice}</Card> : null}
      {error ? <Card className="border-[color-mix(in_srgb,var(--danger)_32%,var(--ui-border-subtle))] bg-[var(--ui-danger-soft)] text-sm text-[var(--danger)]" role="alert">{error}</Card> : null}

      {activeTab === "outcomes" ? (
        packagesQuery.isLoading || onboardingQuery.isLoading ? (
          <LoadingState title="Loading outcome paths…" />
        ) : (
          <section className="grid gap-4">
            {onboardingQuery.data?.onboarding.currentStep === "first_result" && onboardingQuery.data.onboarding.lastResultHref ? (
              <Card className="grid gap-4 border-[color-mix(in_srgb,var(--success)_32%,var(--ui-border-subtle))] bg-[var(--ui-success-soft)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <Badge tone="signal">Starter path installed</Badge>
                  <h2 className="mt-2 font-semibold">Your first useful result is ready</h2>
                  <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">Open the created record, make it yours, and finish setup. Forge will keep this step resumable until you do.</p>
                </div>
                <Button size="lg" pending={completeOnboardingMutation.isPending} pendingLabel="Opening…" onClick={() => completeOnboardingMutation.mutate()}>
                  Open first result <ArrowRight className="size-4" />
                </Button>
              </Card>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ui-ink-strong)]">What do you want Forge to help you achieve first?</h2>
                <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">Each path installs only the reviewed records shown in its preview. You can skip or resume later.</p>
              </div>
              <Button variant="ghost" onClick={() => onboardingMutation.mutate(null)}>Skip for now</Button>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {outcomePackages.map((productPackage) => {
                const copy = OUTCOME_COPY[productPackage.outcomeKey!];
                const selected = onboardingQuery.data?.onboarding.outcomeKey === productPackage.outcomeKey;
                return (
                  <Card key={productPackage.id} className={cn("flex flex-col", selected && "border-[color-mix(in_srgb,var(--primary)_42%,var(--ui-border-subtle))]")}>
                    <Sparkles className="size-6 text-[var(--primary)]" />
                    <h3 className="mt-4 text-lg font-semibold text-[var(--ui-ink-strong)]">{copy.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-[var(--ui-ink-medium)]">{copy.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {productPackage.permissions.map((permission) => <Badge key={permission} size="xs" wrap>{permission}</Badge>)}
                    </div>
                    <Button
                      className="mt-5 w-full"
                      size="lg"
                      onClick={async () => {
                        await onboardingMutation.mutateAsync(productPackage.outcomeKey);
                        previewPackageMutation.mutate(productPackage);
                      }}
                    >
                      Review this path <ArrowRight className="size-4" />
                    </Button>
                  </Card>
                );
              })}
            </div>
            {packagePreview ? (
              <Card className="grid gap-5 border-[color-mix(in_srgb,var(--primary)_32%,var(--ui-border-subtle))]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge tone="signal">Explicit review</Badge>
                    <h3 className="mt-2 text-xl font-semibold">{packagePreview.package.title}</h3>
                    <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">Manifest {packagePreview.package.manifestSha256.slice(0, 12)}… · {packagePreview.package.compatibility}</p>
                  </div>
                  <Button variant="secondary" onClick={() => setPackagePreview(null)}>Close preview</Button>
                </div>
                <div className="grid gap-2">
                  {packagePreview.changes.map((change) => (
                    <div key={change.ref} className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                      <div className="flex items-center gap-2"><Badge size="xs">{change.entityType}</Badge><strong>{change.title}</strong></div>
                      <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">{change.description}</p>
                    </div>
                  ))}
                </div>
                {packagePreview.collisions.length > 0 ? (
                  <div className="rounded-[18px] bg-[var(--ui-warning-soft)] p-4 text-sm">Resolve {packagePreview.collisions.length} same-title collision{packagePreview.collisions.length === 1 ? "" : "s"} before installing. Forge will not silently merge or duplicate them.</div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-[var(--ui-ink-faint)]">Installation is atomic. A failure creates nothing.</span>
                  <Button size="lg" disabled={!packagePreview.canInstall} pending={installPackageMutation.isPending} pendingLabel="Installing…" onClick={() => installPackageMutation.mutate()}>
                    Confirm and install
                  </Button>
                </div>
              </Card>
            ) : null}
          </section>
        )
      ) : null}

      {activeTab === "imports" ? (
        <section className="grid gap-5">
          <Card className="grid gap-4">
            <div>
              <h2 className="text-lg font-semibold">Preview an export before Forge writes</h2>
              <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">Markdown is read directly. Other sources accept a JSON export containing an items, records, or data array. Every created record retains the import receipt and source identity.</p>
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Source
              <select className="min-h-11 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4" value={importSource} onChange={(event) => { setImportSource(event.target.value as ProductImportSource); setImportPreview(null); }}>
                {IMPORT_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
              </select>
            </label>
            <input ref={importInputRef} type="file" className="sr-only" accept={importSource === "markdown" || importSource === "obsidian" ? ".md,.markdown,.json" : ".json,application/json"} onChange={(event) => { const file = event.target.files?.[0]; if (file) importPreviewMutation.mutate(file); event.target.value = ""; }} />
            <Button size="lg" pending={importPreviewMutation.isPending} pendingLabel="Reading preview…" onClick={() => importInputRef.current?.click()}>
              <FileJson className="size-4" /> Choose export
            </Button>
          </Card>
          {importPreview ? (
            <Card className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-lg font-semibold">{importPreview.sourceLabel}</h3><p className="text-sm text-[var(--ui-ink-medium)]">{importPreview.counts.create} ready · {importPreview.counts.conflicts} need a create-or-skip decision</p></div>
                <Badge tone="signal">No records written</Badge>
              </div>
              <div className="grid max-h-[30rem] gap-2 overflow-y-auto pr-1">
                {importPreview.items.map((item) => (
                  <div key={item.sourceId} className="grid gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge size="xs">{item.recordType}</Badge>{item.duplicate ? <Badge className="bg-[var(--ui-warning-soft)]">Same title exists</Badge> : null}</div><div className="mt-2 truncate font-medium">{item.title}</div><div className="mt-1 text-xs text-[var(--ui-ink-faint)]">Source ID: {item.sourceId}</div></div>
                    <select className="min-h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3" value={importDecisions[item.sourceId] ?? "skip"} onChange={(event) => setImportDecisions((current) => ({ ...current, [item.sourceId]: event.target.value as "create" | "skip" }))}>
                      <option value="create">Create new</option><option value="skip">Skip</option>
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ui-border-subtle)] pt-4"><span className="text-xs text-[var(--ui-ink-faint)]">Apply is atomic and can be rolled back from its receipt.</span><Button size="lg" pending={importCommitMutation.isPending} pendingLabel="Importing…" onClick={() => importCommitMutation.mutate()}>Confirm import</Button></div>
            </Card>
          ) : null}
          {(importsQuery.data?.imports ?? []).length > 0 ? (
            <Card className="grid gap-4">
              <div>
                <h3 className="text-lg font-semibold">Import receipts and rollback</h3>
                <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">Every import remains inspectable. Rolling back moves only the records created by that receipt to the bin; it does not erase the receipt.</p>
              </div>
              <div className="grid gap-3">
                {(importsQuery.data?.imports ?? []).map((run) => (
                  <div key={run.id} className="grid gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><Badge>{run.sourceKind.replaceAll("_", " ")}</Badge><Badge tone={run.status === "committed" ? "signal" : undefined}>{run.status.replaceAll("_", " ")}</Badge></div>
                      <h4 className="mt-2 font-medium">{run.sourceLabel}</h4>
                      <p className="mt-1 text-xs text-[var(--ui-ink-faint)]">{run.created.length} created · {run.skipped.length} skipped · {new Date(run.updatedAt).toLocaleString()}</p>
                      {run.created.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{run.created.slice(0, 6).map((record) => <Link key={`${run.id}:${record.entityId}`} className="text-xs font-medium text-[var(--primary)]" to={record.href}>{record.title}</Link>)}</div> : null}
                    </div>
                    {run.status === "committed" ? (
                      rollbackConfirmationId === run.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-2"><span className="max-w-64 text-xs text-[var(--ui-ink-medium)]">Move all {run.created.length} created record{run.created.length === 1 ? "" : "s"} to the bin?</span><Button variant="ghost" onClick={() => setRollbackConfirmationId(null)}>Keep</Button><Button pending={rollbackImportMutation.isPending} pendingLabel="Rolling back…" onClick={() => rollbackImportMutation.mutate(run.id)}>Confirm rollback</Button></div>
                      ) : (
                        <Button variant="secondary" onClick={() => setRollbackConfirmationId(run.id)}><Trash2 className="size-4" /> Roll back</Button>
                      )
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </section>
      ) : null}

      {activeTab === "gallery" ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(packagesQuery.data?.packages ?? []).map((productPackage) => (
            <Card key={productPackage.id} className="flex flex-col">
              <div className="flex items-center justify-between gap-2"><Badge>{productPackage.kind === "starter_pack" ? "Starter pack" : "Integration"}</Badge><Badge tone="signal"><ShieldCheck className="mr-1 size-3" /> Forge reviewed</Badge></div>
              <h2 className="mt-4 text-lg font-semibold">{productPackage.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-[var(--ui-ink-medium)]">{productPackage.summary}</p>
              <p className="mt-3 text-xs text-[var(--ui-ink-faint)]">By {productPackage.author} · {productPackage.compatibility}</p>
              <div className="mt-4 flex flex-wrap gap-2">{productPackage.permissions.map((permission) => <Badge key={permission} size="xs" wrap>{permission}</Badge>)}</div>
              {productPackage.kind === "starter_pack" ? (() => {
                const install = installsQuery.data?.installs.find((entry) => entry.packageId === productPackage.id && entry.status === "installed");
                return install ? (
                  <div className="mt-5 grid gap-2"><Badge tone="signal">Installed</Badge>{removeConfirmationId === install.id ? <div className="grid gap-2 rounded-[16px] bg-[var(--ui-warning-soft)] p-3 text-xs"><span>Move the {install.createdEntities.length} records created by this pack to the bin?</span><div className="flex gap-2"><Button variant="ghost" onClick={() => setRemoveConfirmationId(null)}>Keep</Button><Button pending={removePackageMutation.isPending} pendingLabel="Removing…" onClick={() => removePackageMutation.mutate(install.id)}>Confirm removal</Button></div></div> : <Button variant="secondary" onClick={() => setRemoveConfirmationId(install.id)}><Trash2 className="size-4" /> Move pack records to bin</Button>}</div>
                ) : (
                  <Button className="mt-5" onClick={() => { setSearchParams({ tab: "outcomes" }); previewPackageMutation.mutate(productPackage); }}><Eye className="size-4" /> Inspect manifest</Button>
                );
              })() : <Button className="mt-5" variant="secondary" onClick={() => setSearchParams({ tab: "imports" })}><ArrowRight className="size-4" /> Open setup</Button>}
            </Card>
          ))}
        </section>
      ) : null}

      {activeTab === "reviews" ? (
        reviewsQuery.isLoading ? <LoadingState title="Loading review queue…" /> : (
          <section className="grid gap-4">
            <div><h2 className="text-lg font-semibold">One place for decisions that must not be automatic</h2><p className="mt-1 text-sm text-[var(--ui-ink-medium)]">Every item carries a revision. A stale decision is refused rather than applied to changed evidence.</p></div>
            {offlineDecisionItems.map((entry) => (
              <Card key={`offline:${entry.id}`} className="grid gap-4 border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle))] sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <div className="flex flex-wrap gap-2"><Badge>offline conflict</Badge><Badge size="xs">{entry.state.replaceAll("_", " ")}</Badge></div>
                  <h3 className="mt-2 font-semibold">Move {entry.taskLabel} to {entry.desiredStatus.replaceAll("_", " ")}</h3>
                  <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">{entry.summary}</p>
                  {entry.current ? <p className="mt-2 text-xs text-[var(--ui-ink-faint)]">Current status: {entry.current.status.replaceAll("_", " ")} · queued from revision {entry.expectedUpdatedAt}</p> : null}
                </div>
                <div className="flex min-h-11 flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={() => void shell.offlineMutationOutbox?.discard(entry.id)}>Discard</Button>
                  <Link className={buttonVariants({ variant: "secondary", size: "md" })} to={`/tasks/${encodeURIComponent(entry.taskId)}`}>Open task</Link>
                  {entry.state === "conflicted" && entry.current ? <Button disabled={!shell.offlineMutationOutbox?.isOnline} onClick={() => void shell.offlineMutationOutbox?.retryConflict(entry.id)}><RefreshCw className="size-4" /> Apply to current revision</Button> : null}
                </div>
              </Card>
            ))}
            {(reviewsQuery.data?.items ?? []).length === 0 && offlineDecisionItems.length === 0 ? <Card className="py-10 text-center"><PackageCheck className="mx-auto size-8 text-[var(--success)]" /><h3 className="mt-3 font-semibold">Nothing is waiting for review</h3></Card> : (reviewsQuery.data?.items ?? []).map((item) => {
              const labels = reviewActionLabels(item);
              const evidence = reviewEvidenceSummary(item);
              return (
                <Card key={item.id} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <div className="flex flex-wrap gap-2"><Badge>{item.kind.replaceAll("_", " ")}</Badge><Badge size="xs">revision {item.revision}</Badge></div>
                    <h3 className="mt-2 font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">{item.summary}</p>
                    {evidence ? <p className="mt-2 text-xs text-[var(--ui-ink-faint)]">{evidence}</p> : null}
                  </div>
                  <div className="flex min-h-11 items-center gap-2">
                    <Button variant="secondary" pending={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ itemId: item.id, revision: item.revision, decision: "reject" })}>{labels.reject}</Button>
                    {item.kind === "import_conflict" ? (
                      <Button onClick={() => setSearchParams({ tab: "imports" })}>Resolve import</Button>
                    ) : (
                      <Button pending={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ itemId: item.id, revision: item.revision, decision: "accept" })}>{labels.accept}</Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </section>
        )
      ) : null}

      {activeTab === "privacy" ? (
        feedbackQuery.isLoading ? <LoadingState title="Loading privacy controls…" /> : (
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="grid gap-4">
              <div className="flex items-start justify-between gap-4"><div><Badge tone="signal">Off by default</Badge><h2 className="mt-2 text-lg font-semibold">Privacy-preserving product feedback</h2><p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">When enabled, Forge stores only activation outcomes in your local database. It does not transmit them, and the schema cannot contain record content, titles, paths, credentials, or stable device identifiers.</p></div><button type="button" className={cn("relative h-8 w-14 shrink-0 rounded-full transition", feedbackQuery.data?.feedback.settings.enabled ? "bg-[var(--primary)]" : "bg-[var(--ui-surface-3)]")} aria-pressed={feedbackQuery.data?.feedback.settings.enabled} onClick={() => feedbackMutation.mutate(!feedbackQuery.data?.feedback.settings.enabled)}><span className={cn("absolute top-1 size-6 rounded-full bg-[var(--ui-surface-1)] shadow-[var(--ui-shadow-soft)] transition", feedbackQuery.data?.feedback.settings.enabled ? "left-7" : "left-1")} /></button></div>
              <div className="grid gap-2">{feedbackQuery.data?.feedback.events.map((event) => <div key={event.id} className="rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3 text-sm"><strong>{event.eventName.replaceAll("_", " ")}</strong><span className="ml-2 text-xs text-[var(--ui-ink-faint)]">{new Date(event.createdAt).toLocaleString()}</span></div>)}</div>
              <div className="flex flex-wrap gap-3"><Button variant="secondary" onClick={() => { const blob = new Blob([JSON.stringify(feedbackQuery.data?.feedback ?? {}, null, 2)], { type: "application/json" }); const href = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = href; link.download = "forge-private-feedback-export.json"; link.click(); URL.revokeObjectURL(href); }}><Download className="size-4" /> Export local data</Button><Button variant="ghost" pending={deleteFeedbackMutation.isPending} onClick={() => deleteFeedbackMutation.mutate()}><Trash2 className="size-4" /> Delete events</Button></div>
            </Card>
            <Card className="h-fit"><h3 className="font-semibold">Hard field boundary</h3><div className="mt-3 grid gap-2">{feedbackQuery.data?.feedback.policy.prohibitedFields.map((field) => <div key={field} className="flex items-center gap-2 text-sm text-[var(--ui-ink-medium)]"><Check className="size-4 text-[var(--success)]" /> Never collected: {field}</div>)}</div><p className="mt-4 text-xs text-[var(--ui-ink-faint)]">Local retention: {feedbackQuery.data?.feedback.policy.retentionDays} days. Transport: {feedbackQuery.data?.feedback.policy.transport.replace("_", " ")}.</p></Card>
          </section>
        )
      ) : null}

      {activeTab === "distribution" ? <DistributionCenter /> : null}

      <div className="flex justify-end"><Link className="text-sm font-medium text-[var(--primary)]" to="/settings">Open all settings</Link></div>
    </div>
  );
}
