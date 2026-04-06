import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  FileArchive,
  FileText,
  Globe,
  LoaderCircle,
  Search,
  Sparkles,
  Upload,
  Wand2,
  X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWikiIngestJob,
  createWikiIngestUploadJob,
  deleteWikiIngestJob,
  getWikiIngestJob,
  resumeWikiIngestJob,
  rerunWikiIngestJob,
  reviewWikiIngestJob,
  searchWikiPages,
  searchEntities
} from "@/lib/api";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Badge } from "@/components/ui/badge";
import type {
  CrudEntityType,
  WikiIngestJobPayload,
  WikiLlmProfile,
  WikiSpace
} from "@/lib/types";
import type { EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

type IngestMode = "files" | "url" | "text";

const ACTIVE_JOB_STATUSES = new Set(["queued", "processing"]);
const STALE_INGEST_RESUME_THRESHOLD_MS = 15_000;
const SEARCHABLE_ENTITY_TYPES: CrudEntityType[] = [
  "goal",
  "project",
  "task",
  "habit",
  "strategy",
  "psyche_value",
  "note"
];

type IngestDecisionDraft = {
  action: "keep" | "discard" | "map_existing" | "merge_existing";
  mappedEntityType?: CrudEntityType;
  mappedEntityId?: string;
  mappedEntityLabel?: string;
  targetNoteId?: string;
  targetNoteLabel?: string;
};

type MappedEntitySearchResult = {
  entityType: CrudEntityType;
  entityId: string;
  label: string;
  description: string;
  kind: EntityKind | null;
};

type MappedPageSearchResult = {
  noteId: string;
  title: string;
  slug: string;
  summary: string;
};

type DisplayWikiIngestLogEntry = WikiIngestJobPayload["logs"][number] & {
  repetitionCount: number;
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function readMetadataNumber(
  metadata: Record<string, unknown>,
  key: string
): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function buildPollingDisplayMessage(
  entry: WikiIngestJobPayload["logs"][number],
  repetitionCount: number
) {
  const fileName =
    readMetadataString(entry.metadata, "currentFileName") ??
    readMetadataString(entry.metadata, "fileName") ??
    "current source";
  const status =
    readMetadataString(entry.metadata, "status") ?? "in_progress";
  const chunkIndex = readMetadataNumber(entry.metadata, "chunkIndex");
  const chunkCount = readMetadataNumber(entry.metadata, "chunkCount");
  const fileIndex = readMetadataNumber(entry.metadata, "currentFileIndex");
  const fileTotal = readMetadataNumber(entry.metadata, "currentFileTotal");
  const filePart =
    fileIndex !== null && fileTotal !== null
      ? `${fileName} (${fileIndex}/${fileTotal})`
      : fileName;
  const chunkPart =
    chunkIndex !== null && chunkCount !== null && chunkCount > 1
      ? ` · chunk ${chunkIndex}/${chunkCount}`
      : "";
  return `Waiting for OpenAI on ${filePart}${chunkPart}. ${repetitionCount} polls · ${status}.`;
}

function compactWikiIngestLogs(
  logs: WikiIngestJobPayload["logs"]
): DisplayWikiIngestLogEntry[] {
  const compacted: DisplayWikiIngestLogEntry[] = [];
  for (const entry of logs) {
    const scope = readMetadataString(entry.metadata, "scope");
    const eventKey = readMetadataString(entry.metadata, "eventKey");
    const isPollingEntry = eventKey === "llm_compile_background_polled";
    const currentFileName =
      readMetadataString(entry.metadata, "currentFileName") ??
      readMetadataString(entry.metadata, "fileName");
    const chunkIndex = readMetadataNumber(entry.metadata, "chunkIndex");
    const chunkCount = readMetadataNumber(entry.metadata, "chunkCount");
    const aggregationKey = isPollingEntry
      ? [
          "poll",
          scope ?? "",
          currentFileName ?? "",
          chunkIndex ?? "",
          chunkCount ?? ""
        ].join(":")
      : null;
    const previous = compacted[compacted.length - 1];
    const previousEventKey =
      previous && readMetadataString(previous.metadata, "eventKey");
    const previousFileName =
      previous &&
      (readMetadataString(previous.metadata, "currentFileName") ??
        readMetadataString(previous.metadata, "fileName"));
    const previousChunkIndex =
      previous && readMetadataNumber(previous.metadata, "chunkIndex");
    const previousChunkCount =
      previous && readMetadataNumber(previous.metadata, "chunkCount");
    const previousAggregationKey =
      previous && previousEventKey === "llm_compile_background_polled"
        ? [
            "poll",
            readMetadataString(previous.metadata, "scope") ?? "",
            previousFileName ?? "",
            previousChunkIndex ?? "",
            previousChunkCount ?? ""
          ].join(":")
        : null;

    if (
      isPollingEntry &&
      previous &&
      previousAggregationKey === aggregationKey
    ) {
      compacted[compacted.length - 1] = {
        ...entry,
        repetitionCount: previous.repetitionCount + 1,
        metadata: {
          ...entry.metadata,
          aggregatedPollCount: previous.repetitionCount + 1
        }
      };
      continue;
    }

    compacted.push({
      ...entry,
      repetitionCount: 1
    });
  }
  return compacted;
}

function entityTypeToKind(entityType: CrudEntityType): EntityKind | null {
  switch (entityType) {
    case "goal":
    case "project":
    case "task":
    case "habit":
    case "strategy":
      return entityType;
    case "psyche_value":
      return "value";
    default:
      return null;
  }
}

function isCrudEntityType(value: unknown): value is CrudEntityType {
  return (
    typeof value === "string" &&
    SEARCHABLE_ENTITY_TYPES.includes(value as CrudEntityType)
  );
}

function inferMappedEntityLabel(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  if (typeof entity.title === "string" && entity.title.trim().length > 0) {
    return entity.title;
  }
  if (
    typeof entity.displayName === "string" &&
    entity.displayName.trim().length > 0
  ) {
    return entity.displayName;
  }
  if (
    typeof entity.statement === "string" &&
    entity.statement.trim().length > 0
  ) {
    return entity.statement;
  }
  return `${entityType}:${String(entity.id ?? "")}`;
}

function inferMappedEntityDescription(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  const descriptionFields = [
    entity.description,
    entity.summary,
    entity.overview,
    entity.valuedDirection,
    entity.whyItMatters,
    entity.originNote
  ];
  const description = descriptionFields.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  if (description) {
    return description;
  }
  if (entityType === "note" && typeof entity.kind === "string") {
    return entity.kind;
  }
  return "";
}

function CandidateCard({
  candidate,
  decision,
  onDecisionChange,
  spaceId
}: {
  candidate: WikiIngestJobPayload["candidates"][number];
  decision: IngestDecisionDraft;
  onDecisionChange: (next: IngestDecisionDraft) => void;
  spaceId: string;
}) {
  const proposalEntityType = isCrudEntityType(candidate.payload.entityType)
    ? candidate.payload.entityType
    : null;
  const [mapQuery, setMapQuery] = useState(
    decision.mappedEntityLabel || candidate.title || ""
  );
  const [mergeQuery, setMergeQuery] = useState(
    decision.targetNoteLabel || candidate.title || ""
  );
  const previewText =
    typeof candidate.payload.contentMarkdown === "string"
      ? candidate.payload.contentMarkdown
      : typeof candidate.payload.patchSummary === "string"
        ? candidate.payload.patchSummary
        : typeof candidate.payload.rationale === "string"
          ? candidate.payload.rationale
        : candidate.summary;
  const mappedSearch = useQuery({
    queryKey: [
      "forge-wiki-ingest-map-search",
      proposalEntityType,
      mapQuery.trim()
    ],
    enabled:
      candidate.candidateType === "entity" &&
      decision.action === "map_existing" &&
      proposalEntityType !== null &&
      mapQuery.trim().length > 0,
    queryFn: async () => {
      const response = await searchEntities({
        searches: [
          {
            entityTypes: proposalEntityType ? [proposalEntityType] : undefined,
            query: mapQuery.trim(),
            limit: 8
          }
        ]
      });
      const first = response.results[0] as
        | {
            matches?: Array<{
              entityType?: CrudEntityType;
              id?: string;
              entity?: Record<string, unknown>;
            }>;
          }
        | undefined;
      return (
        first?.matches
          ?.filter(
            (match): match is {
              entityType: CrudEntityType;
              id: string;
              entity: Record<string, unknown>;
            } =>
              Boolean(
                match &&
                  isCrudEntityType(match.entityType) &&
                  typeof match.id === "string" &&
                  match.entity &&
                  typeof match.entity === "object"
              )
          )
          .map((match) => ({
            entityType: match.entityType,
            entityId: match.id,
            label: inferMappedEntityLabel(match.entityType, match.entity),
            description: inferMappedEntityDescription(
              match.entityType,
              match.entity
            ),
            kind: entityTypeToKind(match.entityType)
          })) ?? []
      );
    }
  });
  const mappedResults = mappedSearch.data ?? [];
  const mergedPageSearch = useQuery({
    queryKey: ["forge-wiki-ingest-merge-search", spaceId, mergeQuery.trim()],
    enabled:
      candidate.candidateType === "page" &&
      decision.action === "merge_existing" &&
      mergeQuery.trim().length > 0,
    queryFn: async () => {
      const response = await searchWikiPages({
        spaceId,
        kind: "wiki",
        mode: "text",
        query: mergeQuery.trim(),
        limit: 8
      });
      return response.results.map(
        (result): MappedPageSearchResult => ({
          noteId: result.page.id,
          title: result.page.title,
          slug: result.page.slug,
          summary: result.page.summary
        })
      );
    }
  });
  const mergedPageResults = mergedPageSearch.data ?? [];
  const selectedMappedResult =
    decision.mappedEntityId && decision.mappedEntityType
      ? mappedResults.find(
          (entry) =>
            entry.entityId === decision.mappedEntityId &&
            entry.entityType === decision.mappedEntityType
        ) ??
        (decision.mappedEntityLabel
          ? {
              entityId: decision.mappedEntityId,
              entityType: decision.mappedEntityType,
              label: decision.mappedEntityLabel,
              description: "",
              kind: entityTypeToKind(decision.mappedEntityType)
            }
          : null)
      : null;
  const selectedMergedPage =
    decision.targetNoteId
      ? mergedPageResults.find((entry) => entry.noteId === decision.targetNoteId) ??
        (decision.targetNoteLabel
          ? {
              noteId: decision.targetNoteId,
              title: decision.targetNoteLabel,
              slug: "",
              summary: ""
            }
          : null)
      : null;

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
          {proposalEntityType ? (
            <div className="mt-2">
              {entityTypeToKind(proposalEntityType) ? (
                <EntityBadge
                  kind={entityTypeToKind(proposalEntityType)!}
                  label={proposalEntityType.replaceAll("_", " ")}
                  compact
                  gradient={false}
                />
              ) : (
                <Badge className="bg-white/[0.08] text-white/72">
                  {proposalEntityType.replaceAll("_", " ")}
                </Badge>
              )}
            </div>
          ) : null}
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
              decision.action === "keep"
                ? "bg-[rgba(192,193,255,0.2)] text-white"
                : "text-white/54 hover:text-white"
            )}
            onClick={() =>
              onDecisionChange({
                ...decision,
                action: "keep"
              })
            }
          >
            Keep
          </button>
          {candidate.candidateType === "entity" && proposalEntityType ? (
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                decision.action === "map_existing"
                  ? "bg-[rgba(133,222,255,0.18)] text-white"
                  : "text-white/54 hover:text-white"
              )}
              onClick={() =>
                onDecisionChange({
                  ...decision,
                  action: "map_existing",
                  mappedEntityType: proposalEntityType
                })
              }
            >
              Map existing
            </button>
          ) : null}
          {candidate.candidateType === "page" ? (
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                decision.action === "merge_existing"
                  ? "bg-[rgba(133,222,255,0.18)] text-white"
                  : "text-white/54 hover:text-white"
              )}
              onClick={() =>
                onDecisionChange({
                  ...decision,
                  action: "merge_existing"
                })
              }
            >
              Merge existing
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              decision.action === "discard"
                ? "bg-[rgba(255,255,255,0.12)] text-white"
                : "text-white/54 hover:text-white"
            )}
            onClick={() =>
              onDecisionChange({
                ...decision,
                action: "discard"
              })
            }
          >
            Discard
          </button>
        </div>
      </div>
      {candidate.candidateType === "entity" &&
      proposalEntityType &&
      decision.action === "map_existing" ? (
        <div className="mt-4 grid gap-3 rounded-[18px] border border-white/8 bg-[rgba(6,10,20,0.55)] p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
            Map to existing {proposalEntityType.replaceAll("_", " ")}
          </div>
          {selectedMappedResult ? (
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.06] px-2.5 py-1.5">
                {selectedMappedResult.kind ? (
                  <EntityBadge
                    kind={selectedMappedResult.kind}
                    label={selectedMappedResult.label}
                    compact
                    gradient={false}
                    className="max-w-[20rem]"
                  />
                ) : (
                  <Badge className="bg-white/[0.08] text-white/78">
                    {selectedMappedResult.label}
                  </Badge>
                )}
                <button
                  type="button"
                  className="rounded-full text-white/50 transition hover:text-white"
                  onClick={() =>
                    onDecisionChange({
                      ...decision,
                      mappedEntityId: undefined,
                      mappedEntityLabel: undefined
                    })
                  }
                  aria-label="Clear mapped entity"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
            <Search className="size-4 text-white/34" />
            <input
              value={mapQuery}
              onChange={(event) => {
                setMapQuery(event.target.value);
                if (decision.mappedEntityId) {
                  onDecisionChange({
                    ...decision,
                    mappedEntityId: undefined,
                    mappedEntityLabel: undefined
                  });
                }
              }}
              placeholder={`Search existing ${proposalEntityType.replaceAll("_", " ")}`}
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
            />
          </div>
          <div className="grid gap-2">
            {mappedSearch.isPending ? (
              <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-white/48">
                Searching Forge…
              </div>
            ) : mappedResults.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-white/10 px-3 py-3 text-sm text-white/42">
                No existing {proposalEntityType.replaceAll("_", " ")} matches
                yet.
              </div>
            ) : (
              mappedResults.map((result) => {
                const selected =
                  decision.mappedEntityType === result.entityType &&
                  decision.mappedEntityId === result.entityId;
                return (
                  <button
                    key={`${result.entityType}:${result.entityId}`}
                    type="button"
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-[18px] border px-3 py-3 text-left transition",
                      selected
                        ? "border-[rgba(133,222,255,0.24)] bg-[rgba(133,222,255,0.12)] text-white"
                        : "border-white/8 bg-white/[0.03] text-white/72 hover:bg-white/[0.06] hover:text-white"
                    )}
                    onClick={() =>
                      onDecisionChange({
                        action: "map_existing",
                        mappedEntityType: result.entityType,
                        mappedEntityId: result.entityId,
                        mappedEntityLabel: result.label
                      })
                    }
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {result.kind ? (
                          <EntityBadge
                            kind={result.kind}
                            label={result.label}
                            compact
                            gradient={false}
                          />
                        ) : (
                          result.label
                        )}
                      </div>
                      {result.description ? (
                        <div className="mt-1 text-xs leading-5 text-white/46">
                          {result.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
      {candidate.candidateType === "page" &&
      decision.action === "merge_existing" ? (
        <div className="mt-4 grid gap-3 rounded-[18px] border border-white/8 bg-[rgba(6,10,20,0.55)] p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
            Merge into existing page
          </div>
          {selectedMergedPage ? (
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.06] px-2.5 py-1.5">
                <Badge className="bg-white/[0.08] text-white/78">
                  {selectedMergedPage.title}
                </Badge>
                <button
                  type="button"
                  className="rounded-full text-white/50 transition hover:text-white"
                  onClick={() =>
                    onDecisionChange({
                      ...decision,
                      targetNoteId: undefined,
                      targetNoteLabel: undefined
                    })
                  }
                  aria-label="Clear merge target"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
            <Search className="size-4 text-white/34" />
            <input
              value={mergeQuery}
              onChange={(event) => {
                setMergeQuery(event.target.value);
                if (decision.targetNoteId) {
                  onDecisionChange({
                    ...decision,
                    targetNoteId: undefined,
                    targetNoteLabel: undefined
                  });
                }
              }}
              placeholder="Search existing wiki pages"
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
            />
          </div>
          <div className="grid gap-2">
            {mergedPageSearch.isPending ? (
              <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-white/48">
                Searching Forge…
              </div>
            ) : mergedPageResults.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-white/10 px-3 py-3 text-sm text-white/42">
                No existing wiki pages match yet.
              </div>
            ) : (
              mergedPageResults.map((result) => {
                const selected = decision.targetNoteId === result.noteId;
                return (
                  <button
                    key={result.noteId}
                    type="button"
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-[18px] border px-3 py-3 text-left transition",
                      selected
                        ? "border-[rgba(133,222,255,0.24)] bg-[rgba(133,222,255,0.12)] text-white"
                        : "border-white/8 bg-white/[0.03] text-white/72 hover:bg-white/[0.06] hover:text-white"
                    )}
                    onClick={() =>
                      onDecisionChange({
                        action: "merge_existing",
                        targetNoteId: result.noteId,
                        targetNoteLabel: result.title
                      })
                    }
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {result.title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/46">
                        {result.slug ? `${result.slug}` : ""}
                        {result.summary
                          ? `${result.slug ? " · " : ""}${result.summary}`
                          : ""}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<IngestMode>("files");
  const [selectedSpaceId, setSelectedSpaceId] = useState(initialSpaceId);
  const [titleHint, setTitleHint] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [rawTextValue, setRawTextValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const usableLlmProfiles = useMemo(
    () =>
      llmProfiles.filter(
        (profile) => profile.enabled && Boolean(profile.secretId)
      ),
    [llmProfiles]
  );
  const [llmProfileId, setLlmProfileId] = useState(
    usableLlmProfiles[0]?.id ?? ""
  );
  const [parseStrategy, setParseStrategy] = useState<
    "auto" | "text_only" | "multimodal"
  >("auto");
  const [decisions, setDecisions] = useState<
    Record<string, IngestDecisionDraft>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const lastResumeAttemptRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (initialSpaceId) {
      setSelectedSpaceId(initialSpaceId);
    }
  }, [initialSpaceId]);

  useEffect(() => {
    if (!llmProfileId && usableLlmProfiles[0]?.id) {
      setLlmProfileId(usableLlmProfiles[0].id);
    }
  }, [llmProfileId, usableLlmProfiles]);

  const selectedLlmProfile =
    usableLlmProfiles.find((profile) => profile.id === llmProfileId) ??
    usableLlmProfiles[0] ??
    null;

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
    setDecisions(
      Object.fromEntries(
        job.candidates.map((candidate) => [
          candidate.id,
          candidate.status === "rejected"
            ? { action: "discard" }
            : { action: "keep" }
        ])
      )
    );
  }, [jobQuery.data]);

  useEffect(() => {
    if (reviewError) {
      setReviewError(null);
    }
  }, [decisions, reviewError]);

  const resumeJobMutation = useMutation({
    mutationFn: async (jobId: string) => resumeWikiIngestJob(jobId),
    onSuccess: (result, jobId) => {
      if (result.job) {
        queryClient.setQueryData(["forge-wiki-ingest-job", jobId], result.job);
      }
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-ingest-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["forge-wiki-ingest-history"] });
    }
  });

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !ACTIVE_JOB_STATUSES.has(job.job.status)) {
      return;
    }
    const latestLogAt = job.logs.reduce<number>((latest, entry) => {
      const createdAt = Number(new Date(entry.createdAt));
      return Number.isFinite(createdAt) ? Math.max(latest, createdAt) : latest;
    }, 0);
    const updatedAt = Number(new Date(job.job.updatedAt));
    const freshestActivityAt = Math.max(
      Number.isFinite(updatedAt) ? updatedAt : 0,
      latestLogAt
    );
    if (!Number.isFinite(freshestActivityAt) || freshestActivityAt <= 0) {
      return;
    }
    const now = Date.now();
    const isStale = now - freshestActivityAt >= STALE_INGEST_RESUME_THRESHOLD_MS;
    if (!isStale || resumeJobMutation.isPending) {
      return;
    }
    const lastAttempt = lastResumeAttemptRef.current[job.job.id] ?? 0;
    if (now - lastAttempt < STALE_INGEST_RESUME_THRESHOLD_MS) {
      return;
    }
    lastResumeAttemptRef.current[job.job.id] = now;
    resumeJobMutation.mutate(job.job.id);
  }, [jobQuery.data, resumeJobMutation]);

  const createJobMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLlmProfile) {
        throw new Error(
          "Set up an OpenAI wiki ingest profile first. Forge now requires an LLM profile before auto-ingest can turn source material into draft pages and entities."
        );
      }
      if (mode === "files") {
        if (files.length === 0) {
          throw new Error("Select at least one file to ingest.");
        }
        return createWikiIngestUploadJob({
          files,
          spaceId: selectedSpaceId || undefined,
          titleHint: titleHint.trim() || undefined,
          llmProfileId: selectedLlmProfile.id,
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
          llmProfileId: selectedLlmProfile.id,
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
        llmProfileId: selectedLlmProfile.id,
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
      await queryClient.invalidateQueries({
        queryKey: ["forge-wiki-ingest-history"]
      });
      if (nextJobId) {
        onJobSelected(nextJobId);
      }
      setFormError(null);
      setReviewError(null);
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
      const serializedDecisions = jobQuery.data.candidates.map((candidate) => {
        const decision = decisions[candidate.id] ?? { action: "keep" };
        if (
          decision.action === "map_existing" &&
          (!decision.mappedEntityType || !decision.mappedEntityId)
        ) {
          throw new Error(
            `Choose an existing ${String(
              candidate.payload.entityType ?? "entity"
            ).replaceAll("_", " ")} before publishing the review.`
          );
        }
        if (decision.action === "merge_existing" && !decision.targetNoteId) {
          throw new Error(
            `Choose an existing wiki page before publishing the review for ${candidate.title || "this page candidate"}.`
          );
        }
        return decision.action === "map_existing"
          ? {
              candidateId: candidate.id,
              action: "map_existing" as const,
              mappedEntityType: decision.mappedEntityType,
              mappedEntityId: decision.mappedEntityId
            }
          : decision.action === "merge_existing"
            ? {
                candidateId: candidate.id,
                action: "merge_existing" as const,
                targetNoteId: decision.targetNoteId
              }
          : {
              candidateId: candidate.id,
              action: decision.action
            };
      });
      return reviewWikiIngestJob({
        jobId: selectedJobId,
        decisions: serializedDecisions
      });
    },
    onSuccess: async (result) => {
      setReviewError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-ingest-jobs"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-ingest-history"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-ingest-job", result.job.job.id]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-home"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-page-by-slug"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-tree"] })
      ]);
    },
    onError: (error) => {
      setReviewError(
        error instanceof Error ? error.message : "Unable to publish review."
      );
    }
  });

  const rerunMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJobId) {
        throw new Error("Choose an ingest job first.");
      }
      return rerunWikiIngestJob(selectedJobId);
    },
    onSuccess: async (result) => {
      const nextJobId = result.job?.job.id ?? null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-ingest-jobs"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-ingest-history"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-ingest-job", selectedJobId]
        })
      ]);
      if (nextJobId) {
        onJobSelected(nextJobId);
      }
      setFormError(null);
      setReviewError(null);
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Unable to rerun ingest."
      );
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJobId) {
        throw new Error("Choose an ingest job first.");
      }
      return deleteWikiIngestJob(selectedJobId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-ingest-jobs"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-ingest-history"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["forge-wiki-ingest-job", selectedJobId]
        })
      ]);
      resetToDraft();
      setFormError(null);
      setReviewError(null);
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Unable to delete ingest."
      );
    }
  });

  const activeJob = jobQuery.data ?? null;
  const canManageActiveJob =
    activeJob && !ACTIVE_JOB_STATUSES.has(activeJob.job.status);
  const reviewableCandidates = useMemo(
    () =>
      activeJob?.candidates.filter((candidate) =>
        ["suggested", "accepted", "rejected"].includes(candidate.status)
      ) ?? [],
    [activeJob]
  );
  const displayLogs = useMemo(
    () => compactWikiIngestLogs(activeJob?.logs ?? []),
    [activeJob?.logs]
  );

  const resetToDraft = () => {
    onJobSelected(null);
    setFiles([]);
    setUrlValue("");
    setRawTextValue("");
    setTitleHint("");
    setFormError(null);
    setReviewError(null);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setFormError(null);
          setReviewError(null);
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
                  {!selectedLlmProfile ? (
                    <div className="rounded-[30px] border border-amber-300/28 bg-[linear-gradient(180deg,rgba(120,74,14,0.28),rgba(37,22,8,0.42))] p-5 shadow-[0_24px_64px_rgba(12,6,0,0.22)]">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-amber-200/20 bg-amber-300/12 text-amber-100">
                          <AlertTriangle className="size-4.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-amber-100/62">
                            OpenAI setup required for smart ingest
                          </div>
                          <div className="mt-2 text-lg font-semibold text-white">
                            Forge can only do a raw import without OpenAI
                          </div>
                          <div className="mt-3 text-sm leading-6 text-white/78">
                            Without an OpenAI ingest profile, Forge cannot
                            extract key insights, split the source into draft
                            wiki pages, or propose Forge entities. The fallback
                            is just a direct text import or media reference with
                            no structured synthesis.
                          </div>
                          <div className="mt-3 text-sm leading-6 text-white/62">
                            Set up the API key, model, thinking, and verbosity
                            first, then come back here to build real draft pages
                            and reviewable entity proposals.
                          </div>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <Button
                          className="w-full"
                          onClick={() => {
                            onOpenChange(false);
                            navigate("/settings/wiki?setupLlm=1");
                          }}
                        >
                          <Sparkles className="size-4" />
                          Open OpenAI setup
                        </Button>
                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={() => {
                            onOpenChange(false);
                            navigate("/settings/wiki");
                          }}
                        >
                          Open Wiki settings
                        </Button>
                      </div>
                    </div>
                  ) : null}

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
                            {usableLlmProfiles.map((profile) => (
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
                            {usableLlmProfiles.length === 0 ? (
                              <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-4 text-sm text-white/48">
                                No enabled profile with a saved key yet.
                              </div>
                            ) : null}
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
                    disabled={!selectedLlmProfile}
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={resetToDraft}
                        >
                          New ingest
                        </Button>
                        {canManageActiveJob ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              pending={rerunMutation.isPending}
                              pendingLabel="Rerunning"
                              onClick={() => void rerunMutation.mutateAsync()}
                            >
                              <Sparkles className="size-3.5" />
                              Rerun
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="border border-rose-300/18 bg-rose-400/10 text-rose-100 hover:bg-rose-400/16"
                              pending={deleteMutation.isPending}
                              pendingLabel="Deleting"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Delete this ingest history entry? Published pages or entities will stay, but discarded or unreviewed ingest data will be removed."
                                  )
                                ) {
                                  void deleteMutation.mutateAsync();
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
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

                    {formError ? (
                      <div className="mt-4 rounded-[20px] border border-rose-300/22 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                        {formError}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-[28px] border border-white/8 bg-white/[0.04] p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                        Rich log
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          navigate(
                            `/settings/logs?jobId=${encodeURIComponent(activeJob.job.id)}`
                          )
                        }
                      >
                        Open full logs
                      </Button>
                    </div>
                    <div className="mt-4 grid max-h-[28rem] gap-2 overflow-y-auto">
                      {displayLogs.length === 0 ? (
                        <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-4 text-sm text-white/45">
                          Waiting for the backend to emit progress.
                        </div>
                      ) : (
                        displayLogs.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-[18px] border border-white/8 bg-[rgba(7,11,21,0.72)] px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
                                    {entry.level}
                                  </span>
                                  {typeof entry.metadata.scope === "string" ? (
                                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">
                                      {entry.metadata.scope}
                                    </span>
                                  ) : null}
                                  {typeof entry.metadata.eventKey === "string" ? (
                                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">
                                      {entry.metadata.eventKey}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-2 text-sm text-white/82">
                                  {readMetadataString(
                                    entry.metadata,
                                    "eventKey"
                                  ) === "llm_compile_background_polled"
                                    ? buildPollingDisplayMessage(
                                        entry,
                                        entry.repetitionCount
                                      )
                                    : entry.message}
                                </div>
                                {entry.repetitionCount > 1 ? (
                                  <div className="mt-2 text-xs text-white/44">
                                    Combined {entry.repetitionCount} repeated
                                    polling updates.
                                  </div>
                                ) : null}
                                {Object.keys(entry.metadata).length > 0 ? (
                                  <details className="mt-3">
                                    <summary className="cursor-pointer text-xs text-white/45">
                                      View metadata
                                    </summary>
                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[14px] border border-white/8 bg-black/20 px-3 py-3 text-[11px] leading-5 text-white/52">
                                      {JSON.stringify(entry.metadata, null, 2)}
                                    </pre>
                                  </details>
                                ) : null}
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
                            spaceId={activeJob.job.spaceId}
                            decision={
                              decisions[candidate.id] ?? { action: "keep" }
                            }
                            onDecisionChange={(next) =>
                              setDecisions((current) => ({
                                ...current,
                                [candidate.id]: next
                              }))
                            }
                          />
                        ))
                      )}
                    </div>

                    {reviewError ? (
                      <div className="mt-4 rounded-[20px] border border-rose-300/22 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                        {reviewError}
                      </div>
                    ) : null}

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
