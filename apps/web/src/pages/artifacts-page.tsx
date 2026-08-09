import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
  FileSearch,
  Files,
  KeyRound,
  Link2,
  Lock,
  Pencil,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  XCircle
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArtifactEntityLinksEditor,
  ArtifactEntityLinksList,
  ArtifactEntityTypeInput,
  artifactEntityLinkDraftsToInputs,
  artifactEntityLinksToDrafts,
  validateArtifactEntityLinkDrafts,
  type ArtifactEntityLinkDraft
} from "@/components/artifacts/artifact-entity-links";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteEntities,
  downloadArtifact,
  downloadArtifactWithPassword,
  encryptArtifact,
  enrichArtifact,
  getArtifact,
  listArtifactAuditEvents,
  listArtifacts,
  listArtifactVersions,
  patchArtifact,
  patchArtifactTrust,
  replaceArtifactEntityLinks,
  rescanArtifact,
  uploadArtifact
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Artifact,
  ArtifactDangerLevel,
  ArtifactFormatFamily,
  ArtifactMetadataPatchInput,
  ArtifactState,
  ArtifactSummary,
  ArtifactScanFinding,
  ArtifactScanResult,
  ArtifactSourceKind,
  ArtifactUploadInput,
  ArtifactTrustPatchInput,
  EntityLinkInput
} from "@/lib/types";

const DANGER_LEVELS: ArtifactDangerLevel[] = [
  "low",
  "moderate",
  "high",
  "blocked"
];

const FORMAT_FAMILIES: ArtifactFormatFamily[] = [
  "spreadsheet",
  "document",
  "presentation",
  "pdf",
  "text",
  "structured_text",
  "image"
];

const ARTIFACT_STATES: ArtifactState[] = [
  "active",
  "quarantined",
  "blocked",
  "archived",
  "metadata_only"
];

const ARTIFACT_PAGE_SIZE = 50;
const ARTIFACT_HISTORY_PAGE_SIZE = 10;
const ARTIFACT_SEARCH_DEBOUNCE_MS = 200;
const MAX_ARTIFACT_UPLOAD_QUEUE_FILES = 25;
const MAX_ARTIFACT_UPLOAD_BYTES = 100 * 1024 * 1024;
const ARTIFACT_UPLOAD_CONCURRENCY = 2;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatIdentity(value: string | null | undefined) {
  return value?.trim() || "Not recorded";
}

function formatMetadataJson(value: Record<string, unknown>) {
  return Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : "{}";
}

function metadataFieldCount(value: string) {
  try {
    return Object.keys(parseMetadataText(value)).length;
  } catch {
    return null;
  }
}

function dangerClass(level: ArtifactDangerLevel) {
  if (level === "blocked") {
    return "border-[color-mix(in_srgb,var(--danger)_38%,var(--ui-border-subtle)_62%)] bg-[var(--ui-danger-soft)] text-[var(--danger)]";
  }
  if (level === "high") {
    return "border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] text-[var(--danger)]";
  }
  if (level === "moderate") {
    return "border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[var(--warning)]";
  }
  return "border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-success-soft)] text-[var(--success)]";
}

function isScanResult(
  value: Artifact["scanResults"]
): value is ArtifactScanResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as ArtifactScanResult).findings)
  );
}

function scanFindings(artifact: Artifact | null): ArtifactScanFinding[] {
  if (!artifact || !isScanResult(artifact.scanResults)) {
    return [];
  }
  return artifact.scanResults.findings;
}

function artifactUploadAbortError() {
  const error = new Error("Artifact upload canceled.");
  error.name = "AbortError";
  return error;
}

function isArtifactUploadAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function fileToBase64(
  file: File,
  signal: AbortSignal,
  onProgress: (percentage: number) => void
) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", abortRead);
    const abortRead = () => reader.abort();
    reader.onload = () => {
      settled = true;
      cleanup();
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",")
        ? result.slice(result.indexOf(",") + 1)
        : result;
      onProgress(100);
      resolve(base64);
    };
    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    reader.onerror = () => {
      settled = true;
      cleanup();
      reject(reader.error ?? new Error("Unable to read file."));
    };
    reader.onabort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(artifactUploadAbortError());
    };
    if (signal.aborted) {
      reject(artifactUploadAbortError());
      return;
    }
    signal.addEventListener("abort", abortRead, { once: true });
    onProgress(0);
    reader.readAsDataURL(file);
  });
}

function createUploadQueueItem(file: File): ArtifactUploadQueueItem {
  const title = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
  return {
    id: randomId,
    idempotencyKey: `artifact-ui-${randomId}`,
    file,
    title,
    shortDescription: "",
    description: "",
    sourceLabel: "",
    sourceKind: "upload",
    useLlmEnrichment: false,
    linkDrafts: [],
    metadataText: ""
  };
}

function appendUploadFiles(value: ArtifactUploadFlowValue, files: File[]) {
  const nonEmptyFiles = files.filter((file) => file.size > 0);
  const eligibleFiles = nonEmptyFiles.filter(
    (file) => file.size <= MAX_ARTIFACT_UPLOAD_BYTES
  );
  const availableSlots = Math.max(
    0,
    MAX_ARTIFACT_UPLOAD_QUEUE_FILES - value.items.length
  );
  const acceptedFiles = eligibleFiles.slice(0, availableSlots);
  const messages: string[] = [];
  if (nonEmptyFiles.length !== files.length) {
    messages.push("Empty files cannot be added to the Artifact Store.");
  }
  if (eligibleFiles.length !== nonEmptyFiles.length) {
    messages.push("Artifact files may not exceed 100 MiB each.");
  }
  if (eligibleFiles.length > availableSlots) {
    messages.push(
      `The upload queue accepts at most ${MAX_ARTIFACT_UPLOAD_QUEUE_FILES} files.`
    );
  }
  return {
    value:
      acceptedFiles.length === 0
        ? value
        : {
            ...value,
            items: [
              ...value.items,
              ...acceptedFiles.map(createUploadQueueItem)
            ],
            activeItemId: null
          },
    error: messages.length > 0 ? messages.join(" ") : null
  };
}

function updateUploadItem(
  value: ArtifactUploadFlowValue,
  itemId: string,
  patch: Partial<ArtifactUploadQueueItem>
): ArtifactUploadFlowValue {
  return {
    ...value,
    items: value.items.map((item) =>
      item.id === itemId ? { ...item, ...patch } : item
    )
  };
}

function removeUploadItem(
  value: ArtifactUploadFlowValue,
  itemId: string
): ArtifactUploadFlowValue {
  return {
    ...value,
    items: value.items.filter((item) => item.id !== itemId),
    activeItemId: value.activeItemId === itemId ? null : value.activeItemId
  };
}

function parseMetadataText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isEncryptedArtifact(
  artifact: Artifact | ArtifactSummary | null | undefined
) {
  return artifact?.contentProtection.mode === "password_encrypted";
}

type UploadDraft = {
  title: string;
  shortDescription: string;
  description: string;
  sourceLabel: string;
  useLlmEnrichment: boolean;
  linkDrafts: ArtifactEntityLinkDraft[];
};

type ArtifactUploadQueueItem = UploadDraft & {
  id: string;
  idempotencyKey: string;
  file: File;
  sourceKind: ArtifactSourceKind;
  metadataText: string;
};

type ArtifactUploadFlowValue = {
  items: ArtifactUploadQueueItem[];
  activeItemId: string | null;
  bulkShortDescription: string;
  bulkSourceLabel: string;
  bulkSourceKind: ArtifactSourceKind;
  bulkUseLlmEnrichment: boolean;
  encryptContent: boolean;
  contentPassword: string;
  contentPasswordConfirm: string;
  contentPasswordHint: string;
};

type PasswordFlowValue = {
  password: string;
};

type EncryptFlowValue = {
  password: string;
  passwordConfirm: string;
  passwordHint: string;
};

type ArtifactLinkFlowValue = {
  drafts: ArtifactEntityLinkDraft[];
};

type ArtifactMetadataFlowValue = {
  title: string;
  shortDescription: string;
  description: string;
  sourceLabel: string;
  metadataText: string;
};

type ArtifactTrustFlowValue = ArtifactTrustPatchInput;

type ArtifactUploadResult = {
  itemId: string;
  fileName: string;
  status: "queued" | "reading" | "uploading" | "success" | "error" | "canceled";
  progress: number;
  artifactId?: string;
  title?: string;
  contentSha256?: string;
  error?: string;
};

type ArtifactUploadBatchRequest = {
  items: ArtifactUploadQueueItem[];
  contentProtection:
    | { mode: "password_encrypted"; password: string; passwordHint: string }
    | undefined;
};

const EMPTY_UPLOAD_FLOW_VALUE: ArtifactUploadFlowValue = {
  items: [],
  activeItemId: null,
  bulkShortDescription: "",
  bulkSourceLabel: "",
  bulkSourceKind: "upload",
  bulkUseLlmEnrichment: false,
  encryptContent: false,
  contentPassword: "",
  contentPasswordConfirm: "",
  contentPasswordHint: ""
};

const EMPTY_PASSWORD_FLOW_VALUE: PasswordFlowValue = {
  password: ""
};

const EMPTY_ENCRYPT_FLOW_VALUE: EncryptFlowValue = {
  password: "",
  passwordConfirm: "",
  passwordHint: ""
};

const EMPTY_LINK_FLOW_VALUE: ArtifactLinkFlowValue = {
  drafts: []
};

const EMPTY_METADATA_FLOW_VALUE: ArtifactMetadataFlowValue = {
  title: "",
  shortDescription: "",
  description: "",
  sourceLabel: "",
  metadataText: "{}"
};

const EMPTY_TRUST_FLOW_VALUE: ArtifactTrustFlowValue = {
  artifactState: "active",
  downloadPolicy: "human_only",
  reason: ""
};

const ARTIFACT_ACCEPT_EXTENSIONS = [
  ".xlsx",
  ".xlsm",
  ".docx",
  ".pptx",
  ".pdf",
  ".csv",
  ".tsv",
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp"
].join(",");

const SOURCE_KIND_OPTIONS: ArtifactSourceKind[] = [
  "upload",
  "external_reference",
  "manual"
];

function ArtifactListItem({
  artifact,
  selected,
  onSelect
}: {
  artifact: ArtifactSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "min-h-[6.75rem] w-full rounded-[var(--radius-card)] border p-3 text-left transition",
        selected
          ? "border-[color-mix(in_srgb,var(--primary)_45%,var(--ui-border-subtle)_55%)] bg-[var(--ui-accent-soft)]"
          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] hover:bg-[var(--ui-surface-hover)]"
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
            {artifact.title}
          </div>
          <div className="mt-1 truncate text-xs text-[var(--ui-ink-muted)]">
            {artifact.originalFileName}
          </div>
        </div>
        <Badge
          size="xs"
          className={cn("shrink-0", dangerClass(artifact.dangerLevel))}
        >
          {artifact.dangerScore}/100
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge size="xs" tone="meta">
          {artifact.detectedExtension.toUpperCase()}
        </Badge>
        <Badge size="xs" tone="meta">
          {formatBytes(artifact.byteSize)}
        </Badge>
        {isEncryptedArtifact(artifact) ? (
          <Badge size="xs" tone="meta">
            <Lock className="size-3" />
            Encrypted
          </Badge>
        ) : null}
        <Badge size="xs" tone="meta">
          {titleCase(artifact.artifactState)}
        </Badge>
      </div>
    </button>
  );
}

