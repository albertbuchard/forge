import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  CircleAlert,
  Clock3,
  FileAudio,
  Forward,
  Inbox,
  MailCheck,
  MessageSquareText,
  Mic,
  MicOff,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Trash2,
  WifiOff
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import {
  activateVoiceReservation,
  blobToBase64,
  createAgentMessage,
  createAgentMessageOperationKey,
  createVoiceReservation,
  deleteAgentMessage,
  getAgentMessage,
  getAgentMessageSettings,
  listAgentMessages,
  listConnectedMessageAgents,
  markAgentMessageRead,
  reassignAgentMessage,
  retryAgentMessage,
  updateDefaultMessageAgent,
  type AgentMessage,
  type AgentMessageStatus,
  type ConnectedAgent
} from "@/lib/agent-messages-api";
import { cn, formatDateTime } from "@/lib/utils";

const MESSAGE_QUERY_KEY = ["agent-messages"] as const;
const RECORDING_LIMIT_MS = 600_000;
const VOICE_LIMIT_BYTES = 25 * 1024 * 1024;
const CELLULAR_CONFIRM_BYTES = 5 * 1024 * 1024;

const STATUS_COPY: Record<
  AgentMessageStatus,
  { label: string; tone: "meta" | "signal" }
> = {
  delivered: { label: "Delivered", tone: "meta" },
  claimed: { label: "Claimed", tone: "signal" },
  in_progress: { label: "In progress", tone: "signal" },
  acknowledged: { label: "Acknowledged", tone: "signal" },
  handled: { label: "Handled", tone: "signal" },
  failed: { label: "Failed", tone: "meta" },
  forwarded: { label: "Forwarded", tone: "meta" }
};

function preferredRecordingMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
}

