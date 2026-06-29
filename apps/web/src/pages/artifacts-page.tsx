import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Download,
  FileSearch,
  Files,
  Link2,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
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
  downloadArtifact,
  enrichArtifact,
  listArtifactAuditEvents,
  listArtifacts,
  listArtifactVersions,
  patchArtifact,
  replaceArtifactEntityLinks,
  rescanArtifact,
  uploadArtifact
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Artifact,
  ArtifactDangerLevel,
  ArtifactFormatFamily,
  ArtifactScanFinding,
  ArtifactScanResult,
  ArtifactSourceKind,
  ArtifactState,
  ArtifactUploadInput,
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

function dangerClass(level: ArtifactDangerLevel) {
  if (level === "blocked") {
    return "border-red-400/40 bg-red-500/12 text-red-100";
  }
  if (level === "high") {
    return "border-orange-400/40 bg-orange-500/12 text-orange-100";
  }
  if (level === "moderate") {
    return "border-yellow-300/35 bg-yellow-300/10 text-yellow-100";
  }
  return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
}

function isScanResult(value: Artifact["scanResults"]): value is ArtifactScanResult {
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

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function createUploadQueueItem(file: File): ArtifactUploadQueueItem {
  const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
  return {
    id: randomId,
    file,
    title,
    shortDescription: "",
    description: "",
    sourceLabel: "",
    sourceKind: "upload",
    useLlmEnrichment: false,
    genericLinksText: "",
    metadataText: ""
  };
}

function appendUploadFiles(value: ArtifactUploadFlowValue, files: File[]) {
  if (files.length === 0) {
    return value;
  }
  return {
    ...value,
    items: [...value.items, ...files.map(createUploadQueueItem)],
    activeItemId: null
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

type UploadDraft = {
  title: string;
  shortDescription: string;
  description: string;
  sourceLabel: string;
  useLlmEnrichment: boolean;
  genericLinksText: string;
};

type ArtifactUploadQueueItem = UploadDraft & {
  id: string;
  file: File;
  sourceKind: ArtifactSourceKind;
  metadataText: string;
};

type ArtifactUploadFlowValue = {
  items: ArtifactUploadQueueItem[];
  activeItemId: string | null;
};

type ArtifactUploadResult =
  | {
      itemId: string;
      fileName: string;
      status: "success";
      artifactId: string;
      title: string;
    }
  | {
      itemId: string;
      fileName: string;
      status: "error";
      error: string;
    };

const EMPTY_UPLOAD_FLOW_VALUE: ArtifactUploadFlowValue = {
  items: [],
  activeItemId: null
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
  "agent_upload",
  "wiki_ingest",
  "external_reference",
  "manual"
];

function parseGenericLinksText(value: string): EntityLinkInput[] {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        entityType = "",
        entityId = "",
        relationship = "related",
        anchorKey = ""
      ] = line
        .split(":")
        .map((part) => part.trim());
      return { entityType, entityId, relationship, anchorKey };
    })
    .filter((link) => link.entityType.length > 0 && link.entityId.length > 0);
}

function formatGenericLinksText(links: Artifact["links"]) {
  return links
    .map((link) =>
      [
        link.targetEntityType,
        link.targetEntityId,
        link.relationship || "related",
        link.anchorKey ?? ""
      ]
        .filter((part, index) => index < 3 || part.length > 0)
        .join(":")
    )
    .join("\n");
}