function UploadResultBadge({
  result
}: {
  result: ArtifactUploadResult | undefined;
}) {
  if (!result) {
    return (
      <Badge size="xs" tone="meta">
        Pending
      </Badge>
    );
  }
  if (result.status === "queued") {
    return (
      <Badge size="xs" tone="meta">
        Queued
      </Badge>
    );
  }
  if (result.status === "reading") {
    return (
      <Badge size="xs" tone="meta">
        Preparing {result.progress}%
      </Badge>
    );
  }
  if (result.status === "uploading") {
    return (
      <Badge size="xs" tone="meta">
        Uploading {result.progress}%
      </Badge>
    );
  }
  if (result.status === "success") {
    return (
      <Badge
        size="xs"
        className="border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-success-soft)] text-[var(--success)]"
      >
        Uploaded
      </Badge>
    );
  }
  if (result.status === "canceled") {
    return (
      <Badge size="xs" tone="meta">
        Canceled
      </Badge>
    );
  }
  return (
    <Badge
      size="xs"
      className="border-[color-mix(in_srgb,var(--danger)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-danger-soft)] text-[var(--danger)]"
    >
      Failed
    </Badge>
  );
}

function UploadProgressState({
  result
}: {
  result: ArtifactUploadResult | undefined;
}) {
  if (
    !result ||
    (result.status !== "queued" &&
      result.status !== "reading" &&
      result.status !== "uploading")
  ) {
    return null;
  }
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[var(--ui-surface-2)]"
        role="progressbar"
        aria-label={`Upload progress for ${result.fileName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={result.progress}
      >
        <div
          className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `${result.progress}%` }}
        />
      </div>
      <span className="text-xs text-[var(--ui-ink-muted)]">
        {result.status === "queued"
          ? "Waiting for an upload slot"
          : result.status === "reading"
            ? "Preparing file"
            : "Sending to Forge"}
      </span>
    </div>
  );
}

function ArtifactMetadataField({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-[var(--ui-border-subtle)] py-3 last:border-b-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 break-words text-sm text-[var(--ui-ink-medium)]",
          mono && "font-mono text-xs"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function ArtifactsPage() {
  const { artifactId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const artifactListRef = useRef<HTMLDivElement>(null);
  const [artifactState, setArtifactState] = useState<ArtifactState | "">("");
  const [dangerLevel, setDangerLevel] = useState<ArtifactDangerLevel | "">("");
  const [formatFamily, setFormatFamily] = useState<ArtifactFormatFamily | "">(
    ""
  );
  const [linkedEntityType, setLinkedEntityType] = useState("");
  const [linkedEntityId, setLinkedEntityId] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [versionPageIndex, setVersionPageIndex] = useState(0);
  const [auditPageIndex, setAuditPageIndex] = useState(0);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [trustDialogOpen, setTrustDialogOpen] = useState(false);
  const [linksDialogOpen, setLinksDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [downloadPasswordDialogOpen, setDownloadPasswordDialogOpen] =
    useState(false);
  const [encryptDialogOpen, setEncryptDialogOpen] = useState(false);
  const [uploadFlowValue, setUploadFlowValue] =
    useState<ArtifactUploadFlowValue>(EMPTY_UPLOAD_FLOW_VALUE);
  const uploadAbortControllersRef = useRef(new Map<string, AbortController>());
  const canceledUploadItemIdsRef = useRef(new Set<string>());
  const previousActiveUploadItemIdRef = useRef<string | null>(null);
  const [downloadPasswordValue, setDownloadPasswordValue] =
    useState<PasswordFlowValue>(EMPTY_PASSWORD_FLOW_VALUE);
  const [encryptFlowValue, setEncryptFlowValue] = useState<EncryptFlowValue>(
    EMPTY_ENCRYPT_FLOW_VALUE
  );
  const [linkFlowValue, setLinkFlowValue] = useState<ArtifactLinkFlowValue>(
    EMPTY_LINK_FLOW_VALUE
  );
  const [metadataFlowValue, setMetadataFlowValue] =
    useState<ArtifactMetadataFlowValue>(EMPTY_METADATA_FLOW_VALUE);
  const [trustFlowValue, setTrustFlowValue] = useState<ArtifactTrustFlowValue>(
    EMPTY_TRUST_FLOW_VALUE
  );
  const [uploadResults, setUploadResults] = useState<ArtifactUploadResult[]>(
    []
  );
  const [uploadDialogError, setUploadDialogError] = useState<string | null>(
    null
  );
  const [downloadPasswordError, setDownloadPasswordError] = useState<
    string | null
  >(null);
  const [encryptDialogError, setEncryptDialogError] = useState<string | null>(
    null
  );
  const [linksDialogError, setLinksDialogError] = useState<string | null>(null);
  const [metadataDialogError, setMetadataDialogError] = useState<string | null>(
    null
  );
  const [trustDialogError, setTrustDialogError] = useState<string | null>(null);
  const [uploadedArtifactToOpenId, setUploadedArtifactToOpenId] = useState<
    string | null
  >(null);
  const hasCompleteLinkedEntityFilter = Boolean(
    linkedEntityType.trim() && linkedEntityId.trim()
  );
  const hasAnyFilter = Boolean(
    query.trim() ||
    artifactState ||
    dangerLevel ||
    formatFamily ||
    linkedEntityType.trim() ||
    linkedEntityId.trim()
  );

  const artifactsQuery = useQuery({
    queryKey: [
      "artifacts",
      committedQuery,
      artifactState,
      dangerLevel,
      formatFamily,
      linkedEntityType,
      linkedEntityId,
      pageIndex
    ],
    queryFn: () =>
      listArtifacts({
        query: committedQuery || undefined,
        artifactState: artifactState || undefined,
        dangerLevel: dangerLevel || undefined,
        formatFamily: formatFamily || undefined,
        linkedEntityType: hasCompleteLinkedEntityFilter
          ? linkedEntityType
          : undefined,
        linkedEntityId: hasCompleteLinkedEntityFilter
          ? linkedEntityId
          : undefined,
        limit: ARTIFACT_PAGE_SIZE,
        offset: pageIndex * ARTIFACT_PAGE_SIZE
      }),
    placeholderData: (previous) => previous
  });

  const artifacts = useMemo(
    () => artifactsQuery.data?.artifacts ?? [],
    [artifactsQuery.data?.artifacts]
  );
  const totalArtifacts = artifactsQuery.data?.total ?? artifacts.length;
  const pageOffset =
    artifactsQuery.data?.offset ?? pageIndex * ARTIFACT_PAGE_SIZE;
  const pageStart = totalArtifacts === 0 ? 0 : pageOffset + 1;
  const pageEnd = Math.min(pageOffset + artifacts.length, totalArtifacts);
  const hasPreviousPage = pageIndex > 0;
  const hasNextPage = Boolean(artifactsQuery.data?.hasMore);
  const selectedArtifactQuery = useQuery({
    queryKey: ["artifact", artifactId],
    enabled: Boolean(artifactId),
    queryFn: () => getArtifact(artifactId!)
  });
  const selectedArtifact = useMemo(
    () => (artifactId ? (selectedArtifactQuery.data?.artifact ?? null) : null),
    [artifactId, selectedArtifactQuery.data?.artifact]
  );
  const artifactListUpdating =
    query.trim() !== committedQuery ||
    (artifactsQuery.isFetching && !artifactsQuery.isLoading);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setCommittedQuery(query.trim()),
      ARTIFACT_SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timeoutId);
  }, [query]);

  const versionsQuery = useQuery({
    queryKey: ["artifact-versions", selectedArtifact?.id, versionPageIndex],
    enabled: Boolean(selectedArtifact?.id),
    queryFn: () =>
      listArtifactVersions(selectedArtifact!.id, {
        limit: ARTIFACT_HISTORY_PAGE_SIZE,
        offset: versionPageIndex * ARTIFACT_HISTORY_PAGE_SIZE
      }),
    retry: false
  });

  const auditQuery = useQuery({
    queryKey: ["artifact-audit", selectedArtifact?.id, auditPageIndex],
    enabled: Boolean(selectedArtifact?.id),
    queryFn: () =>
      listArtifactAuditEvents(selectedArtifact!.id, {
        limit: ARTIFACT_HISTORY_PAGE_SIZE,
        offset: auditPageIndex * ARTIFACT_HISTORY_PAGE_SIZE
      }),
    retry: false
  });

  useEffect(() => {
    setVersionPageIndex(0);
    setAuditPageIndex(0);
  }, [selectedArtifact?.id]);

  useEffect(() => {
    const firstArtifact = artifacts[0];
    if (!artifactId && firstArtifact && !uploadDialogOpen) {
      navigate(`/artifacts/${firstArtifact.id}`, { replace: true });
    }
  }, [artifactId, artifacts, navigate, uploadDialogOpen]);

  useEffect(() => {
    setPageIndex(0);
  }, [
    committedQuery,
    artifactState,
    dangerLevel,
    formatFamily,
    linkedEntityType,
    linkedEntityId
  ]);

  useEffect(() => {
    if (typeof artifactListRef.current?.scrollTo === "function") {
      artifactListRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [pageIndex, committedQuery, artifactState, dangerLevel, formatFamily]);

  useEffect(() => {
    if (pageIndex > 0 && artifactsQuery.data && artifacts.length === 0) {
      setPageIndex((current) => Math.max(0, current - 1));
    }
  }, [artifacts.length, artifactsQuery.data, pageIndex]);

  useEffect(() => {
    if (!selectedArtifact) {
      setArchiveDialogOpen(false);
      setDownloadPasswordDialogOpen(false);
      setEncryptDialogOpen(false);
      setLinksDialogOpen(false);
      setMetadataDialogOpen(false);
      setTrustDialogOpen(false);
    }
  }, [selectedArtifact]);

  useEffect(() => {
    if (!uploadDialogOpen && uploadedArtifactToOpenId) {
      navigate(`/artifacts/${uploadedArtifactToOpenId}`);
      setUploadedArtifactToOpenId(null);
    }
  }, [navigate, uploadDialogOpen, uploadedArtifactToOpenId]);

  useEffect(() => {
    if (!uploadDialogOpen) {
      previousActiveUploadItemIdRef.current = null;
      return;
    }
    const previousItemId = previousActiveUploadItemIdRef.current;
    const activeItemId = uploadFlowValue.activeItemId;
    const frame = window.requestAnimationFrame(() => {
      if (activeItemId) {
        document
          .querySelector<HTMLElement>("[data-upload-detail-panel]")
          ?.focus();
        return;
      }
      if (previousItemId) {
        document
          .querySelector<HTMLElement>(
            `[data-upload-details-id="${previousItemId}"]`
          )
          ?.focus();
      }
    });
    previousActiveUploadItemIdRef.current = activeItemId;
    return () => window.cancelAnimationFrame(frame);
  }, [uploadDialogOpen, uploadFlowValue.activeItemId]);

  const invalidateArtifacts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
      queryClient.invalidateQueries({ queryKey: ["artifact"] }),
      queryClient.invalidateQueries({ queryKey: ["artifact-versions"] }),
      queryClient.invalidateQueries({ queryKey: ["artifact-audit"] }),
      queryClient.invalidateQueries({ queryKey: ["knowledge-graph"] })
    ]);
  };

  const recordUploadResult = useCallback((nextResult: ArtifactUploadResult) => {
    setUploadResults((current) => {
      const merged = new Map(current.map((result) => [result.itemId, result]));
      merged.set(nextResult.itemId, nextResult);
      return Array.from(merged.values());
    });
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async ({
      items,
      contentProtection
    }: ArtifactUploadBatchRequest) => {
      if (items.length === 0) {
        throw new Error("Choose one or more files first.");
      }
      const resultByItemId = new Map<string, ArtifactUploadResult>();
      let nextItemIndex = 0;
      for (const item of items) {
        recordUploadResult({
          itemId: item.id,
          fileName: item.file.name,
          status: "queued",
          progress: 0
        });
      }

      const uploadOne = async (item: ArtifactUploadQueueItem) => {
        if (canceledUploadItemIdsRef.current.has(item.id)) {
          const canceled: ArtifactUploadResult = {
            itemId: item.id,
            fileName: item.file.name,
            status: "canceled",
            progress: 0
          };
          resultByItemId.set(item.id, canceled);
          recordUploadResult(canceled);
          return;
        }
        const controller = new AbortController();
        uploadAbortControllersRef.current.set(item.id, controller);
        try {
          if (item.file.size === 0) {
            throw new Error("Empty files cannot be uploaded.");
          }
          if (item.file.size > MAX_ARTIFACT_UPLOAD_BYTES) {
            throw new Error("Artifact files may not exceed 100 MiB each.");
          }
          recordUploadResult({
            itemId: item.id,
            fileName: item.file.name,
            status: "reading",
            progress: 0
          });
          const contentBase64 = await fileToBase64(
            item.file,
            controller.signal,
            (percentage) =>
              recordUploadResult({
                itemId: item.id,
                fileName: item.file.name,
                status: "reading",
                progress: Math.round(percentage * 0.2)
              })
          );
          const input: ArtifactUploadInput = {
            idempotencyKey: item.idempotencyKey,
            title: item.title.trim() || undefined,
            shortDescription: item.shortDescription,
            description: item.description,
            originalFileName: item.file.name,
            declaredMimeType: item.file.type,
            contentBase64,
            sourceKind: item.sourceKind,
            sourceLabel: item.sourceLabel,
            metadata: parseMetadataText(item.metadataText),
            links: artifactEntityLinkDraftsToInputs(item.linkDrafts),
            contentProtection,
            useLlmEnrichment: item.useLlmEnrichment
          };
          const { artifact } = await uploadArtifact(input, {
            idempotencyKey: item.idempotencyKey,
            signal: controller.signal,
            onProgress: (percentage) =>
              recordUploadResult({
                itemId: item.id,
                fileName: item.file.name,
                status: "uploading",
                progress: Math.min(99, 20 + Math.round(percentage * 0.79))
              })
          });
          const success: ArtifactUploadResult = {
            itemId: item.id,
            fileName: item.file.name,
            status: "success",
            progress: 100,
            artifactId: artifact.id,
            title: artifact.title,
            contentSha256: artifact.contentSha256
          };
          resultByItemId.set(item.id, success);
          recordUploadResult(success);
        } catch (error) {
          const failed: ArtifactUploadResult = {
            itemId: item.id,
            fileName: item.file.name,
            status: isArtifactUploadAbort(error) ? "canceled" : "error",
            progress: 0,
            error: isArtifactUploadAbort(error)
              ? undefined
              : readErrorMessage(error)
          };
          resultByItemId.set(item.id, failed);
          recordUploadResult(failed);
        } finally {
          uploadAbortControllersRef.current.delete(item.id);
        }
      };

      const workers = Array.from(
        {
          length: Math.min(ARTIFACT_UPLOAD_CONCURRENCY, items.length)
        },
        async () => {
          while (nextItemIndex < items.length) {
            const item = items[nextItemIndex];
            nextItemIndex += 1;
            if (item) {
              await uploadOne(item);
            }
          }
        }
      );
      await Promise.all(workers);
      return items
        .map((item) => resultByItemId.get(item.id))
        .filter((result): result is ArtifactUploadResult => Boolean(result));
    },
    onSuccess: async (results) => {
      await invalidateArtifacts();
      const firstSuccess = results.find(
        (result) => result.status === "success"
      );
      if (firstSuccess?.status === "success" && firstSuccess.artifactId) {
        setUploadedArtifactToOpenId(firstSuccess.artifactId);
      }
    }
  });

  const cancelUploadItem = useCallback(
    (itemId: string) => {
      canceledUploadItemIdsRef.current.add(itemId);
      uploadAbortControllersRef.current.get(itemId)?.abort();
      const item = uploadFlowValue.items.find(
        (candidate) => candidate.id === itemId
      );
      if (item) {
        recordUploadResult({
          itemId,
          fileName: item.file.name,
          status: "canceled",
          progress: 0
        });
      }
    },
    [recordUploadResult, uploadFlowValue.items]
  );

  const cancelAllUploads = useCallback(() => {
    for (const item of uploadFlowValue.items) {
      const result = uploadResults.find(
        (candidate) => candidate.itemId === item.id
      );
      if (result?.status !== "success") {
        cancelUploadItem(item.id);
      }
    }
  }, [cancelUploadItem, uploadFlowValue.items, uploadResults]);

  const uploadBatchSnapshot = useCallback(
    (items: ArtifactUploadQueueItem[]) => ({
      items,
      contentProtection: uploadFlowValue.encryptContent
        ? {
            mode: "password_encrypted" as const,
            password: uploadFlowValue.contentPassword,
            passwordHint: uploadFlowValue.contentPasswordHint
          }
        : undefined
    }),
    [
      uploadFlowValue.contentPassword,
      uploadFlowValue.contentPasswordHint,
      uploadFlowValue.encryptContent
    ]
  );

  const retryUploadItem = useCallback(
    (item: ArtifactUploadQueueItem) => {
      canceledUploadItemIdsRef.current.delete(item.id);
      recordUploadResult({
        itemId: item.id,
        fileName: item.file.name,
        status: "reading",
        progress: 0
      });
      void uploadMutation.mutateAsync(uploadBatchSnapshot([item]));
    },
    [recordUploadResult, uploadBatchSnapshot, uploadMutation]
  );

  const patchMutation = useMutation({
    mutationFn: (patch: ArtifactMetadataPatchInput) =>
      patchArtifact(selectedArtifact!.id, patch),
    onSuccess: async () => {
      setMetadataDialogOpen(false);
      setMetadataDialogError(null);
      await invalidateArtifacts();
    },
    onError: (error) => setMetadataDialogError(readErrorMessage(error))
  });

  const trustMutation = useMutation({
    mutationFn: (input: ArtifactTrustPatchInput) =>
      patchArtifactTrust(selectedArtifact!.id, input),
    onSuccess: async () => {
      setTrustDialogOpen(false);
      setTrustDialogError(null);
      await invalidateArtifacts();
    },
    onError: (error) => setTrustDialogError(readErrorMessage(error))
  });

  const scanMutation = useMutation({
    mutationFn: ({ artifactId }: { artifactId: string }) =>
      rescanArtifact(artifactId),
    onSuccess: invalidateArtifacts
  });

  const enrichMutation = useMutation({
    mutationFn: () =>
      enrichArtifact(selectedArtifact!.id, { fillMissingOnly: true }),
    onSuccess: invalidateArtifacts
  });

  const linksMutation = useMutation({
    mutationFn: (links: EntityLinkInput[]) =>
      replaceArtifactEntityLinks(selectedArtifact!.id, links),
    onSuccess: async () => {
      setLinksDialogOpen(false);
      setLinksDialogError(null);
      await invalidateArtifacts();
    }
  });

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const artifact = selectedArtifact!;
      if (isEncryptedArtifact(artifact)) {
        setDownloadPasswordValue(EMPTY_PASSWORD_FLOW_VALUE);
        setDownloadPasswordError(null);
        setDownloadPasswordDialogOpen(true);
        return;
      }
      const result = await downloadArtifact(artifact.id);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName ?? artifact.originalFileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  });

  const passwordDownloadMutation = useMutation({
    mutationFn: async (password: string) => {
      const artifact = selectedArtifact!;
      const result = await downloadArtifactWithPassword(artifact.id, password);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName ?? artifact.originalFileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      setDownloadPasswordDialogOpen(false);
      setDownloadPasswordValue(EMPTY_PASSWORD_FLOW_VALUE);
      setDownloadPasswordError(null);
    },
    onError: (error) => {
      setDownloadPasswordError(readErrorMessage(error));
    }
  });

  const encryptMutation = useMutation({
    mutationFn: async (value: EncryptFlowValue) => {
      const artifact = selectedArtifact!;
      return encryptArtifact(artifact.id, {
        password: value.password,
        passwordHint: value.passwordHint
      });
    },
    onSuccess: async () => {
      setEncryptDialogOpen(false);
      setEncryptFlowValue(EMPTY_ENCRYPT_FLOW_VALUE);
      setEncryptDialogError(null);
      await invalidateArtifacts();
    },
    onError: (error) => {
      setEncryptDialogError(readErrorMessage(error));
    }
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const artifact = selectedArtifact!;
      const response = await deleteEntities({
        atomic: true,
        operations: [
          {
            entityType: "artifact",
            id: artifact.id,
            mode: "soft",
            reason: "Archived from the Artifact Store web app."
          }
        ]
      });
      const result = response.results[0] as
        | { ok?: boolean; error?: { message?: string } | string }
        | undefined;
      if (!result?.ok) {
        const error = result?.error;
        const message =
          typeof error === "string"
            ? error
            : (error?.message ?? "Forge could not archive this artifact.");
        throw new Error(message);
      }
      return response;
    },
    onSuccess: async () => {
      setArchiveDialogOpen(false);
      await invalidateArtifacts();
      navigate("/artifacts", { replace: true });
    }
  });

  const findings = scanFindings(selectedArtifact);
  const selectedScanError =
    selectedArtifact &&
    scanMutation.isError &&
    scanMutation.variables?.artifactId === selectedArtifact.id
      ? scanMutation.error
      : null;
  const selectedScanPending = Boolean(
    selectedArtifact &&
      scanMutation.isPending &&
      scanMutation.variables?.artifactId === selectedArtifact.id
  );
  const selectedArtifactHasScanEvidence = Boolean(
    selectedArtifact && isScanResult(selectedArtifact.scanResults)
  );
  const versionCount =
    versionsQuery.data?.total ?? versionsQuery.data?.versions.length ?? 0;
  const auditEvents = auditQuery.data?.events ?? [];
  const downloadDisabledReason = selectedArtifact
    ? selectedArtifact.artifactState === "blocked"
      ? "Download is blocked by the artifact safety state."
      : selectedArtifact.downloadPolicy !== "human_only"
        ? "Download is disabled by this artifact's policy."
        : null
    : null;
  const artifactActionError =
    patchMutation.error ??
    trustMutation.error ??
    enrichMutation.error ??
    downloadMutation.error;
  const enrichmentStatus = selectedArtifact?.enrichmentResults as
    | { status?: unknown; reason?: unknown; error?: unknown }
    | undefined;

  const uploadResultByItemId = useMemo(
    () => new Map(uploadResults.map((result) => [result.itemId, result])),
    [uploadResults]
  );

  const openUploadDialog = () => {
    for (const controller of uploadAbortControllersRef.current.values()) {
      controller.abort();
    }
    uploadAbortControllersRef.current.clear();
    canceledUploadItemIdsRef.current.clear();
    setUploadFlowValue(EMPTY_UPLOAD_FLOW_VALUE);
    setUploadResults([]);
    setUploadDialogError(null);
    setUploadedArtifactToOpenId(null);
    setUploadDialogOpen(true);
  };

  const openMetadataDialog = () => {
    if (!selectedArtifact) {
      return;
    }
    setMetadataFlowValue({
      title: selectedArtifact.title,
      shortDescription: selectedArtifact.shortDescription,
      description: selectedArtifact.description,
      sourceLabel: selectedArtifact.sourceLabel,
      metadataText: formatMetadataJson(selectedArtifact.metadata)
    });
    setMetadataDialogError(null);
    setMetadataDialogOpen(true);
  };

  const openTrustDialog = () => {
    if (!selectedArtifact) {
      return;
    }
    setTrustFlowValue({
      artifactState: selectedArtifact.artifactState,
      downloadPolicy: selectedArtifact.downloadPolicy,
      reason: ""
    });
    setTrustDialogError(null);
    setTrustDialogOpen(true);
  };

  const uploadFlowSteps = useMemo<
    Array<QuestionFlowStep<ArtifactUploadFlowValue>>
  >(
    () => [
      {
        id: "files",
        eyebrow: "Select",
        title: "Choose the files to preserve",
        description:
          "Select one or more trusted files. Forge stores bytes content-addressably, scans them conservatively, and keeps downloads human-only.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <div
              className="rounded-[26px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const files = Array.from(event.dataTransfer.files);
                const selection = appendUploadFiles(value, files);
                setUploadDialogError(selection.error);
                setValue(selection.value);
              }}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Files className="size-4 text-[var(--primary)]" />
                    Files
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    Spreadsheets, documents, PDFs, text, structured text, and
                    images are supported.
                  </p>
                </div>
                <Input
                  aria-label="Artifact files"
                  type="file"
                  multiple
                  accept={ARTIFACT_ACCEPT_EXTENSIONS}
                  disabled={
                    value.items.length >= MAX_ARTIFACT_UPLOAD_QUEUE_FILES
                  }
                  className="w-full sm:max-w-xs"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    const selection = appendUploadFiles(value, files);
                    setUploadDialogError(selection.error);
                    setValue(selection.value);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            {value.items.length === 0 ? (
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-muted)]">
                No files selected yet.
              </div>
            ) : (
              <div className="grid gap-2">
                {value.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {item.file.name}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                        {formatBytes(item.file.size)} ·{" "}
                        {item.file.type || "unknown type"}
                      </div>
                    </div>
                    <UploadResultBadge
                      result={uploadResultByItemId.get(item.id)}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs text-[var(--ui-ink-muted)]">
              {value.items.length} of {MAX_ARTIFACT_UPLOAD_QUEUE_FILES} files
            </div>

            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                <input
                  type="checkbox"
                  checked={value.encryptContent}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      encryptContent: event.target.checked,
                      contentPassword: event.target.checked
                        ? value.contentPassword
                        : "",
                      contentPasswordConfirm: event.target.checked
                        ? value.contentPasswordConfirm
                        : "",
                      contentPasswordHint: event.target.checked
                        ? value.contentPasswordHint
                        : ""
                    })
                  }
                />
                Encrypt file content with a password
              </label>
              {value.encryptContent ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <FlowField label="Password">
                    <Input
                      type="password"
                      value={value.contentPassword}
                      onChange={(event) =>
                        setValue({
                          ...value,
                          contentPassword: event.target.value
                        })
                      }
                    />
                  </FlowField>
                  <FlowField label="Confirm password">
                    <Input
                      type="password"
                      value={value.contentPasswordConfirm}
                      onChange={(event) =>
                        setValue({
                          ...value,
                          contentPasswordConfirm: event.target.value
                        })
                      }
                    />
                  </FlowField>
                  <div className="md:col-span-2">
                    <FlowField label="Password hint">
                      <Input
                        value={value.contentPasswordHint}
                        onChange={(event) =>
                          setValue({
                            ...value,
                            contentPasswordHint: event.target.value
                          })
                        }
                        placeholder="Optional hint shown with encrypted metadata"
                      />
                    </FlowField>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )
      },
      {
        id: "queue",
        eyebrow: "Describe",
        title: "Review each file before upload",
        description:
          "Add quick descriptions from the queue, or open a file's details for provenance, links, metadata JSON, and LLM enrichment.",
        render: (value, setValue) => {
          const activeItem = value.items.find(
            (item) => item.id === value.activeItemId
          );

          if (activeItem) {
            return (
              <div className="grid gap-4">
                <div
                  data-upload-detail-panel
                  tabIndex={-1}
                  className="flex min-w-0 flex-col gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <h4 className="break-words text-sm font-medium">
                      {activeItem.file.name}
                    </h4>
                    <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                      {formatBytes(activeItem.file.size)} ·{" "}
                      {activeItem.file.type || "unknown type"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setValue({ ...value, activeItemId: null })}
                  >
                    Back to file queue
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FlowField label="Title">
                    <Input
                      value={activeItem.title}
                      onChange={(event) =>
                        setValue(
                          updateUploadItem(value, activeItem.id, {
                            title: event.target.value
                          })
                        )
                      }
                    />
                  </FlowField>
                  <FlowField label="Source kind">
                    <select
                      aria-label="Source kind"
                      value={activeItem.sourceKind}
                      onChange={(event) =>
                        setValue(
                          updateUploadItem(value, activeItem.id, {
                            sourceKind: event.target.value as ArtifactSourceKind
                          })
                        )
                      }
                      className="interactive-tap min-h-10 w-full min-w-0 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
                    >
                      {SOURCE_KIND_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {titleCase(option)}
                        </option>
                      ))}
                    </select>
                  </FlowField>
                </div>

                <FlowField label="Short description">
                  <Input
                    value={activeItem.shortDescription}
                    onChange={(event) =>
                      setValue(
                        updateUploadItem(value, activeItem.id, {
                          shortDescription: event.target.value
                        })
                      )
                    }
                  />
                </FlowField>

                <FlowField label="Long description">
                  <Textarea
                    value={activeItem.description}
                    onChange={(event) =>
                      setValue(
                        updateUploadItem(value, activeItem.id, {
                          description: event.target.value
                        })
                      )
                    }
                  />
                </FlowField>

                <FlowField label="Source label or provenance note">
                  <Input
                    value={activeItem.sourceLabel}
                    onChange={(event) =>
                      setValue(
                        updateUploadItem(value, activeItem.id, {
                          sourceLabel: event.target.value
                        })
                      )
                    }
                    placeholder="Where this file came from or why it is worth preserving"
                  />
                </FlowField>

                <div className="grid gap-2">
                  <div className="text-sm font-medium text-[var(--ui-ink-medium)]">
                    Forge entity relationships
                  </div>
                  <ArtifactEntityLinksEditor
                    drafts={activeItem.linkDrafts}
                    onChange={(linkDrafts) =>
                      setValue(
                        updateUploadItem(value, activeItem.id, { linkDrafts })
                      )
                    }
                  />
                </div>

                <FlowField
                  label="Metadata JSON"
                  hint='Optional object, for example {"period":"Q2","owner":"Albert"}'
                >
                  <Textarea
                    value={activeItem.metadataText}
                    onChange={(event) =>
                      setValue(
                        updateUploadItem(value, activeItem.id, {
                          metadataText: event.target.value
                        })
                      )
                    }
                  />
                </FlowField>

                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-[var(--ui-ink-medium)]">
                    Use the configured LLM to fill missing metadata
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-label="Use configured LLM to fill missing metadata for this file"
                    aria-checked={activeItem.useLlmEnrichment}
                    className={cn(
                      "interactive-tap inline-flex min-h-10 w-full items-center justify-between rounded-[22px] border px-3 text-sm sm:w-auto sm:min-w-28",
                      activeItem.useLlmEnrichment
                        ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-muted)]"
                    )}
                    onClick={() =>
                      setValue(
                        updateUploadItem(value, activeItem.id, {
                          useLlmEnrichment: !activeItem.useLlmEnrichment
                        })
                      )
                    }
                  >
                    <span>{activeItem.useLlmEnrichment ? "On" : "Off"}</span>
                    <Sparkles className="size-4" />
                  </button>
                </div>
                {value.encryptContent && activeItem.useLlmEnrichment ? (
                  <p className="text-xs leading-5 text-[var(--ui-ink-muted)]">
                    For encrypted uploads, LLM enrichment uses metadata and
                    scanner findings only, not decrypted file text.
                  </p>
                ) : null}
              </div>
            );
          }

          return (
            <div className="grid gap-3">
              {value.items.length > 0 ? (
                <section
                  aria-labelledby="artifact-bulk-defaults-title"
                  className="grid min-w-0 gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                >
                  <div>
                    <h4
                      id="artifact-bulk-defaults-title"
                      className="text-sm font-medium text-[var(--ui-ink-strong)]"
                    >
                      Bulk defaults
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                      Apply shared retrieval and provenance details, then refine
                      individual files where needed.
                    </p>
                  </div>
                  <div className="grid min-w-0 gap-3 md:grid-cols-2">
                    <FlowField label="Default short description">
                      <Input
                        value={value.bulkShortDescription}
                        onChange={(event) =>
                          setValue({
                            ...value,
                            bulkShortDescription: event.target.value
                          })
                        }
                        placeholder="What this batch helps someone find"
                      />
                    </FlowField>
                    <FlowField label="Default source or provenance">
                      <Input
                        value={value.bulkSourceLabel}
                        onChange={(event) =>
                          setValue({
                            ...value,
                            bulkSourceLabel: event.target.value
                          })
                        }
                        placeholder="Where these files came from"
                      />
                    </FlowField>
                    <FlowField label="Default source kind">
                      <select
                        aria-label="Default source kind"
                        value={value.bulkSourceKind}
                        onChange={(event) =>
                          setValue({
                            ...value,
                            bulkSourceKind: event.target
                              .value as ArtifactSourceKind
                          })
                        }
                        className="interactive-tap min-h-10 w-full min-w-0 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
                      >
                        {SOURCE_KIND_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {titleCase(option)}
                          </option>
                        ))}
                      </select>
                    </FlowField>
                    <div className="grid content-end gap-2">
                      <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
                        LLM metadata enrichment
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Use LLM enrichment as a bulk default"
                        aria-checked={value.bulkUseLlmEnrichment}
                        className={cn(
                          "interactive-tap inline-flex min-h-10 w-full items-center justify-between rounded-[22px] border px-3 text-sm",
                          value.bulkUseLlmEnrichment
                            ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-muted)]"
                        )}
                        onClick={() =>
                          setValue({
                            ...value,
                            bulkUseLlmEnrichment: !value.bulkUseLlmEnrichment
                          })
                        }
                      >
                        <span>
                          {value.bulkUseLlmEnrichment ? "Enabled" : "Disabled"}
                        </span>
                        <Sparkles className="size-4" />
                      </button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={uploadMutation.isPending}
                    onClick={() =>
                      setValue({
                        ...value,
                        items: value.items.map((item) =>
                          uploadResultByItemId.get(item.id)?.status ===
                          "success"
                            ? item
                            : {
                                ...item,
                                shortDescription:
                                  value.bulkShortDescription ||
                                  item.shortDescription,
                                sourceLabel:
                                  value.bulkSourceLabel || item.sourceLabel,
                                sourceKind: value.bulkSourceKind,
                                useLlmEnrichment: value.bulkUseLlmEnrichment
                              }
                        )
                      })
                    }
                  >
                    Apply defaults to queued files
                  </Button>
                </section>
              ) : null}
              {value.items.length === 0 ? (
                <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-muted)]">
                  Choose files first.
                </div>
              ) : (
                value.items.map((item) => {
                  const result = uploadResultByItemId.get(item.id);
                  const inFlight =
                    result?.status === "queued" ||
                    result?.status === "reading" ||
                    result?.status === "uploading";
                  return (
                    <div
                      key={item.id}
                      className="grid min-w-0 gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {item.file.name}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                            {formatBytes(item.file.size)} ·{" "}
                            {item.file.type || "unknown type"}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            data-upload-details-id={item.id}
                            type="button"
                            variant="secondary"
                            disabled={inFlight || result?.status === "success"}
                            onClick={() =>
                              setValue({ ...value, activeItemId: item.id })
                            }
                          >
                            <Pencil className="size-4" />
                            Details
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={inFlight || result?.status === "success"}
                            onClick={() => {
                              cancelUploadItem(item.id);
                              setUploadResults((current) =>
                                current.filter(
                                  (candidate) => candidate.itemId !== item.id
                                )
                              );
                              setValue(removeUploadItem(value, item.id));
                            }}
                          >
                            <Trash2 className="size-4" />
                            Remove
                          </Button>
                          {inFlight ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => cancelUploadItem(item.id)}
                            >
                              <XCircle className="size-4" />
                              Cancel
                            </Button>
                          ) : null}
                          {(result?.status === "error" ||
                            result?.status === "canceled") &&
                          !uploadMutation.isPending ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => retryUploadItem(item)}
                            >
                              <RotateCcw className="size-4" />
                              Retry
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <Input
                        aria-label={`Short description for ${item.file.name}`}
                        disabled={inFlight || result?.status === "success"}
                        value={item.shortDescription}
                        onChange={(event) =>
                          setValue(
                            updateUploadItem(value, item.id, {
                              shortDescription: event.target.value
                            })
                          )
                        }
                        placeholder="Quick short description"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <UploadResultBadge result={result} />
                        {result?.status === "success" ? (
                          <span className="text-xs text-[var(--ui-ink-muted)]">
                            Saved in the Artifact Store
                          </span>
                        ) : null}
                      </div>
                      <UploadProgressState result={result} />
                      {result?.status === "error" ? (
                        <p
                          role="alert"
                          className="break-words text-sm text-[var(--danger)]"
                        >
                          {result.error}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          );
        }
      },
      {
        id: "review",
        eyebrow: "Upload",
        title: "Upload artifacts",
        description:
          "Forge will create one artifact per file. Successful files stay saved even if another file fails.",
        render: (value) => {
          const successCount = uploadResults.filter(
            (result) => result.status === "success"
          ).length;
          const failureCount = uploadResults.filter(
            (result) => result.status === "error"
          ).length;
          const canceledCount = uploadResults.filter(
            (result) => result.status === "canceled"
          ).length;
          const contentHashCounts = new Map<string, number>();
          for (const result of uploadResults) {
            if (result.status === "success" && result.contentSha256) {
              contentHashCounts.set(
                result.contentSha256,
                (contentHashCounts.get(result.contentSha256) ?? 0) + 1
              );
            }
          }

          return (
            <div className="grid gap-4">
              {uploadResults.length > 0 ? (
                <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="size-4 text-[var(--primary)]" />
                    Upload results
                  </div>
                  <p className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                    {successCount} uploaded · {failureCount} failed ·{" "}
                    {canceledCount} canceled
                  </p>
                  {uploadMutation.isPending ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3"
                      onClick={cancelAllUploads}
                    >
                      <XCircle className="size-4" />
                      Cancel remaining uploads
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3">
                {value.items.map((item) => {
                  const result = uploadResultByItemId.get(item.id);
                  const inFlight =
                    result?.status === "queued" ||
                    result?.status === "reading" ||
                    result?.status === "uploading";
                  return (
                    <div
                      key={item.id}
                      className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {item.title || item.file.name}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                            {item.file.name} · {formatBytes(item.file.size)}
                          </div>
                          {item.shortDescription ? (
                            <p className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                              {item.shortDescription}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <UploadResultBadge result={result} />
                          {inFlight ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => cancelUploadItem(item.id)}
                            >
                              <XCircle className="size-4" />
                              Cancel {item.file.name}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <UploadProgressState result={result} />
                      {result?.status === "success" &&
                      result.contentSha256 &&
                      (contentHashCounts.get(result.contentSha256) ?? 0) > 1 ? (
                        <p className="mt-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
                          {value.encryptContent
                            ? "These bytes match another queued file. Forge kept this file's metadata separate and stored an independently encrypted ciphertext representation."
                            : "These bytes match another queued file. Forge kept this file's metadata separate and reused the verified stored blob."}
                        </p>
                      ) : null}
                      {result?.status === "error" ? (
                        <p
                          role="alert"
                          className="mt-3 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
                        >
                          {result.error}
                        </p>
                      ) : null}
                      {(result?.status === "error" ||
                        result?.status === "canceled") &&
                      !uploadMutation.isPending ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="mt-3"
                          onClick={() => retryUploadItem(item)}
                        >
                          <RotateCcw className="size-4" />
                          Retry {item.file.name}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
      }
    ],
    [
      cancelAllUploads,
      cancelUploadItem,
      retryUploadItem,
      uploadMutation.isPending,
      uploadResultByItemId,
      uploadResults
    ]
  );

  const metadataFlowSteps = useMemo<
    Array<QuestionFlowStep<ArtifactMetadataFlowValue>>
  >(
    () => [
      {
        id: "describe",
        eyebrow: "Describe",
        title: "Name and describe this artifact",
        description:
          "Edit human-facing metadata without changing the stored file bytes, scan evidence, checksums, or version history.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Title">
              <Input
                value={value.title}
                onChange={(event) =>
                  setValue({ ...value, title: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Short description">
              <Input
                value={value.shortDescription}
                onChange={(event) =>
                  setValue({ ...value, shortDescription: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Full description">
              <Textarea
                value={value.description}
                onChange={(event) =>
                  setValue({ ...value, description: event.target.value })
                }
                rows={6}
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "provenance",
        eyebrow: "Provenance",
        title: "Record where this file came from",
        description:
          "The source label and structured metadata remain inspectable beside immutable upload and scanner facts.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Source label or provenance note">
              <Input
                value={value.sourceLabel}
                onChange={(event) =>
                  setValue({ ...value, sourceLabel: event.target.value })
                }
                placeholder="Where, when, or from whom the file was obtained"
              />
            </FlowField>
            <FlowField label="Metadata JSON">
              <Textarea
                value={value.metadataText}
                onChange={(event) =>
                  setValue({ ...value, metadataText: event.target.value })
                }
                rows={9}
                className="font-mono text-xs"
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "review",
        eyebrow: "Review",
        title: "Save metadata changes",
        description:
          "Only the editable description and provenance fields change. File identity, safety evidence, protection, and history remain intact.",
        render: (value) => (
          <dl className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4">
            <ArtifactMetadataField label="Title" value={value.title.trim()} />
            <ArtifactMetadataField
              label="Source"
              value={value.sourceLabel.trim() || "Not recorded"}
            />
            <ArtifactMetadataField
              label="Metadata"
              value={
                metadataFieldCount(value.metadataText) === null
                  ? "Invalid JSON"
                  : `${metadataFieldCount(value.metadataText)} structured fields`
              }
            />
          </dl>
        )
      }
    ],
    []
  );

  const trustFlowSteps = useMemo<
    Array<QuestionFlowStep<ArtifactTrustFlowValue>>
  >(
    () => [
      {
        id: "decision",
        eyebrow: "Trust",
        title: "Set the artifact safety state",
        description:
          "This operator override is separate from the deterministic danger score and always leaves an audit event.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Artifact state">
              <select
                aria-label="Artifact trust state"
                value={value.artifactState}
                onChange={(event) =>
                  setValue({
                    ...value,
                    artifactState: event.target.value as ArtifactState
                  })
                }
                className="interactive-tap min-h-10 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                {ARTIFACT_STATES.map((state) => (
                  <option key={state} value={state}>
                    {titleCase(state)}
                  </option>
                ))}
              </select>
            </FlowField>
            <FlowField label="Download policy">
              <select
                aria-label="Artifact download policy"
                value={value.downloadPolicy ?? "human_only"}
                onChange={(event) =>
                  setValue({
                    ...value,
                    downloadPolicy: event.target.value as
                      | "human_only"
                      | "disabled"
                  })
                }
                className="interactive-tap min-h-10 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                <option value="human_only">Human-only download</option>
                <option value="disabled">Download disabled</option>
              </select>
            </FlowField>
            <div className="md:col-span-2">
              <FlowField label="Reason for this trust decision">
                <Textarea
                  value={value.reason}
                  onChange={(event) =>
                    setValue({ ...value, reason: event.target.value })
                  }
                  rows={4}
                  placeholder="Describe the review evidence and why this state is appropriate"
                />
              </FlowField>
            </div>
          </div>
        )
      },
      {
        id: "review",
        eyebrow: "Review",
        title: "Apply the trust decision",
        description:
          "The static scanner evidence and danger score are preserved. This reasoned decision changes access state and is recorded in immutable audit history.",
        render: (value) => (
          <dl className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4">
            <ArtifactMetadataField
              label="Current danger score"
              value={`${selectedArtifact?.dangerScore ?? 0}/100 (${titleCase(selectedArtifact?.dangerLevel ?? "low")})`}
            />
            <ArtifactMetadataField
              label="New state"
              value={titleCase(value.artifactState)}
            />
            <ArtifactMetadataField
              label="Download"
              value={
                value.downloadPolicy === "disabled" ? "Disabled" : "Human only"
              }
            />
            <ArtifactMetadataField label="Reason" value={value.reason.trim()} />
          </dl>
        )
      }
    ],
    [selectedArtifact?.dangerLevel, selectedArtifact?.dangerScore]
  );

  const linkFlowSteps = useMemo<Array<QuestionFlowStep<ArtifactLinkFlowValue>>>(
    () => [
      {
        id: "relationships",
        eyebrow: "Connect",
        title: "Manage entity relationships",
        description:
          "Use exact Forge entity types and IDs. Relationships are stored in the shared entity graph.",
        render: (value, setValue) => (
          <ArtifactEntityLinksEditor
            drafts={value.drafts}
            onChange={(drafts) => setValue({ drafts })}
          />
        )
      },
      {
        id: "review",
        eyebrow: "Review",
        title: "Save artifact relationships",
        description:
          "This replaces the artifact's current relationship set without changing stored file bytes.",
        render: (value) => (
          <ArtifactEntityLinksList
            links={value.drafts.map((draft) => ({
              sourceEntityType: "artifact",
              sourceEntityId: selectedArtifact?.id ?? "",
              targetEntityType: draft.entityType.trim(),
              targetEntityId: draft.entityId.trim(),
              relationship: draft.relationship.trim() || "related",
              anchorKey: draft.anchorKey.trim() || null,
              createdByActor: null,
              createdAt: ""
            }))}
          />
        )
      }
    ],
    [selectedArtifact?.id]
  );

  const archiveFlowSteps = useMemo<
    Array<QuestionFlowStep<Record<string, never>>>
  >(
    () => [
      {
        id: "confirm",
        eyebrow: "Delete",
        title: "Delete this artifact record?",
        description:
          "Forge will move the artifact metadata to the shared bin. The stored file bytes are preserved, and the record can be restored through Forge's normal restore flow.",
        render: () => (
          <div className="rounded-[24px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-medium)]">
            <div className="font-medium text-[var(--ui-ink-strong)]">
              {selectedArtifact?.title ?? "Selected artifact"}
            </div>
            <div className="mt-1 break-all text-xs text-[var(--ui-ink-muted)]">
              {selectedArtifact?.originalFileName ?? ""}
            </div>
            <p className="mt-3">
              This is a metadata delete/archive action, not a file execution or
              byte deletion. Human-only download and safety rules remain in
              force.
            </p>
          </div>
        )
      }
    ],
    [selectedArtifact?.originalFileName, selectedArtifact?.title]
  );

  const passwordFlowSteps = useMemo<Array<QuestionFlowStep<PasswordFlowValue>>>(
    () => [
      {
        id: "password",
        eyebrow: "Download",
        title: "Enter artifact password",
        description: selectedArtifact?.contentProtection.passwordHint
          ? `Hint: ${selectedArtifact.contentProtection.passwordHint}`
          : "Encrypted content needs the artifact password before download.",
        render: (value, setValue) => (
          <FlowField label="Password">
            <Input
              type="password"
              value={value.password}
              onChange={(event) =>
                setValue({ ...value, password: event.target.value })
              }
            />
          </FlowField>
        )
      }
    ],
    [selectedArtifact?.contentProtection.passwordHint]
  );

  const encryptFlowSteps = useMemo<Array<QuestionFlowStep<EncryptFlowValue>>>(
    () => [
      {
        id: "password",
        eyebrow: "Encrypt",
        title: "Encrypt file content",
        description:
          "Metadata, scan results, audit history, versions, and Forge links stay visible.",
        render: (value, setValue) => (
          <div className="grid gap-3">
            <FlowField label="Password">
              <Input
                type="password"
                value={value.password}
                onChange={(event) =>
                  setValue({ ...value, password: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Confirm password">
              <Input
                type="password"
                value={value.passwordConfirm}
                onChange={(event) =>
                  setValue({ ...value, passwordConfirm: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Password hint">
              <Input
                value={value.passwordHint}
                onChange={(event) =>
                  setValue({ ...value, passwordHint: event.target.value })
                }
                placeholder="Optional hint shown with encrypted metadata"
              />
            </FlowField>
          </div>
        )
      }
    ],
    []
  );

  const submitUploadFlow = async () => {
    const itemsToUpload = uploadFlowValue.items.filter(
      (item) => uploadResultByItemId.get(item.id)?.status !== "success"
    );
    if (uploadFlowValue.items.length === 0) {
      setUploadDialogError("Choose one or more files first.");
      return;
    }
    if (itemsToUpload.length === 0) {
      setUploadDialogOpen(false);
      setUploadFlowValue(EMPTY_UPLOAD_FLOW_VALUE);
      setUploadResults([]);
      return;
    }
    if (uploadFlowValue.encryptContent) {
      if (!uploadFlowValue.contentPassword) {
        setUploadDialogError(
          "Password is required when encryption is enabled."
        );
        return;
      }
      if (
        uploadFlowValue.contentPassword !==
        uploadFlowValue.contentPasswordConfirm
      ) {
        setUploadDialogError("Password confirmation must match.");
        return;
      }
    }
    try {
      for (const item of itemsToUpload) {
        parseMetadataText(item.metadataText);
        const linkError = validateArtifactEntityLinkDrafts(item.linkDrafts);
        if (linkError) {
          throw new Error(`${item.file.name}: ${linkError}`);
        }
      }
    } catch (error) {
      setUploadDialogError(readErrorMessage(error));
      return;
    }
    setUploadDialogError(null);
    for (const item of itemsToUpload) {
      canceledUploadItemIdsRef.current.delete(item.id);
    }
    await uploadMutation.mutateAsync(uploadBatchSnapshot(itemsToUpload));
  };

  const submitMetadataFlow = async () => {
    const title = metadataFlowValue.title.trim();
    if (!title) {
      setMetadataDialogError("Title is required.");
      return;
    }
    let metadata: Record<string, unknown>;
    try {
      metadata = parseMetadataText(metadataFlowValue.metadataText);
    } catch (error) {
      setMetadataDialogError(readErrorMessage(error));
      return;
    }
    setMetadataDialogError(null);
    await patchMutation.mutateAsync({
      title,
      shortDescription: metadataFlowValue.shortDescription.trim(),
      description: metadataFlowValue.description.trim(),
      sourceLabel: metadataFlowValue.sourceLabel.trim(),
      metadata
    });
  };

  const submitTrustFlow = async () => {
    const reason = trustFlowValue.reason.trim();
    if (!reason) {
      setTrustDialogError("A reason is required for every trust decision.");
      return;
    }
    setTrustDialogError(null);
    await trustMutation.mutateAsync({
      artifactState: trustFlowValue.artifactState,
      downloadPolicy: trustFlowValue.downloadPolicy,
      reason
    });
  };

  const submitPasswordDownload = async () => {
    if (!downloadPasswordValue.password) {
      setDownloadPasswordError("Password is required.");
      return;
    }
    setDownloadPasswordError(null);
    try {
      await passwordDownloadMutation.mutateAsync(
        downloadPasswordValue.password
      );
    } catch {
      // The mutation onError handler renders the password-specific message inline.
    }
  };

  const submitEncryptFlow = async () => {
    if (!encryptFlowValue.password) {
      setEncryptDialogError("Password is required.");
      return;
    }
    if (encryptFlowValue.password !== encryptFlowValue.passwordConfirm) {
      setEncryptDialogError("Password confirmation must match.");
      return;
    }
    setEncryptDialogError(null);
    await encryptMutation.mutateAsync(encryptFlowValue);
  };

  const openLinksDialog = () => {
    if (!selectedArtifact) {
      return;
    }
    setLinkFlowValue({
      drafts: artifactEntityLinksToDrafts(selectedArtifact.links)
    });
    setLinksDialogError(null);
    setLinksDialogOpen(true);
  };

  const submitLinksFlow = async () => {
    const validationError = validateArtifactEntityLinkDrafts(
      linkFlowValue.drafts
    );
    if (validationError) {
      setLinksDialogError(validationError);
      return;
    }
    setLinksDialogError(null);
    await linksMutation.mutateAsync(
      artifactEntityLinkDraftsToInputs(linkFlowValue.drafts)
    );
  };

  return (
    <div className="min-h-full bg-[var(--ui-bg)] text-[var(--ui-ink-strong)]">
      <PageHero
        entityKind="artifact"
        title="Artifacts"
        description="Trusted file storage for precise metadata, safety scans, provenance, generic entity links, and human-only downloads."
        badge={`${totalArtifacts} stored`}
        actions={
          <Button type="button" onClick={openUploadDialog}>
            <Upload className="size-4" />
            Add artifacts
          </Button>
        }
      />

      <main className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)] lg:px-7">
        <section className="space-y-4">
          <Card className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Archive className="size-4 text-[var(--primary)]" />
              Store
            </div>
            <Input
              aria-label="Search artifacts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, file, description, provenance"
            />
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <select
                aria-label="Filter by artifact state"
                value={artifactState}
                onChange={(event) =>
                  setArtifactState(event.target.value as ArtifactState | "")
                }
                className="interactive-tap min-h-10 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                <option value="">Any state</option>
                {ARTIFACT_STATES.map((state) => (
                  <option key={state} value={state}>
                    {titleCase(state)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by danger level"
                value={dangerLevel}
                onChange={(event) =>
                  setDangerLevel(event.target.value as ArtifactDangerLevel | "")
                }
                className="interactive-tap min-h-10 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                <option value="">Any danger</option>
                {DANGER_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {titleCase(level)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by format family"
                value={formatFamily}
                onChange={(event) =>
                  setFormatFamily(
                    event.target.value as ArtifactFormatFamily | ""
                  )
                }
                className="interactive-tap min-h-10 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                <option value="">Any format</option>
                {FORMAT_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {titleCase(family)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2 border-t border-[var(--ui-border-subtle)] pt-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                Linked record
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <ArtifactEntityTypeInput
                  ariaLabel="Filter by linked entity type"
                  value={linkedEntityType}
                  onChange={setLinkedEntityType}
                />
                <Input
                  aria-label="Filter by linked entity ID"
                  value={linkedEntityId}
                  onChange={(event) => setLinkedEntityId(event.target.value)}
                  placeholder="Exact entity ID"
                />
              </div>
              {Boolean(linkedEntityType.trim()) !==
              Boolean(linkedEntityId.trim()) ? (
                <p className="text-xs text-[var(--warning)]" role="status">
                  Enter both fields to filter by a linked record.
                </p>
              ) : null}
              {linkedEntityType || linkedEntityId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLinkedEntityType("");
                    setLinkedEntityId("");
                  }}
                >
                  Clear linked filter
                </Button>
              ) : null}
            </div>
          </Card>

          <div className="flex items-center justify-between gap-3 text-xs text-[var(--ui-ink-muted)]">
            <div className="min-w-0">
              <span>
                {totalArtifacts === 0
                  ? "No matching artifacts"
                  : `Showing ${pageStart}-${pageEnd} of ${totalArtifacts}`}
              </span>
              {artifactListUpdating ? (
                <span className="ml-2" role="status">
                  Updating results...
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!hasPreviousPage || artifactsQuery.isFetching}
                onClick={() =>
                  setPageIndex((current) => Math.max(0, current - 1))
                }
                aria-label="Previous artifact page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!hasNextPage || artifactsQuery.isFetching}
                onClick={() => setPageIndex((current) => current + 1)}
                aria-label="Next artifact page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          <div
            ref={artifactListRef}
            aria-busy={artifactListUpdating}
            className="max-h-[calc(100vh-23rem)] min-h-[12rem] space-y-2 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
          >
            {artifactsQuery.isLoading ? (
              <Card className="text-sm text-[var(--ui-ink-muted)]">
                Loading artifacts...
              </Card>
            ) : artifactsQuery.error ? (
              <ErrorState
                error={artifactsQuery.error}
                onRetry={() => void artifactsQuery.refetch()}
              />
            ) : artifacts.length === 0 ? (
              <EmptyState
                title="No artifacts found"
                description={
                  hasAnyFilter
                    ? "No artifact records match the current search and filters."
                    : "Upload a trusted file to create the first artifact record."
                }
              />
            ) : (
              artifacts.map((artifact) => (
                <ArtifactListItem
                  key={artifact.id}
                  artifact={artifact}
                  selected={artifact.id === selectedArtifact?.id}
                  onSelect={() => navigate(`/artifacts/${artifact.id}`)}
                />
              ))
            )}
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          {artifactId && selectedArtifactQuery.isLoading ? (
            <Card className="text-sm text-[var(--ui-ink-muted)]">
              Loading artifact...
            </Card>
          ) : artifactId && selectedArtifactQuery.error ? (
            <ErrorState
              error={selectedArtifactQuery.error}
              onRetry={() => void selectedArtifactQuery.refetch()}
            />
          ) : !selectedArtifact ? (
            <EmptyState
              title="Select an artifact"
              description="Choose an artifact from the list to inspect metadata, scans, links, versions, and audit history."
            />
          ) : (
            <>
              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={cn(
                          dangerClass(selectedArtifact.dangerLevel)
                        )}
                      >
                        {titleCase(selectedArtifact.dangerLevel)} danger
                      </Badge>
                      <Badge tone="meta">
                        {titleCase(selectedArtifact.artifactState)}
                      </Badge>
                      <Badge tone="meta">
                        {selectedArtifact.detectedExtension.toUpperCase()}
                      </Badge>
                      <Badge tone="meta">
                        {selectedArtifact.downloadPolicy === "human_only"
                          ? "Human-only download"
                          : "Download disabled"}
                      </Badge>
                      {isEncryptedArtifact(selectedArtifact) ? (
                        <Badge tone="meta">
                          <Lock className="size-3.5" />
                          Encrypted content
                        </Badge>
                      ) : null}
                    </div>
                    <h2 className="mt-3 break-words text-2xl font-semibold">
                      {selectedArtifact.title}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm text-[var(--ui-ink-muted)]">
                      {selectedArtifact.shortDescription ||
                        selectedArtifact.description}
                    </p>
                    {isEncryptedArtifact(selectedArtifact) ? (
                      <p className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                        Encrypted content
                        {selectedArtifact.contentProtection.passwordHint
                          ? ` · Hint: ${selectedArtifact.contentProtection.passwordHint}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="lg"
                      type="button"
                      onClick={() =>
                        scanMutation.mutate({
                          artifactId: selectedArtifact.id
                        })
                      }
                      pending={selectedScanPending}
                    >
                      <RefreshCw className="size-4" />
                      Scan
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => enrichMutation.mutate()}
                      pending={enrichMutation.isPending}
                    >
                      <Sparkles className="size-4" />
                      Enrich
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={openMetadataDialog}
                    >
                      <Pencil className="size-4" />
                      Edit metadata
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={openTrustDialog}
                    >
                      <Settings2 className="size-4" />
                      Trust state
                    </Button>
                    {!isEncryptedArtifact(selectedArtifact) ? (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => {
                          setEncryptFlowValue(EMPTY_ENCRYPT_FLOW_VALUE);
                          setEncryptDialogError(null);
                          setEncryptDialogOpen(true);
                        }}
                      >
                        <KeyRound className="size-4" />
                        Encrypt
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => downloadMutation.mutate()}
                      pending={downloadMutation.isPending}
                      disabled={
                        selectedArtifact.downloadPolicy !== "human_only" ||
                        selectedArtifact.artifactState === "blocked"
                      }
                    >
                      <Download className="size-4" />
                      Download
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      className="border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] text-[var(--danger)] hover:border-[color-mix(in_srgb,var(--danger)_46%,var(--ui-border-subtle)_54%)] hover:bg-[color-mix(in_srgb,var(--danger)_20%,var(--ui-surface-1)_80%)]"
                      onClick={() => setArchiveDialogOpen(true)}
                      pending={archiveMutation.isPending}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </div>
                </div>

                {downloadDisabledReason ? (
                  <p className="rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
                    {downloadDisabledReason}
                  </p>
                ) : null}
                {artifactActionError ? (
                  <p
                    className="rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
                    role="alert"
                  >
                    {readErrorMessage(artifactActionError)}
                  </p>
                ) : null}
                {typeof enrichmentStatus?.status === "string" ? (
                  <p
                    className="text-sm text-[var(--ui-ink-muted)]"
                    role="status"
                  >
                    Enrichment: {titleCase(enrichmentStatus.status)}
                    {typeof enrichmentStatus.reason === "string"
                      ? ` · ${enrichmentStatus.reason}`
                      : typeof enrichmentStatus.error === "string"
                        ? ` · ${enrichmentStatus.error}`
                        : ""}
                  </p>
                ) : null}

                <div className="grid gap-3 md:grid-cols-5">
                  {[
                    ["File", selectedArtifact.originalFileName],
                    ["Size", formatBytes(selectedArtifact.byteSize)],
                    ["Versions", versionCount],
                    ["Links", selectedArtifact.links.length],
                    [
                      "Protection",
                      isEncryptedArtifact(selectedArtifact)
                        ? "Encrypted"
                        : "Plaintext"
                    ]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
                    >
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                        {label}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                {isEncryptedArtifact(selectedArtifact) ? (
                  <p className="text-sm text-[var(--ui-ink-muted)]">
                    Existing scan results remain available; rescanning encrypted
                    content needs password-gated support.
                  </p>
                ) : null}
                {selectedScanError ? (
                  <p
                    className="rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] px-3 py-2 text-sm text-[var(--warning)]"
                    role="alert"
                  >
                    Latest scan failed. {selectedArtifactHasScanEvidence
                      ? "Existing scan evidence remains available."
                      : "No prior static scan evidence is available."}{" "}
                    {readErrorMessage(selectedScanError)}
                  </p>
                ) : null}
              </Card>

              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileSearch className="size-4 text-[var(--primary)]" />
                      Precise metadata
                    </div>
                    <p className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                      File identity, provenance, ownership, storage, protection,
                      and timestamps from the canonical artifact record.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={openMetadataDialog}
                  >
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                </div>
                <div className="grid gap-x-6 lg:grid-cols-2">
                  <dl className="min-w-0">
                    <ArtifactMetadataField
                      label="Artifact ID"
                      value={selectedArtifact.id}
                      mono
                    />
                    <ArtifactMetadataField
                      label="Original file name"
                      value={selectedArtifact.originalFileName}
                    />
                    <ArtifactMetadataField
                      label="Format"
                      value={`${titleCase(selectedArtifact.formatFamily)} · ${selectedArtifact.detectedExtension.toUpperCase()}`}
                    />
                    <ArtifactMetadataField
                      label="Declared MIME type"
                      value={
                        selectedArtifact.declaredMimeType || "Not declared"
                      }
                    />
                    <ArtifactMetadataField
                      label="Detected MIME type"
                      value={selectedArtifact.detectedMimeType}
                    />
                    <ArtifactMetadataField
                      label="Original content size"
                      value={formatBytes(selectedArtifact.byteSize)}
                    />
                    <ArtifactMetadataField
                      label="Original SHA-256"
                      value={selectedArtifact.contentSha256}
                      mono
                    />
                    <ArtifactMetadataField
                      label="Stored SHA-256"
                      value={selectedArtifact.storedContentSha256}
                      mono
                    />
                    <ArtifactMetadataField
                      label="Stored size"
                      value={formatBytes(selectedArtifact.storedByteSize)}
                    />
                  </dl>
                  <dl className="min-w-0">
                    <ArtifactMetadataField
                      label="Source kind"
                      value={titleCase(selectedArtifact.sourceKind)}
                    />
                    <ArtifactMetadataField
                      label="Source label"
                      value={selectedArtifact.sourceLabel || "Not recorded"}
                    />
                    <ArtifactMetadataField
                      label="Uploaded by user"
                      value={formatIdentity(selectedArtifact.uploadedByUserId)}
                      mono
                    />
                    <ArtifactMetadataField
                      label="Uploaded by agent"
                      value={formatIdentity(selectedArtifact.uploadedByAgentId)}
                      mono
                    />
                    <ArtifactMetadataField
                      label="Acting for user"
                      value={formatIdentity(selectedArtifact.actingForUserId)}
                      mono
                    />
                    <ArtifactMetadataField
                      label="Created"
                      value={formatDateTime(selectedArtifact.createdAt)}
                    />
                    <ArtifactMetadataField
                      label="Updated"
                      value={formatDateTime(selectedArtifact.updatedAt)}
                    />
                  </dl>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                      Content protection
                    </div>
                    <div className="mt-2 text-sm font-medium">
                      {isEncryptedArtifact(selectedArtifact)
                        ? "Password encrypted"
                        : "Plaintext"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                      {selectedArtifact.contentProtection.algorithm ||
                        "No encryption algorithm"}
                      {selectedArtifact.contentProtection.encryptedAt
                        ? ` · ${formatDateTime(selectedArtifact.contentProtection.encryptedAt)}`
                        : ""}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                      Structured metadata
                    </div>
                    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[var(--ui-ink-muted)]">
                      {formatMetadataJson(selectedArtifact.metadata)}
                    </pre>
                  </div>
                </div>
              </Card>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <Card className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldAlert className="size-4 text-[var(--primary)]" />
                    Safety Findings
                  </div>
                  {!isScanResult(selectedArtifact.scanResults) ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">
                      No static scan result is available.
                    </p>
                  ) : findings.length === 0 ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">
                      Static scan completed with no findings.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {findings.map((finding) => (
                        <div
                          key={`${finding.code}:${finding.message}`}
                          className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              size="xs"
                              className={dangerClass(
                                finding.severity as ArtifactDangerLevel
                              )}
                            >
                              {titleCase(finding.severity)}
                            </Badge>
                            <span className="text-xs font-medium text-[var(--ui-ink-medium)]">
                              {finding.code}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                            {finding.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Link2 className="size-4 text-[var(--primary)]" />
                    Entity Links
                  </div>
                  <ArtifactEntityLinksList links={selectedArtifact.links} />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={openLinksDialog}
                  >
                    <Link2 className="size-4" />
                    Manage links
                  </Button>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileSearch className="size-4 text-[var(--primary)]" />
                    Versions
                  </div>
                  {versionsQuery.isLoading ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">
                      Loading versions...
                    </p>
                  ) : versionsQuery.error ? (
                    <div
                      className="grid gap-2 text-sm text-[var(--danger)]"
                      role="alert"
                    >
                      <span>{readErrorMessage(versionsQuery.error)}</span>
                      <div className="flex flex-wrap gap-2">
                        {versionPageIndex > 0 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setVersionPageIndex((current) =>
                                Math.max(0, current - 1)
                              )
                            }
                          >
                            <ChevronLeft className="size-4" />
                            Previous page
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void versionsQuery.refetch()}
                        >
                          Retry versions
                        </Button>
                      </div>
                    </div>
                  ) : (versionsQuery.data?.versions ?? []).length === 0 ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">
                      No artifact versions are recorded.
                    </p>
                  ) : (
                    (versionsQuery.data?.versions ?? []).map((version) => (
                      <div
                        key={version.id}
                        className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm"
                      >
                        <div className="font-medium">
                          Version {version.versionNumber}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                          {formatBytes(version.byteSize)} ·{" "}
                          {version.originalFileName}
                        </div>
                        <div className="mt-2 grid gap-1 font-mono text-[11px] leading-5 text-[var(--ui-ink-faint)]">
                          <div className="break-all">
                            Original SHA-256: {version.contentSha256}
                          </div>
                          <div className="break-all">
                            Stored SHA-256: {version.storedContentSha256}
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-[var(--ui-ink-muted)]">
                          {formatDateTime(version.createdAt)} ·{" "}
                          {version.contentProtection.mode ===
                          "password_encrypted"
                            ? "Encrypted"
                            : "Plaintext"}
                          {version.createdByActor
                            ? ` · ${version.createdByActor}`
                            : ""}
                        </div>
                      </div>
                    ))
                  )}
                  {versionsQuery.data &&
                  versionsQuery.data.versions.length > 0 ? (
                    <div className="flex min-h-9 items-center justify-between gap-3 text-xs text-[var(--ui-ink-muted)]">
                      <span>
                        Showing {versionsQuery.data.offset + 1}-
                        {Math.min(
                          versionsQuery.data.offset +
                            versionsQuery.data.versions.length,
                          versionsQuery.data.total
                        )}{" "}
                        of {versionsQuery.data.total}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            versionPageIndex === 0 || versionsQuery.isFetching
                          }
                          onClick={() =>
                            setVersionPageIndex((current) =>
                              Math.max(0, current - 1)
                            )
                          }
                          aria-label="Previous artifact version page"
                        >
                          <ChevronLeft className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            !versionsQuery.data.hasMore ||
                            versionsQuery.isFetching
                          }
                          onClick={() =>
                            setVersionPageIndex((current) => current + 1)
                          }
                          aria-label="Next artifact version page"
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Card>

                <Card className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileSearch className="size-4 text-[var(--primary)]" />
                    Audit
                  </div>
                  {auditQuery.isLoading ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">
                      Loading audit history...
                    </p>
                  ) : auditQuery.error ? (
                    <div
                      className="grid gap-2 text-sm text-[var(--danger)]"
                      role="alert"
                    >
                      <span>{readErrorMessage(auditQuery.error)}</span>
                      <div className="flex flex-wrap gap-2">
                        {auditPageIndex > 0 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setAuditPageIndex((current) =>
                                Math.max(0, current - 1)
                              )
                            }
                          >
                            <ChevronLeft className="size-4" />
                            Previous page
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void auditQuery.refetch()}
                        >
                          Retry audit history
                        </Button>
                      </div>
                    </div>
                  ) : auditEvents.length === 0 ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">
                      No audit events are recorded.
                    </p>
                  ) : (
                    auditEvents.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm"
                      >
                        <div className="font-medium">{event.eventType}</div>
                        <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                          {new Date(event.createdAt).toLocaleString()} ·{" "}
                          {event.source}
                          {event.actor ? ` · ${event.actor}` : ""}
                        </div>
                        {Object.keys(event.metadata).length > 0 ? (
                          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-[var(--ui-surface-2)] p-2 font-mono text-[11px] leading-5 text-[var(--ui-ink-faint)]">
                            {formatMetadataJson(event.metadata)}
                          </pre>
                        ) : null}
                      </div>
                    ))
                  )}
                  {auditQuery.data && auditEvents.length > 0 ? (
                    <div className="flex min-h-9 items-center justify-between gap-3 text-xs text-[var(--ui-ink-muted)]">
                      <span>
                        Showing {auditQuery.data.offset + 1}-
                        {Math.min(
                          auditQuery.data.offset + auditEvents.length,
                          auditQuery.data.total
                        )}{" "}
                        of {auditQuery.data.total}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            auditPageIndex === 0 || auditQuery.isFetching
                          }
                          onClick={() =>
                            setAuditPageIndex((current) =>
                              Math.max(0, current - 1)
                            )
                          }
                          aria-label="Previous artifact audit page"
                        >
                          <ChevronLeft className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            !auditQuery.data.hasMore || auditQuery.isFetching
                          }
                          onClick={() =>
                            setAuditPageIndex((current) => current + 1)
                          }
                          aria-label="Next artifact audit page"
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Card>
              </div>
            </>
          )}
        </section>
      </main>

      <QuestionFlowDialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open && uploadMutation.isPending) {
            cancelAllUploads();
            setUploadDialogError(
              "Canceling active uploads. The queue will stay open so you can retry any request whose response was interrupted."
            );
            return;
          }
          setUploadDialogOpen(open);
          if (!open) {
            setUploadFlowValue(EMPTY_UPLOAD_FLOW_VALUE);
            setUploadResults([]);
            canceledUploadItemIdsRef.current.clear();
            setUploadDialogError(null);
          }
        }}
        eyebrow="Artifact Store"
        title="Add artifacts"
        description="A guided flow for preserving trusted files with metadata, safety scans, provenance, and generic Forge entity links."
        value={uploadFlowValue}
        onChange={setUploadFlowValue}
        steps={uploadFlowSteps}
        pending={uploadMutation.isPending}
        pendingLabel="Uploading files"
        submitLabel={
          uploadResults.some(
            (result) =>
              result.status === "error" || result.status === "canceled"
          )
            ? "Retry unfinished files"
            : uploadFlowValue.items.some(
                  (item) =>
                    uploadResultByItemId.get(item.id)?.status !== "success"
                )
              ? "Upload artifacts"
              : "All files uploaded"
        }
        error={
          uploadDialogError ??
          (uploadMutation.error instanceof Error
            ? uploadMutation.error.message
            : null)
        }
        resolveContinueNudge={(stepId, value) => {
          if (stepId === "files" && value.items.length === 0) {
            return "Choose one or more files first.";
          }
          if (stepId === "queue") {
            return "Quick descriptions are enough; use Details when provenance matters.";
          }
          return null;
        }}
        onSubmit={submitUploadFlow}
      />
      <QuestionFlowDialog
        open={metadataDialogOpen}
        onOpenChange={(open) => {
          setMetadataDialogOpen(open);
          if (!open) {
            setMetadataDialogError(null);
          }
        }}
        eyebrow="Artifact Store"
        title="Edit artifact metadata"
        description="Update human-facing description and provenance fields while preserving immutable file identity and safety evidence."
        value={metadataFlowValue}
        onChange={setMetadataFlowValue}
        steps={metadataFlowSteps}
        pending={patchMutation.isPending}
        pendingLabel="Saving"
        submitLabel="Save metadata"
        error={metadataDialogError}
        resolveContinueNudge={(stepId, value) => {
          if (stepId === "describe" && !value.title.trim()) {
            return "A title is required.";
          }
          if (
            stepId === "provenance" &&
            metadataFieldCount(value.metadataText) === null
          ) {
            return "Metadata JSON must be a valid object before continuing.";
          }
          return null;
        }}
        onSubmit={submitMetadataFlow}
      />
      <QuestionFlowDialog
        open={trustDialogOpen}
        onOpenChange={(open) => {
          setTrustDialogOpen(open);
          if (!open) {
            setTrustDialogError(null);
          }
        }}
        eyebrow="Artifact Store"
        title="Change trust state"
        description="Apply a reasoned operator decision without altering the static danger score or scanner evidence."
        value={trustFlowValue}
        onChange={setTrustFlowValue}
        steps={trustFlowSteps}
        pending={trustMutation.isPending}
        pendingLabel="Applying"
        submitLabel="Apply trust decision"
        error={trustDialogError}
        resolveContinueNudge={(stepId, value) =>
          stepId === "decision" && !value.reason.trim()
            ? "Explain the evidence for this trust decision before continuing."
            : null
        }
        onSubmit={submitTrustFlow}
      />
      <QuestionFlowDialog
        open={linksDialogOpen}
        onOpenChange={(open) => {
          setLinksDialogOpen(open);
          if (!open) {
            setLinksDialogError(null);
          }
        }}
        eyebrow="Artifact Store"
        title="Manage artifact links"
        description="Connect this artifact to Forge records through the shared entity relationship model."
        value={linkFlowValue}
        onChange={setLinkFlowValue}
        steps={linkFlowSteps}
        pending={linksMutation.isPending}
        pendingLabel="Saving"
        submitLabel="Save relationships"
        error={
          linksDialogError ??
          (linksMutation.error instanceof Error
            ? linksMutation.error.message
            : null)
        }
        resolveContinueNudge={(stepId, value) =>
          stepId === "relationships" && value.drafts.length === 0
            ? "Saving with no relationships removes every current artifact link."
            : null
        }
        onSubmit={submitLinksFlow}
      />
      <QuestionFlowDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        eyebrow="Artifact Store"
        title="Delete artifact"
        description="Move this artifact record to the shared Forge bin while preserving stored bytes."
        value={{}}
        onChange={() => undefined}
        steps={archiveFlowSteps}
        pending={archiveMutation.isPending}
        pendingLabel="Deleting"
        submitLabel="Delete artifact"
        error={
          archiveMutation.error instanceof Error
            ? archiveMutation.error.message
            : null
        }
        onSubmit={async () => {
          await archiveMutation.mutateAsync();
        }}
      />
      <QuestionFlowDialog
        open={downloadPasswordDialogOpen}
        onOpenChange={(open) => {
          setDownloadPasswordDialogOpen(open);
          if (!open) {
            setDownloadPasswordValue(EMPTY_PASSWORD_FLOW_VALUE);
            setDownloadPasswordError(null);
          }
        }}
        eyebrow="Artifact Store"
        title="Download encrypted artifact"
        description="Enter the password to download the original file bytes."
        value={downloadPasswordValue}
        onChange={setDownloadPasswordValue}
        steps={passwordFlowSteps}
        pending={passwordDownloadMutation.isPending}
        pendingLabel="Downloading"
        submitLabel="Download"
        error={
          downloadPasswordError ??
          (passwordDownloadMutation.error instanceof Error
            ? passwordDownloadMutation.error.message
            : null)
        }
        onSubmit={submitPasswordDownload}
      />
      <QuestionFlowDialog
        open={encryptDialogOpen}
        onOpenChange={(open) => {
          setEncryptDialogOpen(open);
          if (!open) {
            setEncryptFlowValue(EMPTY_ENCRYPT_FLOW_VALUE);
            setEncryptDialogError(null);
          }
        }}
        eyebrow="Artifact Store"
        title="Encrypt artifact content"
        description="Add password protection to the stored file bytes while keeping metadata and links visible."
        value={encryptFlowValue}
        onChange={setEncryptFlowValue}
        steps={encryptFlowSteps}
        pending={encryptMutation.isPending}
        pendingLabel="Encrypting"
        submitLabel="Encrypt artifact"
        error={
          encryptDialogError ??
          (encryptMutation.error instanceof Error
            ? encryptMutation.error.message
            : null)
        }
        onSubmit={submitEncryptFlow}
      />
    </div>
  );
}
