import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileArchive,
  FileText,
  Globe,
  LoaderCircle,
  Sparkles,
  Upload,
  Wand2,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWikiIngestJob,
  createWikiIngestUploadJob,
  getWikiIngestJob,
  reviewWikiIngestJob
} from "@/lib/api";
import type {
  CrudEntityType,
  WikiIngestJobPayload,
  WikiLlmProfile,
  WikiSpace
} from "@/lib/types";
import { cn } from "@/lib/utils";

type IngestMode = "files" | "url" | "text";

const ACTIVE_JOB_STATUSES = new Set(["queued", "processing"]);

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function CandidateCard({
  candidate,
  keep,
  onDecisionChange
}: {
  candidate: WikiIngestJobPayload["candidates"][number];
  keep: boolean;
  onDecisionChange: (keep: boolean) => void;
}) {
  const previewText =
    typeof candidate.payload.contentMarkdown === "string"
      ? candidate.payload.contentMarkdown
      : typeof candidate.payload.patchSummary === "string"
        ? candidate.payload.patchSummary
        : candidate.summary;

  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
            {candidate.candidateType.replaceAll("_", " ")}
          </div>
          <div className="mt-2 text-base font-semibold text-white">
            {candidate.title || candidate.targetKey || "Untitled candidate"}
          </div>
          {candidate.summary ? (
            <div className="mt-1 text-sm leading-6 text-white/58">
              {candidate.summary}
            </div>
          ) : null}
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] p-1">
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              keep
                ? "bg-[rgba(192,193,255,0.2)] text-white"
                : "text-white/54 hover:text-white"
            )}
            onClick={() => onDecisionChange(true)}
          >
            Keep
          </button>
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              !keep
                ? "bg-[rgba(255,255,255,0.12)] text-white"
                : "text-white/54 hover:text-white"
            )}
            onClick={() => onDecisionChange(false)}
          >
            Discard
          </button>
        </div>
      </div>
      {previewText ? (
        <div className="mt-4 rounded-[18px] border border-white/8 bg-[rgba(6,10,20,0.65)] px-4 py-3 text-sm leading-6 text-white/72">
          <pre className="whitespace-pre-wrap font-sans">{previewText}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function WikiIngestModal({
  open,
  onOpenChange,
  spaces,
  llmProfiles,
  initialSpaceId,
  selectedJobId,
  onJobSelected,
  linkedEntityHints = []
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: WikiSpace[];
  llmProfiles: WikiLlmProfile[];
  initialSpaceId: string;
  selectedJobId: string | null;
  onJobSelected: (jobId: string | null) => void;
  linkedEntityHints?: Array<{
    entityType: CrudEntityType;
    entityId: string;
    anchorKey?: string | null;
  }>;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<IngestMode>("files");
  const [selectedSpaceId, setSelectedSpaceId] = useState(initialSpaceId);
  const [titleHint, setTitleHint] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [rawTextValue, setRawTextValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [llmProfileId, setLlmProfileId] = useState(
    llmProfiles.find((profile) => profile.enabled)?.id ?? ""
  );
  const [parseStrategy, setParseStrategy] = useState<
    "auto" | "text_only" | "multimodal"
  >("auto");
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSpaceId) {
      setSelectedSpaceId(initialSpaceId);
    }
  }, [initialSpaceId]);

  useEffect(() => {
    if (!llmProfileId && llmProfiles[0]?.id) {
      setLlmProfileId(llmProfiles[0].id);
    }
  }, [llmProfileId, llmProfiles]);

  const jobQuery = useQuery({
    queryKey: ["forge-wiki-ingest-job", selectedJobId],
    queryFn: () => getWikiIngestJob(selectedJobId!),
    enabled: open && Boolean(selectedJobId),
    refetchInterval: (query) => {
      const payload = query.state.data as WikiIngestJobPayload | undefined;
      return payload && ACTIVE_JOB_STATUSES.has(payload.job.status)
        ? 2000
        : false;
    }
  });

  useEffect(() => {
    const job = jobQuery.data;
    if (!job) {
      return;
    }
    const nextDecisions: Record<string, boolean> = {};
    job.candidates.forEach((candidate) => {
      nextDecisions[candidate.id] =
        candidate.status === "rejected" ? false : true;
    });
    setDecisions(nextDecisions);
  }, [jobQuery.data]);

  const createJobMutation = useMutation({
    mutationFn: async () => {
      if (mode === "files") {
        if (files.length === 0) {
          throw new Error("Select at least one file to ingest.");
        }
        return createWikiIngestUploadJob({
          files,
          spaceId: selectedSpaceId || undefined,
          titleHint: titleHint.trim() || undefined,
          llmProfileId: llmProfileId || undefined,
          parseStrategy,
          createAsKind: "wiki",
          linkedEntityHints
        });
      }

      if (mode === "url") {
        if (!urlValue.trim()) {
          throw new Error("Enter a URL to ingest.");
        }
        return createWikiIngestJob({
          spaceId: selectedSpaceId || undefined,
          titleHint: titleHint.trim() || undefined,
          sourceKind: "url",
          sourceUrl: urlValue.trim(),
          llmProfileId: llmProfileId || undefined,
          parseStrategy,
          createAsKind: "wiki",
          linkedEntityHints
        });
      }

      if (!rawTextValue.trim()) {
        throw new Error("Paste some text to ingest.");
      }
      return createWikiIngestJob({
        spaceId: selectedSpaceId || undefined,
        titleHint: titleHint.trim() || undefined,
        sourceKind: "raw_text",
        sourceText: rawTextValue,
        mimeType: "text/plain",
        llmProfileId: llmProfileId || undefined,
        parseStrategy,
        createAsKind: "wiki",
        linkedEntityHints
      });
    },
    onSuccess: async (result) => {
      const nextJobId = result.job?.job.id ?? null;
      await queryClient.invalidateQueries({
        queryKey: ["forge-wiki-ingest-jobs"]
      });
      if (nextJobId) {
        onJobSelected(nextJobId);
      }
      setFormError(null);
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Unable to start ingest."
      );
    }
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJobId || !jobQuery.data) {
        throw new Error("Choose an ingest job first.");
      }
      return reviewWikiIngestJob({
        jobId: selectedJobId,
        decisions: jobQuery.data.candidates.map((candidate) => ({
          candidateId: candidate.id,
          keep: decisions[candidate.id] ?? true
        }))
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-ingest-jobs"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-ingest-job", result.job.job.id]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-home"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-page-by-slug"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-tree"] })
      ]);
    }
  });

  const activeJob = jobQuery.data ?? null;
  const reviewableCandidates = useMemo(
    () =>
      activeJob?.candidates.filter((candidate) =>
        ["suggested", "accepted", "rejected"].includes(candidate.status)
      ) ?? [],
    [activeJob]
  );

  const resetToDraft = () => {
    onJobSelected(null);
    setFiles([]);
    setUrlValue("");
    setRawTextValue("");
    setTitleHint("");
    setFormError(null);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setFormError(null);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.78)] backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-4 bottom-4 top-4 z-50 mx-auto flex max-w-[min(74rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,27,42,0.98),rgba(10,15,28,0.98))] shadow-[0_36px_110px_rgba(3,8,18,0.48)]">
          <div className="border-b border-white/8 px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Wiki Ingest
                </div>
                <Dialog.Title className="mt-2 font-display text-[1.5rem] tracking-[-0.04em] text-white">
                  {activeJob
                    ? "Ingest review and progress"
                    : "Build wiki memory from source files"}
                </Dialog.Title>
                <Dialog.Description className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
                  Upload notes, media, ZIP archives, links, or pasted text.
                  Forge will process them in the background, propose pages and
                  entities, and let you keep only what belongs.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
                  aria-label="Close ingest modal"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {!activeJob ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
                <div className="grid gap-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      {
                        id: "files",
                        label: "Files and ZIP",
                        detail: "Drag many files or one archive.",
                        icon: Upload
                      },
                      {
                        id: "url",
                        label: "URL",
                        detail: "Pull a webpage or remote file.",
                        icon: Globe
                      },
                      {
                        id: "text",
                        label: "Paste text",
                        detail: "Turn notes or transcripts into pages.",
                        icon: FileText
                      }
                    ].map((option) => {
                      const Icon = option.icon;
                      const selected = option.id === mode;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={cn(
                            "rounded-[24px] border px-4 py-4 text-left transition",
                            selected
                              ? "border-[rgba(192,193,255,0.24)] bg-[rgba(192,193,255,0.12)] text-white"
                              : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07] hover:text-white"
                          )}
                          onClick={() => setMode(option.id as IngestMode)}
                        >
                          <Icon className="size-4 text-[var(--secondary)]" />
                          <div className="mt-3 text-sm font-semibold">
                            {option.label}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-white/48">
                            {option.detail}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-[28px] border border-white/8 bg-[rgba(9,14,26,0.72)] p-4 sm:p-5">
                    <div className="grid gap-4">
                      <Input
                        value={titleHint}
                        onChange={(event) => setTitleHint(event.target.value)}
                        placeholder="Optional title hint"
                      />

                      {mode === "files" ? (
                        <div
                          className={cn(
                            "rounded-[28px] border-2 border-dashed px-5 py-8 text-center transition",
                            dragActive
                              ? "border-[rgba(192,193,255,0.35)] bg-[rgba(192,193,255,0.08)]"
                              : "border-white/10 bg-white/[0.03]"
                          )}
                          onDragEnter={(event) => {
                            event.preventDefault();
                            setDragActive(true);
                          }}
                          onDragLeave={(event) => {
                            event.preventDefault();
                            setDragActive(false);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setDragActive(true);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDragActive(false);
                            const dropped = Array.from(
                              event.dataTransfer.files
                            );
                            setFiles((current) => [...current, ...dropped]);
                          }}
                        >
                          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
                            <Upload className="size-5 text-white/72" />
                          </div>
                          <div className="mt-4 text-base font-semibold text-white">
                            Drop files, media, notes, or ZIP archives here
                          </div>
                          <div className="mt-2 text-sm leading-6 text-white/50">
                            Forge accepts many files at once and queues the
                            ingest in the background so the UI stays responsive.
                          </div>
                          <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white">
                            <Upload className="size-4" />
                            Choose files
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              onChange={(event) =>
                                setFiles(Array.from(event.target.files ?? []))
                              }
                            />
                          </label>
                          {files.length > 0 ? (
                            <div className="mt-5 grid gap-2 text-left">
                              {files.map((file) => (
                                <div
                                  key={`${file.name}-${file.size}-${file.lastModified}`}
                                  className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white/72"
                                >
                                  <span className="truncate">{file.name}</span>
                                  <span className="shrink-0 text-xs text-white/42">
                                    {file.name
                                      .toLowerCase()
                                      .endsWith(".zip") ? (
                                      <span className="inline-flex items-center gap-1">
                                        <FileArchive className="size-3.5" />
                                        ZIP
                                      </span>
                                    ) : (
                                      `${Math.max(1, Math.round(file.size / 1024))} KB`
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {mode === "url" ? (
                        <Input
                          value={urlValue}
                          onChange={(event) => setUrlValue(event.target.value)}
                          placeholder="https://example.com/source"
                        />
                      ) : null}

                      {mode === "text" ? (
                        <Textarea
                          value={rawTextValue}
                          onChange={(event) =>
                            setRawTextValue(event.target.value)
                          }
                          placeholder="Paste notes, transcripts, meeting writeups, or source material here…"
                          className="min-h-[18rem]"
                        />
                      ) : null}
                    </div>
                  </div>
                </div>

                <aside className="grid h-fit gap-4">
                  <div className="rounded-[28px] border border-white/8 bg-white/[0.04] p-4">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => setShowAdvanced((current) => !current)}
                    >
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                          Advanced
                        </div>
                        <div className="mt-2 text-sm text-white/72">
                          Model, parse, and target controls.
                        </div>
                      </div>
                      <Sparkles className="size-4 text-white/58" />
                    </button>

                    {showAdvanced ? (
                      <div className="mt-4 grid gap-4">
                        <div>
                          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/42">
                            Space
                          </div>
                          <div className="grid gap-2">
                            {spaces.map((space) => (
                              <button
                                key={space.id}
                                type="button"
                                className={cn(
                                  "rounded-[18px] border px-3 py-3 text-left text-sm transition",
                                  selectedSpaceId === space.id
                                    ? "border-[rgba(192,193,255,0.24)] bg-[rgba(192,193,255,0.12)] text-white"
                                    : "border-white/8 bg-white/[0.03] text-white/68 hover:bg-white/[0.06] hover:text-white"
                                )}
                                onClick={() => setSelectedSpaceId(space.id)}
                              >
                                <div>{space.label}</div>
                                <div className="mt-1 text-xs text-white/45">
                                  {space.description || `/${space.slug}`}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/42">
                            LLM profile
                          </div>
                          <div className="grid gap-2">
                            {llmProfiles
                              .filter((profile) => profile.enabled)
                              .map((profile) => (
                                <button
                                  key={profile.id}
                                  type="button"
                                  className={cn(
                                    "rounded-[18px] border px-3 py-3 text-left text-sm transition",
                                    llmProfileId === profile.id
                                      ? "border-[rgba(192,193,255,0.24)] bg-[rgba(192,193,255,0.12)] text-white"
                                      : "border-white/8 bg-white/[0.03] text-white/68 hover:bg-white/[0.06] hover:text-white"
                                  )}
                                  onClick={() => setLlmProfileId(profile.id)}
                                >
                                  <div>{profile.label}</div>
                                  <div className="mt-1 text-xs text-white/45">
                                    {profile.model}
                                  </div>
                                </button>
                              ))}
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/42">
                            Parse mode
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {[
                              { id: "auto", label: "Auto" },
                              { id: "multimodal", label: "Multimodal" },
                              { id: "text_only", label: "Text only" }
                            ].map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                className={cn(
                                  "rounded-[18px] border px-3 py-3 text-sm transition",
                                  parseStrategy === option.id
                                    ? "border-[rgba(192,193,255,0.24)] bg-[rgba(192,193,255,0.12)] text-white"
                                    : "border-white/8 bg-white/[0.03] text-white/68 hover:bg-white/[0.06] hover:text-white"
                                )}
                                onClick={() =>
                                  setParseStrategy(
                                    option.id as
                                      | "auto"
                                      | "multimodal"
                                      | "text_only"
                                  )
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(192,193,255,0.12),rgba(192,193,255,0.05))] p-4">
                    <div className="flex items-center gap-2 text-white">
                      <Wand2 className="size-4 text-[var(--secondary)]" />
                      <span className="text-sm font-semibold">
                        Publish only what belongs
                      </span>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-white/62">
                      Forge stages candidate pages, proposed entity records, and
                      page updates first. You review the output before anything
                      is committed to the live memory graph.
                    </div>
                  </div>

                  {formError ? (
                    <div className="rounded-[20px] border border-rose-300/22 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                      {formError}
                    </div>
                  ) : null}

                  <Button
                    className="min-h-12"
                    pending={createJobMutation.isPending}
                    pendingLabel="Starting ingest"
                    onClick={() => void createJobMutation.mutateAsync()}
                  >
                    <Sparkles className="size-4" />
                    Start background ingest
                  </Button>
                </aside>
              </div>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="grid gap-5">
                  <div className="rounded-[28px] border border-white/8 bg-white/[0.04] p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                          Job {activeJob.job.id}
                        </div>
                        <div className="mt-2 text-xl font-semibold text-white">
                          {activeJob.job.latestMessage || "Ingest job"}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-white/56">
                          {activeJob.job.status} · {activeJob.job.phase} ·
                          started {formatTimestamp(activeJob.job.createdAt)}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={resetToDraft}
                      >
                        New ingest
                      </Button>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-4">
                      {[
                        {
                          label: "Progress",
                          value: `${activeJob.job.progressPercent}%`
                        },
                        {
                          label: "Files",
                          value: `${activeJob.job.processedFiles}/${activeJob.job.totalFiles}`
                        },
                        {
                          label: "Pages",
                          value: String(activeJob.job.createdPageCount)
                        },
                        {
                          label: "Entities",
                          value: String(activeJob.job.createdEntityCount)
                        }
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="rounded-[22px] border border-white/8 bg-[rgba(8,12,22,0.68)] px-4 py-3"
                        >
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                            {stat.label}
                          </div>
                          <div className="mt-2 text-lg font-semibold text-white">
                            {stat.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5">
                      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,rgba(192,193,255,0.8),rgba(133,222,255,0.8))] transition-all duration-300"
                          style={{ width: `${activeJob.job.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/8 bg-white/[0.04] p-4 sm:p-5">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                      Rich log
                    </div>
                    <div className="mt-4 grid max-h-[28rem] gap-2 overflow-y-auto">
                      {activeJob.logs.length === 0 ? (
                        <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-4 text-sm text-white/45">
                          Waiting for the backend to emit progress.
                        </div>
                      ) : (
                        activeJob.logs.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-[18px] border border-white/8 bg-[rgba(7,11,21,0.72)] px-4 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm text-white/82">
                                {entry.message}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.14em] text-white/38">
                                {formatTimestamp(entry.createdAt)}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-5">
                  <div className="rounded-[28px] border border-white/8 bg-white/[0.04] p-4 sm:p-5">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                      Source files
                    </div>
                    <div className="mt-4 grid gap-2">
                      {activeJob.assets.map((asset) => (
                        <div
                          key={asset.id}
                          className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-[rgba(7,11,21,0.72)] px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">
                              {asset.fileName ||
                                asset.sourceLocator ||
                                "Source"}
                            </div>
                            <div className="mt-1 text-xs text-white/45">
                              {asset.mimeType || asset.sourceKind}
                            </div>
                          </div>
                          <div className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-white/40">
                            {asset.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/8 bg-white/[0.04] p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                          Review
                        </div>
                        <div className="mt-2 text-sm leading-6 text-white/58">
                          Keep the candidates that belong in Forge and discard
                          the rest.
                        </div>
                      </div>
                      {ACTIVE_JOB_STATUSES.has(activeJob.job.status) ? (
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/58">
                          <LoaderCircle className="size-3.5 animate-spin" />
                          Processing
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-3">
                      {reviewableCandidates.length === 0 ? (
                        <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-4 text-sm text-white/45">
                          {ACTIVE_JOB_STATUSES.has(activeJob.job.status)
                            ? "Candidates will appear here while the job progresses."
                            : "This job has no reviewable candidates left."}
                        </div>
                      ) : (
                        reviewableCandidates.map((candidate) => (
                          <CandidateCard
                            key={candidate.id}
                            candidate={candidate}
                            keep={decisions[candidate.id] ?? true}
                            onDecisionChange={(keep) =>
                              setDecisions((current) => ({
                                ...current,
                                [candidate.id]: keep
                              }))
                            }
                          />
                        ))
                      )}
                    </div>

                    {reviewableCandidates.length > 0 &&
                    !ACTIVE_JOB_STATUSES.has(activeJob.job.status) ? (
                      <div className="mt-5">
                        <Button
                          className="min-h-12"
                          pending={reviewMutation.isPending}
                          pendingLabel="Publishing review"
                          onClick={() => void reviewMutation.mutateAsync()}
                        >
                          <Wand2 className="size-4" />
                          Publish kept candidates
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