function ArtifactListItem({
  artifact,
  selected,
  onSelect
}: {
  artifact: Artifact;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-[var(--radius-card)] border p-3 text-left transition",
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
        <Badge size="xs" className={cn("shrink-0", dangerClass(artifact.dangerLevel))}>
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
  if (result.status === "success") {
    return (
      <Badge size="xs" className="border-emerald-300/35 bg-emerald-400/10 text-emerald-100">
        Uploaded
      </Badge>
    );
  }
  return (
    <Badge size="xs" className="border-red-400/40 bg-red-500/12 text-red-100">
      Failed
    </Badge>
  );
}

export function ArtifactsPage() {
  const { artifactId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [dangerLevel, setDangerLevel] = useState<ArtifactDangerLevel | "">("");
  const [formatFamily, setFormatFamily] = useState<ArtifactFormatFamily | "">("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFlowValue, setUploadFlowValue] = useState<ArtifactUploadFlowValue>(
    EMPTY_UPLOAD_FLOW_VALUE
  );
  const [uploadResults, setUploadResults] = useState<ArtifactUploadResult[]>([]);
  const [uploadDialogError, setUploadDialogError] = useState<string | null>(null);
  const [uploadedArtifactToOpenId, setUploadedArtifactToOpenId] =
    useState<string | null>(null);
  const [genericLinksText, setGenericLinksText] = useState("");

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", query, dangerLevel, formatFamily],
    queryFn: () =>
      listArtifacts({
        query: query || undefined,
        dangerLevel: dangerLevel || undefined,
        formatFamily: formatFamily || undefined,
        limit: 200
      })
  });

  const artifacts = artifactsQuery.data?.artifacts ?? [];
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === artifactId) ?? artifacts[0] ?? null,
    [artifactId, artifacts]
  );

  const versionsQuery = useQuery({
    queryKey: ["artifact-versions", selectedArtifact?.id],
    enabled: Boolean(selectedArtifact?.id),
    queryFn: () => listArtifactVersions(selectedArtifact!.id)
  });

  const auditQuery = useQuery({
    queryKey: ["artifact-audit", selectedArtifact?.id],
    enabled: Boolean(selectedArtifact?.id),
    queryFn: () => listArtifactAuditEvents(selectedArtifact!.id)
  });

  useEffect(() => {
    if (!artifactId && selectedArtifact && !uploadDialogOpen) {
      navigate(`/artifacts/${selectedArtifact.id}`, { replace: true });
    }
  }, [artifactId, navigate, selectedArtifact, uploadDialogOpen]);

  useEffect(() => {
    if (!uploadDialogOpen && uploadedArtifactToOpenId) {
      navigate(`/artifacts/${uploadedArtifactToOpenId}`);
      setUploadedArtifactToOpenId(null);
    }
  }, [navigate, uploadDialogOpen, uploadedArtifactToOpenId]);

  const invalidateArtifacts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
      queryClient.invalidateQueries({ queryKey: ["artifact-versions"] }),
      queryClient.invalidateQueries({ queryKey: ["artifact-audit"] }),
      queryClient.invalidateQueries({ queryKey: ["knowledge-graph"] })
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: async (items: ArtifactUploadQueueItem[]) => {
      if (items.length === 0) {
        throw new Error("Choose one or more files first.");
      }
      const results: ArtifactUploadResult[] = [];
      for (const item of items) {
        try {
          const input: ArtifactUploadInput = {
            title: item.title.trim() || undefined,
            shortDescription: item.shortDescription,
            description: item.description,
            originalFileName: item.file.name,
            declaredMimeType: item.file.type,
            contentBase64: await fileToBase64(item.file),
            sourceKind: item.sourceKind,
            sourceLabel: item.sourceLabel,
            metadata: parseMetadataText(item.metadataText),
            links: parseGenericLinksText(item.genericLinksText),
            useLlmEnrichment: item.useLlmEnrichment
          };
          const { artifact } = await uploadArtifact(input);
          results.push({
            itemId: item.id,
            fileName: item.file.name,
            status: "success",
            artifactId: artifact.id,
            title: artifact.title
          });
        } catch (error) {
          results.push({
            itemId: item.id,
            fileName: item.file.name,
            status: "error",
            error: readErrorMessage(error)
          });
        }
      }
      return results;
    },
    onSuccess: async (results) => {
      setUploadResults((current) => {
        const merged = new Map(current.map((result) => [result.itemId, result]));
        for (const result of results) {
          merged.set(result.itemId, result);
        }
        return Array.from(merged.values());
      });
      await invalidateArtifacts();
      const firstSuccess = results.find((result) => result.status === "success");
      if (firstSuccess?.status === "success") {
        setUploadedArtifactToOpenId(firstSuccess.artifactId);
      }
    }
  });

  const patchMutation = useMutation({
    mutationFn: (patch: Partial<Pick<Artifact, "title" | "shortDescription" | "description">>) =>
      patchArtifact(selectedArtifact!.id, patch),
    onSuccess: invalidateArtifacts
  });

  const scanMutation = useMutation({
    mutationFn: () => rescanArtifact(selectedArtifact!.id),
    onSuccess: invalidateArtifacts
  });

  const enrichMutation = useMutation({
    mutationFn: () => enrichArtifact(selectedArtifact!.id, { fillMissingOnly: true }),
    onSuccess: invalidateArtifacts
  });

  const linksMutation = useMutation({
    mutationFn: (links: EntityLinkInput[]) =>
      replaceArtifactEntityLinks(selectedArtifact!.id, links),
    onSuccess: invalidateArtifacts
  });

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const artifact = selectedArtifact!;
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

  const findings = scanFindings(selectedArtifact);
  const versionCount = versionsQuery.data?.versions.length ?? 0;
  const auditEvents = auditQuery.data?.events ?? [];

  useEffect(() => {
    setGenericLinksText(
      selectedArtifact ? formatGenericLinksText(selectedArtifact.links) : ""
    );
  }, [selectedArtifact?.id, selectedArtifact?.links.length, selectedArtifact?.updatedAt]);

  const uploadResultByItemId = useMemo(
    () => new Map(uploadResults.map((result) => [result.itemId, result])),
    [uploadResults]
  );

  const openUploadDialog = () => {
    setUploadFlowValue(EMPTY_UPLOAD_FLOW_VALUE);
    setUploadResults([]);
    setUploadDialogError(null);
    setUploadedArtifactToOpenId(null);
    setUploadDialogOpen(true);
  };

  const uploadFlowSteps = useMemo<Array<QuestionFlowStep<ArtifactUploadFlowValue>>>(
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
                setUploadResults([]);
                setValue(
                  appendUploadFiles(value, Array.from(event.dataTransfer.files))
                );
              }}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Files className="size-4 text-[var(--primary)]" />
                    Files
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    Spreadsheets, documents, PDFs, text, structured text, and images are supported.
                  </p>
                </div>
                <Input
                  aria-label="Artifact files"
                  type="file"
                  multiple
                  accept={ARTIFACT_ACCEPT_EXTENSIONS}
                  className="w-full sm:max-w-xs"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    setUploadResults([]);
                    setValue(appendUploadFiles(value, files));
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
                      <div className="truncate text-sm font-medium">{item.file.name}</div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                        {formatBytes(item.file.size)} · {item.file.type || "unknown type"}
                      </div>
                    </div>
                    <UploadResultBadge result={uploadResultByItemId.get(item.id)} />
                  </div>
                ))}
              </div>
            )}
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
                <div className="flex flex-col gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{activeItem.file.name}</div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                      {formatBytes(activeItem.file.size)} · {activeItem.file.type || "unknown type"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setValue({ activeItemId: null })}
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
                      value={activeItem.sourceKind}
                      onChange={(event) =>
                        setValue(
                          updateUploadItem(value, activeItem.id, {
                            sourceKind: event.target.value as ArtifactSourceKind
                          })
                        )
                      }
                      className="interactive-tap min-h-10 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
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

                <FlowField
                  label="Generic entity links"
                  hint="One per line: entityType:entityId:relationship:anchorKey"
                >
                  <Textarea
                    value={activeItem.genericLinksText}
                    onChange={(event) =>
                      setValue(
                        updateUploadItem(value, activeItem.id, {
                          genericLinksText: event.target.value
                        })
                      )
                    }
                  />
                </FlowField>

                <FlowField label="Metadata JSON" hint='Optional object, for example {"period":"Q2","owner":"Albert"}'>
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

                <label className="flex items-center gap-2 text-sm text-[var(--ui-ink-medium)]">
                  <input
                    type="checkbox"
                    checked={activeItem.useLlmEnrichment}
                    onChange={(event) =>
                      setValue(
                        updateUploadItem(value, activeItem.id, {
                          useLlmEnrichment: event.target.checked
                        })
                      )
                    }
                  />
                  Use configured LLM to fill missing metadata for this file
                </label>
              </div>
            );
          }

          return (
            <div className="grid gap-3">
              {value.items.length === 0 ? (
                <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-muted)]">
                  Choose files first.
                </div>
              ) : (
                value.items.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.file.name}</div>
                        <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                          {formatBytes(item.file.size)} · {item.file.type || "unknown type"}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setValue({ activeItemId: item.id })}
                        >
                          <Pencil className="size-4" />
                          Details
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setValue(removeUploadItem(value, item.id))}
                        >
                          <Trash2 className="size-4" />
                          Remove
                        </Button>
                      </div>
                    </div>
                    <Input
                      aria-label={`Short description for ${item.file.name}`}
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
                    <UploadResultBadge result={uploadResultByItemId.get(item.id)} />
                  </div>
                ))
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

          return (
            <div className="grid gap-4">
              {uploadResults.length > 0 ? (
                <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="size-4 text-[var(--primary)]" />
                    Upload results
                  </div>
                  <p className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                    {successCount} uploaded · {failureCount} failed
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3">
                {value.items.map((item) => {
                  const result = uploadResultByItemId.get(item.id);
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
                        <UploadResultBadge result={result} />
                      </div>
                      {result?.status === "error" ? (
                        <p className="mt-3 rounded-[18px] border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                          {result.error}
                        </p>
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
    [uploadResultByItemId, uploadResults]
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
    try {
      for (const item of itemsToUpload) {
        parseMetadataText(item.metadataText);
      }
    } catch (error) {
      setUploadDialogError(readErrorMessage(error));
      return;
    }
    setUploadDialogError(null);
    await uploadMutation.mutateAsync(itemsToUpload);
  };

  return (
    <div className="min-h-full bg-[var(--ui-bg)] text-[var(--ui-ink-strong)]">
      <PageHero
        entityKind="artifact"
        title="Artifacts"
        description="Trusted file storage for precise metadata, safety scans, provenance, generic entity links, and human-only downloads."
        badge={`${artifacts.length} stored`}
        actions={
          <Button
            type="button"
            onClick={openUploadDialog}
          >
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
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, file, description, provenance"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
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
                value={formatFamily}
                onChange={(event) =>
                  setFormatFamily(event.target.value as ArtifactFormatFamily | "")
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
          </Card>

          <div className="space-y-2">
            {artifactsQuery.isLoading ? (
              <Card className="text-sm text-[var(--ui-ink-muted)]">Loading artifacts...</Card>
            ) : artifactsQuery.error ? (
              <ErrorState error={artifactsQuery.error} />
            ) : artifacts.length === 0 ? (
              <EmptyState
                title="No artifacts found"
                description="Upload a trusted file to create the first artifact record."
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
          {!selectedArtifact ? (
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
                      <Badge className={cn(dangerClass(selectedArtifact.dangerLevel))}>
                        {titleCase(selectedArtifact.dangerLevel)} danger
                      </Badge>
                      <Badge tone="meta">{titleCase(selectedArtifact.artifactState)}</Badge>
                      <Badge tone="meta">{selectedArtifact.detectedExtension.toUpperCase()}</Badge>
                    </div>
                    <h2 className="mt-3 break-words text-2xl font-semibold">
                      {selectedArtifact.title}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm text-[var(--ui-ink-muted)]">
                      {selectedArtifact.shortDescription || selectedArtifact.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => scanMutation.mutate()}
                      pending={scanMutation.isPending}
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
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  {[
                    ["File", selectedArtifact.originalFileName],
                    ["Size", formatBytes(selectedArtifact.byteSize)],
                    ["Versions", versionCount],
                    ["Links", selectedArtifact.links.length]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
                    >
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                        {label}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    defaultValue={selectedArtifact.title}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== selectedArtifact.title) {
                        patchMutation.mutate({ title: value });
                      }
                    }}
                    aria-label="Artifact title"
                  />
                  <Input
                    defaultValue={selectedArtifact.shortDescription}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== selectedArtifact.shortDescription) {
                        patchMutation.mutate({ shortDescription: value });
                      }
                    }}
                    aria-label="Artifact short description"
                  />
                </div>
                <Textarea
                  defaultValue={selectedArtifact.description}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value !== selectedArtifact.description) {
                      patchMutation.mutate({ description: value });
                    }
                  }}
                  aria-label="Artifact description"
                />
              </Card>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <Card className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldAlert className="size-4 text-[var(--primary)]" />
                    Safety Findings
                  </div>
                  {findings.length === 0 ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">No findings recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {findings.map((finding) => (
                        <div
                          key={`${finding.code}:${finding.message}`}
                          className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge size="xs" className={dangerClass(finding.severity as ArtifactDangerLevel)}>
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
                  {selectedArtifact.links.length === 0 ? (
                    <p className="text-sm text-[var(--ui-ink-muted)]">No linked entities.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedArtifact.links.map((link) => (
                        <div
                          key={`${link.targetEntityType}:${link.targetEntityId}:${link.relationship}`}
                          className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm"
                        >
                          <div className="font-medium">{titleCase(link.targetEntityType)}</div>
                          <div className="mt-1 break-all text-xs text-[var(--ui-ink-muted)]">
                            {link.targetEntityId}
                          </div>
                          <Badge className="mt-2" size="xs" tone="meta">
                            {titleCase(link.relationship)}
                          </Badge>
                          {link.anchorKey ? (
                            <div className="mt-2 text-xs text-[var(--ui-ink-muted)]">
                              Anchor: {link.anchorKey}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  <Textarea
                    value={genericLinksText}
                    onChange={(event) => setGenericLinksText(event.target.value)}
                    placeholder="Generic entity links, one per line: entityType:entityId:relationship:anchorKey"
                    aria-label="Generic entity links"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      linksMutation.mutate(parseGenericLinksText(genericLinksText))
                    }
                    pending={linksMutation.isPending}
                  >
                    <Link2 className="size-4" />
                    Save Links
                  </Button>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileSearch className="size-4 text-[var(--primary)]" />
                    Versions
                  </div>
                  {(versionsQuery.data?.versions ?? []).map((version) => (
                    <div
                      key={version.id}
                      className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm"
                    >
                      <div className="font-medium">Version {version.versionNumber}</div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                        {formatBytes(version.byteSize)} · {version.originalFileName}
                      </div>
                    </div>
                  ))}
                </Card>

                <Card className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileSearch className="size-4 text-[var(--primary)]" />
                    Audit
                  </div>
                  {auditEvents.slice(0, 10).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm"
                    >
                      <div className="font-medium">{event.eventType}</div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                        {new Date(event.createdAt).toLocaleString()} · {event.source}
                      </div>
                    </div>
                  ))}
                </Card>
              </div>
            </>
          )}
        </section>
      </main>

      <QuestionFlowDialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          setUploadDialogOpen(open);
          if (!open) {
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
        pendingLabel="Uploading"
        submitLabel={
          uploadFlowValue.items.some(
            (item) => uploadResultByItemId.get(item.id)?.status !== "success"
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
    </div>
  );
}
