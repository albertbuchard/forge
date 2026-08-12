import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  FileUp,
  Link2,
  Mic,
  MicOff,
  NotebookPen,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirmCapture, proposeCapture } from "@/lib/api";
import type {
  CaptureFileDescriptor,
  CaptureInputKind,
  CaptureIntent,
  CaptureProposal,
  CaptureReceipt
} from "@/lib/types";
import { cn } from "@/lib/utils";

const CAPTURE_DRAFT_STORAGE_KEY = "forge.capture.draft.v1";
const CAPTURE_DRAFT_MAX_CHARACTERS = 24_000;
const CAPTURE_MAX_FILE_BYTES = 100 * 1024 * 1024;

type CaptureDraft = {
  version: 1;
  kind: CaptureInputKind;
  text: string;
  url: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultLike[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function readDraft(): CaptureDraft {
  if (typeof window === "undefined") {
    return { version: 1, kind: "text", text: "", url: "" };
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY) ?? "null"
    ) as Partial<CaptureDraft> | null;
    if (
      parsed?.version === 1 &&
      ["text", "url", "file", "dictation"].includes(parsed.kind ?? "")
    ) {
      return {
        version: 1,
        kind: parsed.kind as CaptureInputKind,
        text: typeof parsed.text === "string" ? parsed.text.slice(0, CAPTURE_DRAFT_MAX_CHARACTERS) : "",
        url: typeof parsed.url === "string" ? parsed.url.slice(0, 4_096) : ""
      };
    }
  } catch {
    window.localStorage.removeItem(CAPTURE_DRAFT_STORAGE_KEY);
  }
  return { version: 1, kind: "text", text: "", url: "" };
}

function saveDraft(draft: CaptureDraft) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function createIdempotencyKey() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `capture-${suffix}`;
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Forge could not complete this capture.";
}

function relationshipKey(relationship: {
  entityType: string;
  entityId: string;
}) {
  return `${relationship.entityType}:${relationship.entityId}`;
}

const CAPTURE_MODES: Array<{
  kind: CaptureInputKind;
  label: string;
  description: string;
  icon: typeof NotebookPen;
}> = [
  {
    kind: "text",
    label: "Text",
    description: "A thought, note, or passage",
    icon: NotebookPen
  },
  {
    kind: "url",
    label: "Link",
    description: "A URL with optional context",
    icon: Link2
  },
  {
    kind: "file",
    label: "File",
    description: "One file, kept local until confirmation",
    icon: FileUp
  },
  {
    kind: "dictation",
    label: "Dictate",
    description: "Browser speech converted to text",
    icon: Mic
  }
];