function fileExtension(mimeType: string) {
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

type ComposerSendAttempt = {
  bodyText: string;
  recipientAgentId: string;
  voiceBlob: Blob | null;
  durationMs: number;
  mimeType: string;
  originalFileName: string;
  reservationKey: string;
  reservationId?: string;
  contentBase64?: string;
  messageKey: string;
};

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function agentPresence(agent: ConnectedAgent) {
  return agent.connected
    ? "Connected"
    : "Connected account · currently offline";
}

function MessageStatus({ status }: { status: AgentMessageStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <Badge
      tone={copy.tone}
      className={cn(
        status === "handled" &&
          "border-[var(--ui-success-border)] bg-[var(--ui-success-soft)] text-[var(--success)]",
        status === "failed" &&
          "border-[var(--ui-danger-border)] bg-[var(--ui-danger-soft)] text-[var(--danger)]"
      )}
    >
      {copy.label}
    </Badge>
  );
}

export function agentMessageNotification(
  agentLabel: string,
  status: AgentMessageStatus
) {
  return {
    title: `Agent update from ${agentLabel}`,
    options: {
      body: `Agent Message status: ${STATUS_COPY[status].label}.`,
      tag: "forge-agent-message-update"
    }
  } satisfies { title: string; options: NotificationOptions };
}

function MessageRow({ message }: { message: AgentMessage }) {
  return (
    <Link
      to={`/messages/${encodeURIComponent(message.id)}`}
      className="interactive-tap block rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--ui-ink-strong)]">
            {message.recipient.label}
          </p>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
            {message.bodyText || "Voice note"}
          </p>
        </div>
        <MessageStatus status={message.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-ink-soft)]">
        {message.voiceArtifact ? (
          <span className="inline-flex items-center gap-1">
            <FileAudio className="size-3.5" />
            {formatDuration(message.voiceArtifact.verifiedDurationMs)} voice
          </span>
        ) : null}
        <span>{formatDateTime(message.updatedAt)}</span>
        {message.unreadInboxEventSequence ? (
          <span className="rounded-full bg-[var(--ui-accent-soft)] px-2 py-0.5 font-medium text-[var(--primary)]">
            New agent activity
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function AgentMessageComposer({
  agents,
  defaultAgentId,
  autoRecord,
  onSent
}: {
  agents: ConnectedAgent[];
  defaultAgentId: string;
  autoRecord: boolean;
  onSent: (message: AgentMessage) => void;
}) {
  const [bodyText, setBodyText] = useState("");
  const [recipientAgentId, setRecipientAgentId] = useState(defaultAgentId);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [allowLargeTransfer, setAllowLargeTransfer] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const autoStartedRef = useRef(false);
  const sendAttemptRef = useRef<ComposerSendAttempt | null>(null);

  useEffect(() => {
    if (!recipientAgentId && defaultAgentId)
      setRecipientAgentId(defaultAgentId);
  }, [defaultAgentId, recipientAgentId]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setRecordingError(null);
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingError("Voice recording is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecordingError(
          "Recording stopped because the browser reported an audio error."
        );
      };
      recorder.onstop = () => {
        if (stopTimerRef.current !== null) {
          window.clearTimeout(stopTimerRef.current);
          stopTimerRef.current = null;
        }
        const duration = Math.min(
          RECORDING_LIMIT_MS,
          Date.now() - startedAtRef.current
        );
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        setRecording(false);
        setRecordedDurationMs(duration);
        if (blob.size > VOICE_LIMIT_BYTES) {
          setRecordedBlob(null);
          setRecordingError(
            "This voice note exceeds the 25 MB limit. Record a shorter note."
          );
          return;
        }
        setRecordedBlob(blob);
        setStatusMessage(
          "Voice note ready. Review it, add text if useful, then send."
        );
      };
      recorder.start(1000);
      setRecordedBlob(null);
      setRecordedDurationMs(0);
      setRecording(true);
      setStatusMessage("Recording started.");
      stopTimerRef.current = window.setTimeout(
        stopRecording,
        RECORDING_LIMIT_MS
      );
    } catch (error) {
      setRecordingError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was not allowed. You can still send text or choose an audio file."
          : "Forge could not start the microphone. You can still send text or choose an audio file."
      );
    }
  }, [stopRecording]);

  useEffect(() => {
    if (!autoRecord) {
      autoStartedRef.current = false;
    } else if (!autoStartedRef.current) {
      autoStartedRef.current = true;
      void startRecording();
    }
  }, [autoRecord, startRecording]);

  useEffect(() => {
    if (!recordedBlob) {
      setRecordedUrl(null);
      return;
    }
    const url = URL.createObjectURL(recordedBlob);
    setRecordedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  useEffect(
    () => () => {
      if (stopTimerRef.current !== null)
        window.clearTimeout(stopTimerRef.current);
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const text = bodyText.trim();
      if (!text && !recordedBlob)
        throw new Error("Add text or a voice note before sending.");
      if (!recipientAgentId)
        throw new Error("Choose a connected agent before sending.");
      if (new TextEncoder().encode(text).byteLength > 50_000) {
        throw new Error("Message text exceeds the 50 KB limit.");
      }
      if (
        recordedBlob &&
        recordedBlob.size > CELLULAR_CONFIRM_BYTES &&
        !allowLargeTransfer
      ) {
        throw new Error(
          "Confirm the large upload before sending this voice note."
        );
      }
      const durationMs = Math.min(RECORDING_LIMIT_MS, recordedDurationMs);
      const mimeType = recordedBlob?.type.split(";", 1)[0] || "audio/webm";
      let attempt = sendAttemptRef.current;
      if (
        !attempt ||
        attempt.bodyText !== text ||
        attempt.recipientAgentId !== recipientAgentId ||
        attempt.voiceBlob !== recordedBlob ||
        attempt.durationMs !== durationMs ||
        attempt.mimeType !== mimeType
      ) {
        attempt = {
          bodyText: text,
          recipientAgentId,
          voiceBlob: recordedBlob,
          durationMs,
          mimeType,
          originalFileName: `agent-message-${new Date()
            .toISOString()
            .replaceAll(":", "-")}.${fileExtension(mimeType)}`,
          reservationKey: createAgentMessageOperationKey("voice-reserve"),
          messageKey: createAgentMessageOperationKey("message-send")
        };
        sendAttemptRef.current = attempt;
      }
      setStatusMessage(
        recordedBlob
          ? "Securing and uploading the voice Artifact…"
          : "Sending message…"
      );
      if (attempt.voiceBlob) {
        const reservation = await createVoiceReservation({
          idempotencyKey: attempt.reservationKey,
          originalFileName: attempt.originalFileName,
          declaredMimeType: attempt.mimeType,
          declaredDurationMs: attempt.durationMs
        });
        attempt.reservationId = reservation.reservation.id;
        attempt.contentBase64 ??= await blobToBase64(attempt.voiceBlob);
        await activateVoiceReservation(attempt.reservationId, {
          idempotencyKey: attempt.reservationKey,
          contentBase64: attempt.contentBase64,
          declaredMimeType: attempt.mimeType,
          declaredDurationMs: attempt.durationMs
        });
      }
      const result = await createAgentMessage({
        idempotencyKey: attempt.messageKey,
        recipientAgentId: attempt.recipientAgentId,
        bodyText: attempt.bodyText,
        voiceReservationId: attempt.reservationId
      });
      return { result, attempt };
    },
    onSuccess: ({ result, attempt }) => {
      if (sendAttemptRef.current === attempt) sendAttemptRef.current = null;
      setBodyText("");
      setRecordedBlob(null);
      setRecordedDurationMs(0);
      setAllowLargeTransfer(false);
      setStatusMessage("Delivered to the agent inbox.");
      onSent(result.message);
    },
    onError: (error) => {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Forge could not send this message."
      );
    }
  });

  const chooseAudioFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setRecordingError(
        "Choose an audio file in M4A, AAC, MP3, WAV, WebM, or Ogg format."
      );
      return;
    }
    if (file.size > VOICE_LIMIT_BYTES) {
      setRecordingError("This audio file exceeds the 25 MB limit.");
      return;
    }
    setRecordedBlob(file);
    setRecordedDurationMs(0);
    setRecordingError(null);
    setStatusMessage(
      "Audio file ready. Forge will verify its format and duration before delivery."
    );
  };

  return (
    <Card className="border-[color-mix(in_srgb,var(--primary)_24%,var(--ui-border-subtle))] bg-[linear-gradient(145deg,var(--ui-surface-1),color-mix(in_srgb,var(--primary)_7%,var(--ui-surface-1)))]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-lg text-[var(--ui-ink-strong)]">
            Talk to agent
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
            Send slow, asynchronous mail. The agent may respond later; this is
            not live chat.
          </p>
        </div>
        <MessageSquareText className="size-5 shrink-0 text-[var(--primary)]" />
      </div>

      <label className="mt-5 grid gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
        Recipient
        <select
          className="min-h-11 w-full rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
          value={recipientAgentId}
          onChange={(event) => setRecipientAgentId(event.target.value)}
        >
          <option value="">Choose an agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.label} — {agentPresence(agent)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 grid gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
        Message{" "}
        <span className="font-normal text-[var(--ui-ink-soft)]">
          (optional with voice)
        </span>
        <Textarea
          value={bodyText}
          onChange={(event) => setBodyText(event.target.value)}
          rows={5}
          maxLength={50_000}
          placeholder="What should the agent handle? Include the outcome and any important constraints."
        />
      </label>

      <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={recording ? "secondary" : "primary"}
            onClick={() =>
              recording ? stopRecording() : void startRecording()
            }
          >
            {recording ? (
              <MicOff className="size-4" />
            ) : (
              <Mic className="size-4" />
            )}
            {recording ? "Stop recording" : "Record voice"}
          </Button>
          <label className="interactive-tap inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] px-3 text-sm font-medium text-[var(--ui-ink-strong)] hover:bg-[var(--ui-surface-hover)]">
            <FileAudio className="size-4" />
            Choose audio
            <input
              className="sr-only"
              type="file"
              accept="audio/mp4,audio/aac,audio/mpeg,audio/wav,audio/webm,audio/ogg,.m4a,.aac,.mp3,.wav,.webm,.ogg"
              onChange={chooseAudioFile}
            />
          </label>
          {recording ? (
            <span
              role="status"
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--danger)]"
            >
              <span className="size-2 animate-pulse rounded-full bg-[var(--danger)]" />{" "}
              Recording · stops at 10:00
            </span>
          ) : null}
        </div>
        {recordedBlob ? (
          <div className="mt-3 grid gap-2">
            <audio className="w-full" controls src={recordedUrl ?? undefined}>
              Your browser cannot preview this voice note.
            </audio>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ui-ink-soft)]">
              <span>
                {formatBytes(recordedBlob.size)} ·{" "}
                {recordedDurationMs
                  ? formatDuration(recordedDurationMs)
                  : "duration verified on upload"}
              </span>
              <button
                type="button"
                className="font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                onClick={() => {
                  setRecordedBlob(null);
                  setRecordedDurationMs(0);
                }}
              >
                Remove voice note
              </button>
            </div>
          </div>
        ) : null}
        {recordingError ? (
          <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
            {recordingError}
          </p>
        ) : null}
      </div>

      {recordedBlob && recordedBlob.size > CELLULAR_CONFIRM_BYTES ? (
        <label className="mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-[var(--ui-warning-border)] bg-[var(--ui-warning-soft)] p-3 text-sm text-[var(--warning)]">
          <input
            className="mt-1"
            type="checkbox"
            checked={allowLargeTransfer}
            onChange={(event) => setAllowLargeTransfer(event.target.checked)}
          />
          <span>
            This voice note is over 5 MB. Upload it now even if this connection
            may be cellular or metered.
          </span>
        </label>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p
          aria-live="polite"
          className="min-w-0 flex-1 text-sm text-[var(--ui-ink-medium)]"
        >
          {statusMessage ||
            "Voice remains a sensitive first-class Artifact linked to this message."}
        </p>
        <Button
          type="button"
          size="lg"
          pending={sendMutation.isPending}
          pendingLabel="Sending…"
          disabled={
            recording ||
            (!bodyText.trim() && !recordedBlob) ||
            !recipientAgentId
          }
          onClick={() => sendMutation.mutate()}
        >
          <Send className="size-4" /> Send message
        </Button>
      </div>
    </Card>
  );
}