export function CaptureDialog({
  open,
  onOpenChange,
  ownerUserId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerUserId: string | null;
}) {
  const navigate = useNavigate();
  const initialDraft = useMemo(readDraft, []);
  const [kind, setKind] = useState<CaptureInputKind>(initialDraft.kind);
  const [text, setText] = useState(initialDraft.text);
  const [url, setUrl] = useState(initialDraft.url);
  const [file, setFile] = useState<File | null>(null);
  const [fileDescriptor, setFileDescriptor] =
    useState<CaptureFileDescriptor | null>(null);
  const [proposal, setProposal] = useState<CaptureProposal | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedRelationships, setSelectedRelationships] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<CaptureReceipt | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"propose" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const draft = useMemo<CaptureDraft>(
    () => ({ version: 1, kind, text, url }),
    [kind, text, url]
  );

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsDictating(false);
    }
  }, [open]);

  const invalidateReview = () => {
    setProposal(null);
    setReceipt(null);
    setIdempotencyKey(null);
    setError(null);
  };

  const chooseKind = (nextKind: CaptureInputKind) => {
    setKind(nextKind);
    setFile(null);
    setFileDescriptor(null);
    invalidateReview();
  };

  const updateText = (value: string) => {
    setText(value.slice(0, CAPTURE_DRAFT_MAX_CHARACTERS));
    invalidateReview();
  };

  const updateUrl = (value: string) => {
    setUrl(value.slice(0, 4_096));
    invalidateReview();
  };

  const buildIntent = (): CaptureIntent | null => {
    if ((kind === "text" || kind === "dictation") && text.trim()) {
      return { version: 1, kind, text: text.trim(), ownerUserId };
    }
    if (kind === "url" && url.trim()) {
      return {
        version: 1,
        kind: "url",
        url: url.trim(),
        text: text.trim(),
        ownerUserId
      };
    }
    if (kind === "file" && fileDescriptor) {
      return {
        version: 1,
        kind: "file",
        file: fileDescriptor,
        text: text.trim(),
        ownerUserId
      };
    }
    return null;
  };

  const handleFile = async (nextFile: File | null) => {
    setFile(null);
    setFileDescriptor(null);
    invalidateReview();
    if (!nextFile) return;
    if (nextFile.size <= 0 || nextFile.size > CAPTURE_MAX_FILE_BYTES) {
      setError("Choose one non-empty file no larger than 100 MiB.");
      return;
    }
    try {
      const sha256 = await sha256File(nextFile);
      setFile(nextFile);
      setFileDescriptor({
        name: nextFile.name,
        declaredMimeType: nextFile.type,
        byteSize: nextFile.size,
        sha256
      });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const handlePropose = async () => {
    const intent = buildIntent();
    if (!intent) {
      setError(
        kind === "file"
          ? "Choose a file before asking Forge to review the capture."
          : "Add something to capture first."
      );
      return;
    }
    setPendingAction("propose");
    setError(null);
    setReceipt(null);
    try {
      const response = await proposeCapture(intent);
      setProposal(response.proposal);
      setTitle(response.proposal.title);
      setContent(
        response.proposal.targetType === "note"
          ? response.proposal.contentMarkdown ?? ""
          : response.proposal.description ?? ""
      );
      setSelectedRelationships(
        response.proposal.relationships.map(relationshipKey)
      );
      setIdempotencyKey(createIdempotencyKey());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirm = async () => {
    const intent = buildIntent();
    if (!proposal || !intent) return;
    if (!title.trim() || (proposal.targetType === "note" && !content.trim())) {
      setError("Review requires a title and captured Note content.");
      return;
    }
    setPendingAction("confirm");
    setError(null);
    const stableKey = idempotencyKey ?? createIdempotencyKey();
    setIdempotencyKey(stableKey);
    try {
      const fileContentBase64 =
        proposal.targetType === "artifact" && file
          ? await fileToBase64(file)
          : null;
      const response = await confirmCapture({
        proposalId: proposal.proposalId,
        idempotencyKey: stableKey,
        intent,
        selection: {
          targetType: proposal.targetType,
          title: title.trim(),
          contentMarkdown:
            proposal.targetType === "note" ? content.trim() : null,
          description:
            proposal.targetType === "artifact" ? content.trim() : null,
          relationshipKeys: selectedRelationships
        },
        fileContentBase64
      });
      setReceipt(response.receipt);
      window.localStorage.removeItem(CAPTURE_DRAFT_STORAGE_KEY);
      setText("");
      setUrl("");
      setFile(null);
      setFileDescriptor(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const startDictation = () => {
    if (isDictating) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Constructor =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setError("This browser does not provide speech recognition. You can still type the transcript.");
      return;
    }
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      const additions: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal && result[0]?.transcript) {
          additions.push(result[0].transcript.trim());
        }
      }
      if (additions.length > 0) {
        setText((current) =>
          `${current.trim()} ${additions.join(" ")}`
            .trim()
            .slice(0, CAPTURE_DRAFT_MAX_CHARACTERS)
        );
        invalidateReview();
      }
    };
    recognition.onerror = () => {
      setError("Dictation stopped before the browser returned a transcript.");
    };
    recognition.onend = () => {
      setIsDictating(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setIsDictating(true);
    setError(null);
    recognition.start();
  };

  const resetCapture = () => {
    recognitionRef.current?.stop();
    setKind("text");
    setText("");
    setUrl("");
    setFile(null);
    setFileDescriptor(null);
    setProposal(null);
    setReceipt(null);
    setIdempotencyKey(null);
    setError(null);
    window.localStorage.removeItem(CAPTURE_DRAFT_STORAGE_KEY);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-[60] backdrop-blur-xl" />
        <Dialog.Content className="surface-modal-panel fixed inset-x-3 bottom-3 top-3 z-[70] flex flex-col overflow-hidden rounded-[30px] border sm:inset-x-6 sm:bottom-6 sm:top-6 md:left-1/2 md:right-auto md:top-[7vh] md:h-[min(86vh,54rem)] md:w-[min(58rem,calc(100vw-2rem))] md:-translate-x-1/2 md:bottom-auto">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--ui-border-subtle)] px-5 py-4 sm:px-7">
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--primary)]">
                <Sparkles className="size-4" /> Global Capture
              </div>
              <Dialog.Title className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                Capture first. Decide where it belongs before Forge writes.
              </Dialog.Title>
              <Dialog.Description className="mt-1 max-w-2xl text-sm text-[var(--ui-ink-medium)]">
                Your draft stays in this browser. Forge proposes a record and relationships, then waits for explicit confirmation.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                aria-label="Close Global Capture"
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
            {receipt ? (
              <section className="mx-auto max-w-2xl rounded-[26px] border border-[color-mix(in_srgb,var(--success)_32%,var(--ui-border-subtle))] bg-[var(--ui-success-soft)] p-6">
                <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-[var(--ui-surface-1)] text-[var(--success)]">
                  <Check className="size-6" />
                </div>
                <h3 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                  {receipt.replayed ? "Capture already confirmed" : "Capture confirmed"}
                </h3>
                <p className="mt-2 text-sm text-[var(--ui-ink-medium)]">
                  Forge created {receipt.targetType === "note" ? "a Note" : "an Artifact"} named “{receipt.title}” with {receipt.relationshipCount} reviewed relationship{receipt.relationshipCount === 1 ? "" : "s"}.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    size="lg"
                    onClick={() => {
                      onOpenChange(false);
                      navigate(receipt.targetHref);
                    }}
                  >
                    Open record
                  </Button>
                  <Button size="lg" variant="secondary" onClick={resetCapture}>
                    Capture another
                  </Button>
                </div>
              </section>
            ) : !proposal ? (
              <div className="grid gap-5">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {CAPTURE_MODES.map((mode) => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.kind}
                        type="button"
                        className={cn(
                          "min-h-24 rounded-[22px] border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                          kind === mode.kind
                            ? "border-[color-mix(in_srgb,var(--primary)_48%,var(--ui-border-subtle))] bg-[var(--ui-accent-soft)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        onClick={() => chooseKind(mode.kind)}
                        aria-pressed={kind === mode.kind}
                      >
                        <Icon className="mb-3 size-5 text-[var(--primary)]" />
                        <div className="font-medium text-[var(--ui-ink-strong)]">{mode.label}</div>
                        <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">{mode.description}</div>
                      </button>
                    );
                  })}
                </div>

                {kind === "url" ? (
                  <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-medium)]">
                    URL
                    <Input
                      type="url"
                      value={url}
                      placeholder="https://example.com/useful-source"
                      onChange={(event) => updateUrl(event.target.value)}
                    />
                  </label>
                ) : null}

                {kind === "file" ? (
                  <label className="grid min-h-32 cursor-pointer place-items-center rounded-[24px] border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-surface-2)] p-5 text-center">
                    <FileUp className="size-7 text-[var(--primary)]" />
                    <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      {fileDescriptor?.name ?? "Choose one file"}
                    </span>
                    <span className="text-xs text-[var(--ui-ink-faint)]">
                      Up to 100 MiB. Bytes are not stored in the browser draft and are sent only after confirmation.
                    </span>
                    <input
                      type="file"
                      className="sr-only"
                      onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                ) : null}

                <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-medium)]">
                  {kind === "url"
                    ? "Context (optional)"
                    : kind === "file"
                      ? "Description (optional)"
                      : kind === "dictation"
                        ? "Transcript"
                        : "What do you want to capture?"}
                  <Textarea
                    value={text}
                    rows={9}
                    maxLength={CAPTURE_DRAFT_MAX_CHARACTERS}
                    placeholder={
                      kind === "dictation"
                        ? "Start dictation or type the transcript…"
                        : "Write or paste it here…"
                    }
                    onChange={(event) => updateText(event.target.value)}
                  />
                </label>

                {kind === "dictation" ? (
                  <Button type="button" variant="secondary" size="lg" onClick={startDictation}>
                    {isDictating ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                    {isDictating ? "Stop dictation" : "Start dictation"}
                  </Button>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ui-border-subtle)] pt-5">
                  <div className="flex items-center gap-2 text-xs text-[var(--ui-ink-faint)]">
                    <ShieldCheck className="size-4" /> No Forge record exists yet.
                  </div>
                  <Button
                    size="lg"
                    pending={pendingAction === "propose"}
                    pendingLabel="Reviewing capture…"
                    onClick={() => void handlePropose()}
                  >
                    Review proposal
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <section className="grid gap-4">
                  <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--primary)]">Proposed record</div>
                    <div className="mt-2 text-lg font-semibold capitalize text-[var(--ui-ink-strong)]">{proposal.targetType}</div>
                    <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">{proposal.classificationReason}</p>
                  </div>
                  <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-medium)]">
                    Title
                    <Input
                      value={title}
                      maxLength={240}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        setIdempotencyKey(null);
                      }}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-medium)]">
                    {proposal.targetType === "note" ? "Markdown content" : "Description"}
                    <Textarea
                      value={content}
                      rows={12}
                      maxLength={CAPTURE_DRAFT_MAX_CHARACTERS}
                      onChange={(event) => {
                        setContent(event.target.value);
                        setIdempotencyKey(null);
                      }}
                    />
                  </label>
                </section>

                <aside className="grid content-start gap-4">
                  <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                    <h3 className="font-medium text-[var(--ui-ink-strong)]">Proposed relationships</h3>
                    <p className="mt-1 text-xs text-[var(--ui-ink-faint)]">Only checked records will be linked. Forge rechecks access before writing.</p>
                    <div className="mt-3 grid gap-2">
                      {proposal.relationships.length === 0 ? (
                        <p className="text-sm text-[var(--ui-ink-faint)]">No relationship was proposed.</p>
                      ) : (
                        proposal.relationships.map((relationship) => {
                          const key = relationshipKey(relationship);
                          const checked = selectedRelationships.includes(key);
                          return (
                            <label key={key} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] p-3">
                              <input
                                type="checkbox"
                                className="mt-1 size-4 accent-[var(--primary)]"
                                checked={checked}
                                onChange={() => {
                                  setSelectedRelationships((current) =>
                                    checked
                                      ? current.filter((value) => value !== key)
                                      : [...current, key]
                                  );
                                  setIdempotencyKey(null);
                                }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-[var(--ui-ink-strong)]">{relationship.title}</span>
                                <span className="mt-1 block text-xs text-[var(--ui-ink-faint)]">{relationship.reason}</span>
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                  {proposal.warnings.map((warning) => (
                    <div key={warning} className="rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle))] bg-[var(--ui-warning-soft)] p-3 text-xs text-[var(--ui-ink-medium)]">
                      {warning}
                    </div>
                  ))}
                </aside>
              </div>
            )}

            {error ? (
              <div className="mt-5 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_32%,var(--ui-border-subtle))] bg-[var(--ui-danger-soft)] p-4 text-sm text-[var(--danger)]" role="alert">
                {error}
              </div>
            ) : null}
          </div>

          {proposal && !receipt ? (
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ui-border-subtle)] px-5 py-4 sm:px-7">
              <Button variant="secondary" size="lg" onClick={invalidateReview}>
                <RotateCcw className="size-4" /> Back to draft
              </Button>
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-[var(--ui-ink-faint)] sm:inline">Nothing is written until you confirm.</span>
                <Button
                  size="lg"
                  pending={pendingAction === "confirm"}
                  pendingLabel="Confirming…"
                  onClick={() => void handleConfirm()}
                >
                  Confirm and create
                </Button>
              </div>
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