function MessageDetail({
  messageId,
  agents,
  onChanged
}: {
  messageId: string;
  agents: ConnectedAgent[];
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: [...MESSAGE_QUERY_KEY, "detail", messageId],
    queryFn: () => getAgentMessage(messageId),
    refetchInterval: 20_000
  });
  const [recipientId, setRecipientId] = useState("");
  const operationAttemptsRef = useRef(
    new Map<string, { payload: string; operationKey: string }>()
  );
  const stableOperationKey = (
    kind: string,
    payload: Record<string, unknown>
  ) => {
    const serialized = JSON.stringify(payload);
    const existing = operationAttemptsRef.current.get(kind);
    if (existing?.payload === serialized) return existing.operationKey;
    const operationKey = createAgentMessageOperationKey(`message-${kind}`);
    operationAttemptsRef.current.set(kind, {
      payload: serialized,
      operationKey
    });
    return operationKey;
  };
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: MESSAGE_QUERY_KEY });
    onChanged();
  };
  const readMutation = useMutation({
    mutationFn: (message: AgentMessage) =>
      markAgentMessageRead({
        messageId: message.id,
        operationKey: stableOperationKey("read", {
          messageId: message.id,
          expectedInboxEventSequence: message.unreadInboxEventSequence ?? 0
        }),
        expectedInboxEventSequence: message.unreadInboxEventSequence ?? 0
      }),
    onSuccess: async () => {
      operationAttemptsRef.current.delete("read");
      await refresh();
    }
  });
  const reassignMutation = useMutation({
    mutationFn: (message: AgentMessage) =>
      reassignAgentMessage({
        messageId: message.id,
        operationKey: stableOperationKey("reassign", {
          messageId: message.id,
          expectedRevision: message.revision,
          recipientAgentId: recipientId,
          revokeActiveLease: Boolean(message.claim)
        }),
        expectedRevision: message.revision,
        recipientAgentId: recipientId,
        revokeActiveLease: Boolean(message.claim),
        reason: message.claim
          ? "Owner explicitly reassigned this message and revoked its active lease."
          : "Owner explicitly reassigned this message."
      }),
    onSuccess: async () => {
      operationAttemptsRef.current.delete("reassign");
      await refresh();
    }
  });
  const retryMutation = useMutation({
    mutationFn: (message: AgentMessage) =>
      retryAgentMessage({
        messageId: message.id,
        operationKey: stableOperationKey("retry", {
          messageId: message.id,
          recipientAgentId: recipientId || null
        }),
        recipientAgentId: recipientId || undefined
      }),
    onSuccess: async (result) => {
      operationAttemptsRef.current.delete("retry");
      await refresh();
      navigate(`/messages/${encodeURIComponent(result.resultingMessageId)}`);
    }
  });
  const deleteMutation = useMutation({
    mutationFn: (message: AgentMessage) =>
      deleteAgentMessage(
        message.id,
        "Deleted by the owner from Agent Messages."
      ),
    onSuccess: async () => {
      await refresh();
      navigate("/messages");
    }
  });

  if (detail.isLoading) return <LoadingState title="Loading message" />;
  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        error={detail.error ?? new Error("Forge could not load this message.")}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const message = detail.data.message;
  return (
    <div className="grid gap-4">
      <Link
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[var(--primary)]"
        to="/messages"
      >
        <ArrowLeft className="size-4" /> Back to messages
      </Link>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-soft)]">
              To {message.recipient.label}
            </p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)]">
              {message.bodyText ? "Agent Message" : "Voice message"}
            </h2>
          </div>
          <MessageStatus status={message.status} />
        </div>
        {message.bodyText ? (
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[var(--ui-ink-strong)]">
            {message.bodyText}
          </p>
        ) : null}
        {message.voiceArtifact ? (
          <div className="mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
            <FileAudio className="mt-0.5 size-5 text-[var(--primary)]" />
            <div>
              <p className="font-medium text-[var(--ui-ink-strong)]">
                Original voice Artifact preserved
              </p>
              <p className="mt-1 text-sm text-[var(--ui-ink-medium)]">
                {formatDuration(message.voiceArtifact.verifiedDurationMs)} ·{" "}
                {formatBytes(message.voiceArtifact.byteSize)} · sensitive media
              </p>
              <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                Audio is available only to the currently leased, authorized
                recipient agent. It is not silently sent for transcription.
              </p>
            </div>
          </div>
        ) : null}
        {message.progressSummary ? (
          <div className="mt-5 rounded-[var(--radius-control)] bg-[var(--ui-accent-soft)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--primary)]">
              Latest progress
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-ink-strong)]">
              {message.progressSummary}
            </p>
          </div>
        ) : null}
        {message.resultMarkdown ? (
          <div className="mt-5 border-t border-[var(--ui-border-subtle)] pt-5">
            <p className="font-display text-lg text-[var(--ui-ink-strong)]">
              Agent result
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--ui-ink-strong)]">
              {message.resultMarkdown}
            </p>
          </div>
        ) : null}
        {message.transcript ? (
          <details className="mt-5 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Transcript and provider disclosure
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
              {message.transcript.text}
            </p>
            <p className="mt-2 text-xs text-[var(--ui-ink-soft)]">
              {message.transcript.provider}: {message.transcript.disclosure}
            </p>
          </details>
        ) : null}
        {message.failure ? (
          <div
            role="alert"
            className="mt-5 flex gap-3 rounded-[var(--radius-control)] border border-[var(--ui-danger-border)] bg-[var(--ui-danger-soft)] p-4 text-[var(--danger)]"
          >
            <CircleAlert className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">{message.failure.code}</p>
              <p className="mt-1 text-sm">{message.failure.message}</p>
            </div>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2 text-xs text-[var(--ui-ink-soft)]">
          <span>Delivered {formatDateTime(message.deliveredAt)}</span>
          <span>·</span>
          <span>Retained until {formatDateTime(message.retentionUntil)}</span>
        </div>
      </Card>

      {detail.data.relatedMessages.length > 1 ? (
        <Card>
          <h3 className="font-display text-lg text-[var(--ui-ink-strong)]">
            Message thread
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
            The immutable forwarding and retry chain for this request.
          </p>
          <ol className="mt-4 grid gap-2">
            {detail.data.relatedMessages.map((related) => {
              const relation = related.forwardedFromMessageId
                ? "Forwarded"
                : related.retriedFromMessageId
                  ? "Retried"
                  : "Started";
              return (
                <li key={related.id}>
                  <Link
                    aria-current={
                      related.id === message.id ? "page" : undefined
                    }
                    className={cn(
                      "interactive-tap flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                      related.id === message.id
                        ? "border-[var(--primary)] bg-[var(--ui-accent-soft)]"
                        : "border-[var(--ui-border-subtle)] hover:bg-[var(--ui-surface-hover)]"
                    )}
                    to={`/messages/${encodeURIComponent(related.id)}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-ink-soft)]">
                        {relation} · {related.sender.label} to{" "}
                        {related.recipient.label}
                      </span>
                      <span className="mt-1 block truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                        {related.bodyText || "Voice message"}
                      </span>
                    </span>
                    <MessageStatus status={related.status} />
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      <Card>
        <h3 className="font-display text-lg text-[var(--ui-ink-strong)]">
          Delivery controls
        </h3>
        <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
          Reassignment is explicit. If another agent holds a lease, Forge
          atomically revokes it before changing the recipient.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="grid min-w-0 flex-1 gap-2 text-sm font-medium">
            Agent
            <select
              className="min-h-11 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3"
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
            >
              <option value="">Choose an agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            disabled={!recipientId || recipientId === message.recipient.agentId}
            pending={reassignMutation.isPending}
            onClick={() => reassignMutation.mutate(message)}
          >
            <Forward className="size-4" /> Reassign
          </Button>
          {message.status === "failed" ? (
            <Button
              variant="secondary"
              pending={retryMutation.isPending}
              onClick={() => retryMutation.mutate(message)}
            >
              <RotateCcw className="size-4" /> Retry as new message
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--ui-border-subtle)] pt-4">
          {message.unreadInboxEventSequence ? (
            <Button
              variant="secondary"
              pending={readMutation.isPending}
              onClick={() => readMutation.mutate(message)}
            >
              <MailCheck className="size-4" /> Mark agent activity read
            </Button>
          ) : null}
          <Button
            variant="ghost"
            pending={deleteMutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Delete this message from the active inbox and revoke any lease? Its audit record follows Forge retention policy."
                )
              )
                deleteMutation.mutate(message);
            }}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-display text-lg text-[var(--ui-ink-strong)]">
          Audit history
        </h3>
        <ol className="mt-4 grid gap-3">
          {detail.data.events.map((event) => (
            <li
              key={event.id}
              className="flex gap-3 border-l-2 border-[var(--ui-border-subtle)] pl-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium capitalize text-[var(--ui-ink-strong)]">
                  {event.event_kind.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                  {event.actor_label} · {formatDateTime(event.occurred_at)}
                </p>
              </div>
              {event.next_status ? (
                <MessageStatus status={event.next_status} />
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

export function AgentMessagesPage() {
  const { messageId } = useParams<{ messageId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const box = searchParams.get("box") === "inbox" ? "inbox" : "outbox";
  const requestedStatus = searchParams.get("status");
  const status =
    requestedStatus && requestedStatus in STATUS_COPY
      ? (requestedStatus as AgentMessageStatus)
      : undefined;
  const cursor = searchParams.get("cursor") || undefined;
  const autoRecord = searchParams.get("compose") === "voice";
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const agents = useQuery({
    queryKey: [...MESSAGE_QUERY_KEY, "agents"],
    queryFn: listConnectedMessageAgents
  });
  const settings = useQuery({
    queryKey: [...MESSAGE_QUERY_KEY, "settings"],
    queryFn: getAgentMessageSettings
  });
  const messages = useQuery({
    queryKey: [
      ...MESSAGE_QUERY_KEY,
      "list",
      box,
      status ?? "all",
      cursor ?? "first"
    ],
    queryFn: () => listAgentMessages({ box, status, cursor, limit: 20 }),
    placeholderData: (previous) => previous,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 30_000 : false
  });
  const defaultMutation = useMutation({
    mutationFn: updateDefaultMessageAgent,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: MESSAGE_QUERY_KEY })
  });
  const [notificationsStatus, setNotificationsStatus] = useState(
    typeof Notification === "undefined"
      ? "unavailable"
      : Notification.permission
  );
  const lastNotifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (notificationsStatus !== "granted" || box !== "inbox") return;
    for (const message of messages.data?.items ?? []) {
      if (!lastNotifiedRef.current.has(message.id)) {
        lastNotifiedRef.current.add(message.id);
        const notification = agentMessageNotification(
          message.recipient.label,
          message.status
        );
        new Notification(notification.title, notification.options);
      }
    }
  }, [box, messages.data?.items, notificationsStatus]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: MESSAGE_QUERY_KEY });
  const connectedAgents = agents.data?.agents ?? [];
  const defaultAgentId =
    settings.data?.defaultAgent?.id ?? connectedAgents[0]?.id ?? "";
  const selectMailbox = (nextBox: "inbox" | "outbox") => {
    const next = new URLSearchParams(searchParams);
    next.set("box", nextBox);
    next.delete("cursor");
    setCursorHistory([]);
    setSearchParams(next);
  };
  const selectStatus = (nextStatus?: AgentMessageStatus) => {
    const next = new URLSearchParams(searchParams);
    if (nextStatus) next.set("status", nextStatus);
    else next.delete("status");
    next.delete("cursor");
    setCursorHistory([]);
    setSearchParams(next);
  };

  if (agents.isLoading || settings.isLoading || messages.isLoading) {
    return <LoadingState title="Opening Agent Messages" />;
  }
  if (agents.isError || settings.isError || messages.isError) {
    return (
      <ErrorState
        error={
          agents.error ??
          settings.error ??
          messages.error ??
          new Error("Forge could not load the message mailbox.")
        }
        onRetry={() => {
          void agents.refetch();
          void settings.refetch();
          void messages.refetch();
        }}
      />
    );
  }

  return (
    <div className="grid gap-5 pb-24 lg:pb-8">
      <PageHero
        eyebrow="Asynchronous agent mail"
        title={<h1>Agent Messages</h1>}
        titleText="Agent Messages"
        description="Send text, a first-class voice Artifact, or both. Agents claim work with leases and leave a durable result and audit history."
        actions={
          <Button
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("compose", "voice");
              setSearchParams(next);
            }}
          >
            <Mic className="size-4" /> Talk to agent
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        <div className="grid content-start gap-4">
          {messageId ? (
            <MessageDetail
              messageId={messageId}
              agents={connectedAgents}
              onChanged={invalidate}
            />
          ) : (
            <>
              <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div
                  className="flex flex-wrap gap-2"
                  role="tablist"
                  aria-label="Message boxes"
                >
                  <Button
                    variant={box === "outbox" ? "primary" : "secondary"}
                    role="tab"
                    aria-selected={box === "outbox"}
                    onClick={() => {
                      selectMailbox("outbox");
                    }}
                  >
                    <Send className="size-4" /> Outbox
                  </Button>
                  <Button
                    variant={box === "inbox" ? "primary" : "secondary"}
                    role="tab"
                    aria-selected={box === "inbox"}
                    onClick={() => {
                      selectMailbox("inbox");
                    }}
                  >
                    <Inbox className="size-4" /> Inbox{" "}
                    {messages.data?.unreadThreadCount
                      ? `(${messages.data.unreadThreadCount})`
                      : ""}
                  </Button>
                </div>
                <Button variant="ghost" onClick={() => void messages.refetch()}>
                  <RefreshCw className="size-4" /> Refresh
                </Button>
              </Card>
              <Card>
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Filter messages by status"
                >
                  <Button
                    size="sm"
                    variant={!status ? "primary" : "secondary"}
                    aria-pressed={!status}
                    onClick={() => selectStatus()}
                  >
                    All statuses
                  </Button>
                  {(Object.keys(STATUS_COPY) as AgentMessageStatus[]).map(
                    (candidate) => (
                      <Button
                        key={candidate}
                        size="sm"
                        variant={status === candidate ? "primary" : "secondary"}
                        aria-pressed={status === candidate}
                        onClick={() => selectStatus(candidate)}
                      >
                        {STATUS_COPY[candidate].label}
                      </Button>
                    )
                  )}
                </div>
              </Card>
              {messages.data?.items.length ? (
                <>
                  <div className="grid gap-3">
                    {messages.data.items.map((message) => (
                      <MessageRow key={message.id} message={message} />
                    ))}
                  </div>
                  <nav
                    className="flex items-center justify-between gap-3"
                    aria-label="Agent Messages pages"
                  >
                    <Button
                      variant="secondary"
                      disabled={cursorHistory.length === 0}
                      onClick={() => {
                        const previous = cursorHistory.at(-1) ?? "";
                        setCursorHistory((history) => history.slice(0, -1));
                        const next = new URLSearchParams(searchParams);
                        if (previous) next.set("cursor", previous);
                        else next.delete("cursor");
                        setSearchParams(next);
                      }}
                    >
                      Newer messages
                    </Button>
                    <span
                      aria-live="polite"
                      className="text-sm text-[var(--ui-ink-soft)]"
                    >
                      Page {cursorHistory.length + 1}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={!messages.data.nextCursor}
                      onClick={() => {
                        if (!messages.data?.nextCursor) return;
                        setCursorHistory((history) => [
                          ...history,
                          cursor ?? ""
                        ]);
                        const next = new URLSearchParams(searchParams);
                        next.set("cursor", messages.data.nextCursor);
                        setSearchParams(next);
                      }}
                    >
                      Older messages
                    </Button>
                  </nav>
                </>
              ) : (
                <EmptyState
                  title={
                    box === "inbox"
                      ? "No unread agent activity"
                      : "No messages sent yet"
                  }
                  description={
                    box === "inbox"
                      ? "Progress, acknowledgements, results, failures, and forwards appear here until you mark them read."
                      : "Use Talk to agent to record immediately, or write a message in the composer."
                  }
                />
              )}
            </>
          )}
        </div>

        <aside className="grid content-start gap-4">
          <AgentMessageComposer
            agents={connectedAgents}
            defaultAgentId={defaultAgentId}
            autoRecord={autoRecord}
            onSent={(message) => {
              const next = new URLSearchParams(searchParams);
              next.delete("compose");
              setSearchParams(next, { replace: true });
              invalidate();
              navigate(`/messages/${encodeURIComponent(message.id)}`);
            }}
          />
          <Card>
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-[var(--primary)]" />
              <h2 className="font-display text-lg">Mailbox settings</h2>
            </div>
            <label className="mt-4 grid gap-2 text-sm font-medium">
              Default agent
              <select
                className="min-h-11 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3"
                value={defaultAgentId}
                disabled={
                  defaultMutation.isPending || connectedAgents.length === 0
                }
                onChange={(event) => defaultMutation.mutate(event.target.value)}
              >
                <option value="">No default selected</option>
                {connectedAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 grid gap-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
              <p className="flex items-start gap-2">
                <Clock3 className="mt-1 size-4 shrink-0" /> Messages are
                retained for {settings.data?.retentionDays ?? 365} days unless
                deleted earlier.
              </p>
              <p className="flex items-start gap-2">
                <WifiOff className="mt-1 size-4 shrink-0" /> The iOS app
                encrypts queued sends on-device and retries when the system
                grants foreground or background execution. The browser does not
                promise durable offline uploads.
              </p>
              <p className="flex items-start gap-2">
                <Bot className="mt-1 size-4 shrink-0" /> Direct Codex audio
                understanding is runtime-dependent and uses the connected
                runtime’s normal allowance. Forge does not promise free
                transcription.
              </p>
            </div>
            {typeof Notification !== "undefined" ? (
              <Button
                className="mt-4"
                variant="secondary"
                disabled={notificationsStatus === "granted"}
                onClick={async () => {
                  const permission = await Notification.requestPermission();
                  setNotificationsStatus(permission);
                }}
              >
                <MailCheck className="size-4" />{" "}
                {notificationsStatus === "granted"
                  ? "Browser notifications enabled"
                  : "Enable browser notifications"}
              </Button>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}
