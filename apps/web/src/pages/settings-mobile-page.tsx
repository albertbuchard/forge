import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  Cable,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Clipboard,
  Link2,
  LockKeyhole,
  QrCode,
  RefreshCcw,
  ScanLine,
  ShieldOff,
  UploadCloud
} from "lucide-react";
import { Link } from "react-router-dom";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import {
  SettingsSectionNav,
  SettingsStateFrame
} from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import { Badge } from "@/components/ui/badge";
import { useForgeShell } from "@/components/shell/app-shell";
import {
  createCompanionPairingSession,
  getCompanionOverview,
  patchCompanionPairingSourceState,
  revokeAllCompanionPairingSessions,
  revokeCompanionPairingSession
} from "@/lib/api";
import type {
  CompanionPairingSession,
  CompanionPairingQrPayload,
  CompanionPairingTransportMode
} from "@/lib/types";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

function formatCapabilityLabel(capability: string) {
  return capability.replaceAll(".", " ");
}

function formatSyncSummary(payloadSummary: Record<string, unknown>) {
  const sleepNights =
    typeof payloadSummary.sleepNights === "number"
      ? payloadSummary.sleepNights
      : typeof payloadSummary.sleepSessions === "number"
        ? payloadSummary.sleepSessions
        : 0;
  const sleepSegments =
    typeof payloadSummary.sleepSegments === "number"
      ? payloadSummary.sleepSegments
      : 0;
  const sleepRawRecords =
    typeof payloadSummary.sleepRawRecords === "number"
      ? payloadSummary.sleepRawRecords
      : 0;
  const sleepSessions =
    typeof payloadSummary.sleepSessions === "number"
      ? payloadSummary.sleepSessions
      : 0;
  const workouts =
    typeof payloadSummary.workouts === "number" ? payloadSummary.workouts : 0;
  const vitals =
    payloadSummary.vitals &&
    typeof payloadSummary.vitals === "object" &&
    !Array.isArray(payloadSummary.vitals) &&
    typeof (payloadSummary.vitals as Record<string, unknown>).metricEntries ===
      "number"
      ? ((payloadSummary.vitals as Record<string, unknown>)
          .metricEntries as number)
      : 0;
  return `${sleepNights || sleepSessions} nights · ${sleepSegments} segments · ${sleepRawRecords} raw records · ${workouts} workouts · ${vitals} vitals`;
}

function permissionTone(enabled: boolean) {
  return enabled ? "signal" : "meta";
}

function formatSourceAuthorization(status: string) {
  return status.replaceAll("_", " ");
}

function formatSourceObservedAt(value: string | null) {
  if (!value) {
    return "Waiting for device update";
  }
  return new Date(value).toLocaleString();
}

function sourceTone(enabled: boolean, syncEligible: boolean) {
  if (!enabled) {
    return "meta";
  }
  return syncEligible ? "signal" : "default";
}

function formatTransportLabel(payload: CompanionPairingQrPayload) {
  if (payload.transportMode === "iroh") {
    return "Iroh";
  }
  return "Manual HTTP";
}

function transportTone(payload: CompanionPairingQrPayload) {
  return payload.transportMode === "iroh" &&
    payload.transport?.status === "ready"
    ? "signal"
    : "meta";
}

function pairingRecoverySummary(pairings: CompanionPairingSession[]) {
  const issue = pairings.find((pairing) =>
    ["error", "stale", "permission_denied"].includes(pairing.status)
  );
  if (issue) {
    return {
      pairing: issue,
      title:
        issue.status === "permission_denied"
          ? "Phone permissions need attention"
          : issue.status === "stale"
            ? "Companion connection is stale"
            : "Companion connection failed",
      detail:
        issue.lastSyncError ??
        "Refresh once after checking the iPhone. Generate a replacement pairing only if the existing connection cannot recover."
    };
  }

  const expiredPending = pairings.find(
    (pairing) =>
      pairing.status === "pending" &&
      Number.isFinite(Date.parse(pairing.expiresAt)) &&
      Date.parse(pairing.expiresAt) <= Date.now()
  );
  if (expiredPending) {
    return {
      pairing: expiredPending,
      title: "Pairing code expired",
      detail:
        "The raw one-time token cannot be recovered. Generate a replacement QR and scan that new code instead."
    };
  }

  return null;
}

const mobileEyebrowClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const mobileBodyClass = "text-[var(--ui-ink-soft)]";
const mobileFaintClass = "text-[var(--ui-ink-faint)]";
const mobilePanelClass =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const mobileInsetPanelClass =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]";
const mobileDashedPanelClass =
  "rounded-[24px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const mobileActionLinkClass =
  "inline-flex min-h-11 items-center gap-2 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]";

export function SettingsMobilePage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPanelOpen, setQrPanelOpen] = useState(false);
  const [payloadPanelOpen, setPayloadPanelOpen] = useState(false);
  const [payloadCopied, setPayloadCopied] = useState(false);
  const [latestPairing, setLatestPairing] = useState<{
    qrPayload: CompanionPairingQrPayload;
  } | null>(null);
  const [pairingFeedback, setPairingFeedback] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["forge-companion-overview", ...selectedUserIds],
    queryFn: async () => (await getCompanionOverview(selectedUserIds)).overview
  });

  const pairingMutation = useMutation({
    mutationFn: async (transportMode: CompanionPairingTransportMode = "iroh") =>
      createCompanionPairingSession({
        userId: defaultUserId ?? null,
        transportMode
      }),
    onSuccess: async (result) => {
      setLatestPairing({ qrPayload: result.qrPayload });
      setPairingFeedback(
        "New pairing code created. Its source settings and any matching pending-code revocations were saved together."
      );
      setQrPanelOpen(true);
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
    },
    onError: async (error) => {
      const detail =
        error instanceof Error
          ? error.message
          : "Forge could not generate a replacement pairing.";
      setPairingFeedback(
        `${detail} Forge could not confirm the new code. Generate a fresh code before scanning. A rejected save keeps the existing pairing; a lost response may already have revoked its code.`
      );
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
    }
  });

  const revokeMutation = useMutation({
    mutationFn: async (pairingSessionId: string) =>
      revokeCompanionPairingSession(pairingSessionId),
    onSuccess: async () => {
      setPairingFeedback("Pairing revoked.");
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
    },
    onError: (error) => {
      setPairingFeedback(
        error instanceof Error
          ? error.message
          : "Could not revoke this pairing."
      );
    }
  });

  const revokeAllMutation = useMutation({
    mutationFn: async () =>
      revokeAllCompanionPairingSessions({
        userIds: selectedUserIds,
        includeRevoked: false
      }),
    onSuccess: async () => {
      setPairingFeedback(
        "All active pairings in the selected user scope were revoked."
      );
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
    },
    onError: (error) => {
      setPairingFeedback(
        error instanceof Error
          ? error.message
          : "Could not revoke all pairings."
      );
    }
  });

  const sourceToggleMutation = useMutation({
    mutationFn: async (input: {
      pairingSessionId: string;
      source: "health" | "movement" | "screenTime";
      desiredEnabled: boolean;
    }) =>
      patchCompanionPairingSourceState(
        input.pairingSessionId,
        input.source,
        input.desiredEnabled
      ),
    onSuccess: async () => {
      setPairingFeedback(
        "Sync preference saved. The phone must apply it before the source becomes eligible."
      );
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
    },
    onError: (error) => {
      setPairingFeedback(
        error instanceof Error
          ? error.message
          : "Could not update the device sync preference."
      );
    }
  });

  useEffect(() => {
    if (!latestPairing) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(JSON.stringify(latestPairing.qrPayload), {
      width: 320,
      margin: 1
    }).then(setQrDataUrl);
  }, [latestPairing]);

  useEffect(() => {
    setPayloadPanelOpen(false);
    setPayloadCopied(false);
  }, [latestPairing]);

  if (overviewQuery.isLoading) {
    return (
      <SettingsStateFrame>
        <SurfaceSkeleton
          eyebrow="Companion"
          title="Loading mobile companion"
          description="Checking pairing state and recent sync status."
          columns={2}
          blocks={5}
        />
      </SettingsStateFrame>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Companion"
          error={
            overviewQuery.error ?? new Error("Companion overview unavailable")
          }
          onRetry={() => void overviewQuery.refetch()}
        />
      </SettingsStateFrame>
    );
  }

  const overview = overviewQuery.data;
  const activePairings = overview.pairings.filter(
    (pairing) => pairing.status !== "revoked"
  );
  const revokedPairingsCount = overview.pairings.length - activePairings.length;
  const recovery = pairingRecoverySummary(activePairings);
  const pairingPayloadText = latestPairing
    ? JSON.stringify(latestPairing.qrPayload, null, 2)
    : "";

  const handleQrAction = () => {
    if (latestPairing && qrPanelOpen) {
      setQrPanelOpen(false);
      return;
    }
    if (latestPairing && !qrPanelOpen) {
      setQrPanelOpen(true);
      return;
    }
    pairingMutation.mutate("iroh");
  };

  const handleManualHttpPairing = () => {
    pairingMutation.mutate("manual-http");
  };

  const handleCopyPairingPayload = async () => {
    if (!pairingPayloadText) {
      return;
    }
    if (!navigator.clipboard) {
      setPayloadPanelOpen(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(pairingPayloadText);
      setPayloadCopied(true);
      window.setTimeout(() => setPayloadCopied(false), 1800);
    } catch {
      setPayloadPanelOpen(true);
    }
  };

  return (
    <div className="mx-auto grid min-w-0 w-full max-w-[1220px] gap-5 pb-24 lg:pb-0">
      <PageHero
        title="Mobile companion"
        description="Pair the native iPhone companion once, then sync Apple Health, watch, and location signals securely."
        badge={overview.healthState.replaceAll("_", " ")}
      />

      <SettingsSectionNav />

      {pairingFeedback ? (
        <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]">
          {pairingFeedback}
        </div>
      ) : null}

      {recovery ? (
        <Card className="grid gap-3 border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <div className={mobileEyebrowClass}>Pairing recovery</div>
            <div className="mt-1 font-medium text-[var(--ui-ink-strong)]">
              {recovery.title}
            </div>
            <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {recovery.detail}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => void overviewQuery.refetch()}
            >
              <RefreshCcw className="size-4" />
              Refresh status
            </Button>
            <Button
              pending={pairingMutation.isPending}
              pendingLabel="Generating"
              onClick={() => pairingMutation.mutate("iroh")}
            >
              <QrCode className="size-4" />
              Generate replacement QR
            </Button>
          </div>
        </Card>
      ) : null}

      <section className="grid min-w-0 gap-4">
        {import.meta.env.DEV ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
            <div className="grid gap-1">
              <div className={mobileEyebrowClass}>QA lab</div>
              <div className={`text-sm ${mobileBodyClass}`}>
                Open deterministic source-state and movement-gap fixtures
                without a real phone.
              </div>
            </div>
            <Link
              to="/settings/mobile/lab"
              className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-sm font-medium text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)]"
            >
              Open Companion Sync Lab
            </Link>
          </Card>
        ) : null}

        <Card className="grid min-w-0 gap-4 overflow-hidden">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className={mobileEyebrowClass}>Pair iPhone</div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                Pair a new iPhone
              </div>
              <div
                className={`mt-2 max-w-3xl text-sm leading-6 ${mobileBodyClass}`}
              >
                Open Forge Companion and tap Pair this iPhone when it discovers
                this Forge. A notification will appear here so you can enter the
                phone’s short code once. If discovery is unavailable, create a
                one-time QR below.
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                className="w-full sm:w-auto"
                onClick={handleQrAction}
                pending={
                  pairingMutation.isPending &&
                  pairingMutation.variables !== "manual-http"
                }
                pendingLabel="Generating"
              >
                <QrCode className="size-4" />
                {latestPairing
                  ? qrPanelOpen
                    ? "Hide QR"
                    : "Show QR"
                  : "Pair a new iPhone"}
                {latestPairing ? (
                  qrPanelOpen ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )
                ) : null}
              </Button>
            </div>
          </div>

          <div className={`grid gap-3 ${mobileInsetPanelClass} p-4`}>
            <div className="flex gap-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
              <ScanLine
                className={`mt-1 size-4 shrink-0 ${mobileFaintClass}`}
              />
              <span>
                <strong className="text-[var(--ui-ink-strong)]">
                  Preferred:
                </strong>{" "}
                open Forge Companion, choose Pair this iPhone, and select the
                discovered Forge.
              </span>
            </div>
            <div className="flex gap-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
              <Check className={`mt-1 size-4 shrink-0 ${mobileFaintClass}`} />
              <span>
                Click the pairing notification in any unlocked local-owner Forge
                screen, enter the matching code once, and approve.{" "}
                <Link
                  to="/settings/agents#pending-pairings"
                  className="font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                >
                  Open pending requests
                </Link>
                .
              </span>
            </div>
          </div>

          {qrPanelOpen ? (
            <div className="grid min-w-0 gap-4 overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 sm:p-5">
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
                {qrDataUrl ? (
                  <div className="grid justify-items-center gap-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-6 py-6 text-[var(--ui-ink-strong)]">
                    <img
                      src={qrDataUrl}
                      alt="Forge Companion pairing QR code"
                      className="w-full max-w-[320px]"
                    />
                    <div
                      className={`max-w-[320px] text-center text-sm ${mobileBodyClass}`}
                    >
                      Scan this code from Forge Companion on iPhone.
                    </div>
                  </div>
                ) : (
                  <div
                    className={`${mobileDashedPanelClass} px-5 py-8 text-center text-sm ${mobileBodyClass}`}
                  >
                    Generating the QR code now.
                  </div>
                )}

                <div className="grid content-start gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {latestPairing ? (
                      <Badge tone={transportTone(latestPairing.qrPayload)}>
                        <Cloud className="size-3" />
                        {formatTransportLabel(latestPairing.qrPayload)}
                      </Badge>
                    ) : null}
                    {latestPairing?.qrPayload.transport ? (
                      <Badge
                        tone={
                          latestPairing.qrPayload.transport.status === "ready"
                            ? "signal"
                            : "meta"
                        }
                      >
                        Transport {latestPairing.qrPayload.transport.status}
                      </Badge>
                    ) : null}
                    <Badge tone="meta">
                      <LockKeyhole className="size-3" />
                      One-time token
                    </Badge>
                  </div>

                  <div
                    className={`grid gap-3 text-sm leading-6 ${mobileBodyClass}`}
                  >
                    {latestPairing?.qrPayload.transport &&
                    latestPairing.qrPayload.transport.status !== "ready" ? (
                      <div className="rounded-[16px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-3 py-2 text-[var(--danger)]">
                        {latestPairing.qrPayload.transport.lastError ??
                          "The Iroh transport is not ready. Do not rely on this QR until a replacement reports ready."}
                        {latestPairing.qrPayload.transport.recreateCommand ? (
                          <div className="mt-2 break-all font-mono text-xs">
                            {latestPairing.qrPayload.transport.recreateCommand}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex gap-3">
                      <ScanLine
                        className={`mt-1 size-4 shrink-0 ${mobileFaintClass}`}
                      />
                      <span>
                        Open Forge Companion and choose Scan Forge QR.
                      </span>
                    </div>
                    <div className="flex gap-3">
                      <LockKeyhole
                        className={`mt-1 size-4 shrink-0 ${mobileFaintClass}`}
                      />
                      <span>
                        The iPhone receives the desktop node, relay hint, and
                        pairing token for the Forge Iroh route.
                      </span>
                    </div>
                    <div className="flex gap-3">
                      <Check
                        className={`mt-1 size-4 shrink-0 ${mobileFaintClass}`}
                      />
                      <span>
                        After verification, the app moves straight into native
                        permissions and first sync.
                      </span>
                    </div>
                  </div>

                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 ${mobileInsetPanelClass} p-4`}
                  >
                    <div className={`text-sm ${mobileBodyClass}`}>
                      {latestPairing ? (
                        <span>
                          Expires{" "}
                          {new Date(
                            latestPairing.qrPayload.expiresAt
                          ).toLocaleString()}
                          .
                        </span>
                      ) : (
                        "Generate the one-time QR and scan it from the iPhone app."
                      )}
                    </div>
                    {latestPairing ? (
                      <Button
                        variant="secondary"
                        pending={pairingMutation.isPending}
                        pendingLabel="Generating"
                        onClick={() => pairingMutation.mutate("iroh")}
                      >
                        <RefreshCcw className="size-4" />
                        Regenerate QR
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {latestPairing ? (
                <div
                  className={`grid gap-3 ${mobileInsetPanelClass} p-4 text-sm ${mobileBodyClass}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="max-w-2xl">
                      <div className="text-[var(--ui-ink-strong)]">
                        Manual pairing payload
                      </div>
                      <div
                        className={`mt-1 text-xs leading-5 ${mobileFaintClass}`}
                      >
                        Paste this into the iPhone app only when its camera
                        cannot scan the QR. It contains the same one-time
                        credential and transport details, so it works only
                        before the displayed expiry and while that transport is
                        ready.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => void handleCopyPairingPayload()}
                      >
                        {payloadCopied ? (
                          <Check className="size-4" />
                        ) : (
                          <Clipboard className="size-4" />
                        )}
                        {payloadCopied ? "Copied" : "Copy payload"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setPayloadPanelOpen((open) => !open)}
                      >
                        {payloadPanelOpen ? "Hide payload" : "Show payload"}
                        {payloadPanelOpen ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  {payloadPanelOpen ? (
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--ui-code-text)]">
                      {pairingPayloadText}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={`${mobileDashedPanelClass} px-5 py-6 text-sm leading-6 ${mobileBodyClass}`}
            >
              Generate a one-time Forge QR when the iPhone is in your hand. The
              code expires automatically and can be regenerated anytime.
            </div>
          )}

          <details className={`${mobileInsetPanelClass} p-4`}>
            <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink-strong)]">
              Advanced network fallback
            </summary>
            <div
              className={`mt-3 grid gap-3 text-sm leading-6 ${mobileBodyClass}`}
            >
              <p>
                Use manual HTTP only for a deliberate LAN, Tailscale, or direct
                TCP route when discovery and the verified QR transport are not
                available.
              </p>
              <Button
                variant="secondary"
                className="w-full sm:w-fit"
                onClick={handleManualHttpPairing}
                pending={
                  pairingMutation.isPending &&
                  pairingMutation.variables === "manual-http"
                }
                pendingLabel="Generating"
              >
                <Cable className="size-4" />
                Create manual HTTP pairing
              </Button>
            </div>
          </details>
        </Card>

        <Card className="grid min-w-0 gap-4 overflow-hidden">
          <div className={mobileEyebrowClass}>Companion state</div>
          <div className="grid min-w-0 max-w-full gap-3 md:grid-cols-3">
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>Pairings</div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {activePairings.length}
              </div>
              {revokedPairingsCount > 0 ? (
                <div className={`mt-2 text-xs ${mobileFaintClass}`}>
                  {revokedPairingsCount} revoked hidden
                </div>
              ) : null}
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>Sleep sessions</div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.sleepSessions}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>
                Raw sleep records
              </div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.sleepRawRecords}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>Workouts</div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.workouts}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>Vitals days</div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.vitalsDaySummaries ?? 0}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>Vital entries</div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.vitalsMetricEntries ?? 0}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>
                Reflected sleep
              </div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.reflectiveSleepSessions}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>
                Linked workouts
              </div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.linkedWorkouts}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>
                Habit-generated
              </div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.habitGeneratedWorkouts}
              </div>
            </div>
            <div className={`${mobilePanelClass} p-4`}>
              <div className={`text-sm ${mobileBodyClass}`}>Reconciled</div>
              <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                {overview.counts.reconciledWorkouts}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge>{overview.healthState.replaceAll("_", " ")}</Badge>
            {overview.lastSyncAt ? (
              <Badge tone="meta">
                Last sync {new Date(overview.lastSyncAt).toLocaleString()}
              </Badge>
            ) : null}
            <Badge
              tone={permissionTone(overview.permissions.healthKitAuthorized)}
            >
              HealthKit{" "}
              {overview.permissions.healthKitAuthorized ? "ready" : "needed"}
            </Badge>
            <Badge
              tone={permissionTone(
                overview.permissions.backgroundRefreshEnabled
              )}
            >
              Background refresh{" "}
              {overview.permissions.backgroundRefreshEnabled
                ? "ready"
                : "not yet"}
            </Badge>
            <Badge tone="meta">
              Location {overview.permissions.locationReady ? "ready" : "later"}
            </Badge>
            <Badge tone="meta">
              Motion {overview.permissions.motionReady ? "ready" : "later"}
            </Badge>
          </div>

          <div className={`grid gap-3 ${mobileInsetPanelClass} p-4`}>
            <div className={mobileEyebrowClass}>Pairing path</div>
            <div className={`grid gap-2 text-sm ${mobileBodyClass}`}>
              <div>
                1. Open Forge Companion and tap Pair this iPhone on the
                discovered Forge.
              </div>
              <div>
                2. Open the Forge pairing notification and enter the displayed
                short code once.
              </div>
              <div>
                3. Approve Health access on iPhone, then run the first sync.
              </div>
              <div>
                4. If discovery fails, use the one-time QR or the advanced
                network fallback above.
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-3">
            {activePairings.length > 0 ? (
              <div className="flex min-w-0 max-w-full justify-end overflow-hidden">
                <Button
                  variant="secondary"
                  pending={revokeAllMutation.isPending}
                  pendingLabel="Revoking all"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke ${activePairings.length} active pairing${activePairings.length === 1 ? "" : "s"}? Each iPhone or watch bridge must pair again.`
                      )
                    ) {
                      revokeAllMutation.mutate();
                    }
                  }}
                >
                  <ShieldOff className="size-4" />
                  Revoke all
                </Button>
              </div>
            ) : null}
            {activePairings.map((pairing) => (
              <div
                key={pairing.id}
                className={`grid min-w-0 max-w-full gap-3 overflow-hidden ${mobilePanelClass} px-4 py-4`}
              >
                <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base text-[var(--ui-ink-strong)]">
                      {pairing.deviceName ?? pairing.label}
                    </div>
                    <div className={`mt-1 text-sm ${mobileBodyClass}`}>
                      {pairing.platform ?? "ios"} · {pairing.status}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <Badge
                      tone={pairing.status === "healthy" ? "signal" : "meta"}
                    >
                      {pairing.status.replaceAll("_", " ")}
                    </Badge>
                    {pairing.lastSyncAt ? (
                      <Badge tone="meta">
                        Synced {new Date(pairing.lastSyncAt).toLocaleString()}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex min-w-0 max-w-full flex-wrap gap-2 overflow-hidden">
                  {pairing.capabilities.map((capability) => (
                    <Badge key={capability} tone="meta" size="sm" wrap>
                      {formatCapabilityLabel(capability)}
                    </Badge>
                  ))}
                </div>
                <div
                  className={`flex min-w-0 max-w-full flex-wrap items-center justify-between gap-3 overflow-hidden text-sm ${mobileBodyClass}`}
                >
                  <div className="grid min-w-0 max-w-full flex-1 basis-[16rem] gap-1">
                    <div className="min-w-0 max-w-full break-all [overflow-wrap:anywhere]">
                      {pairing.apiBaseUrl}
                    </div>
                    <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
                      Expires {new Date(pairing.expiresAt).toLocaleString()}
                    </div>
                    {pairing.lastSyncError ? (
                      <div className="text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                        {pairing.lastSyncError}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    variant="secondary"
                    pending={
                      revokeMutation.isPending &&
                      revokeMutation.variables === pairing.id
                    }
                    pendingLabel="Revoking"
                    disabled={pairing.status === "revoked"}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Revoke ${pairing.deviceName ?? pairing.label}? This device must pair again before it can sync.`
                        )
                      ) {
                        revokeMutation.mutate(pairing.id);
                      }
                    }}
                  >
                    <ShieldOff className="size-4" />
                    {pairing.status === "revoked" ? "Revoked" : "Revoke"}
                  </Button>
                </div>
                <div className="grid min-w-0 gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
                  <div className={mobileEyebrowClass}>Device sync sources</div>
                  {(
                    [
                      ["health", "Health"],
                      ["movement", "Movement"],
                      ["screenTime", "Screen Time"]
                    ] as const
                  ).map(([sourceKey, label]) => {
                    const source = pairing.sourceStates[sourceKey];
                    const pending =
                      source.desiredEnabled !== source.appliedEnabled;
                    const loading =
                      sourceToggleMutation.isPending &&
                      sourceToggleMutation.variables?.pairingSessionId ===
                        pairing.id &&
                      sourceToggleMutation.variables?.source === sourceKey;
                    return (
                      <div
                        key={sourceKey}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3"
                      >
                        <div className="grid min-w-0 gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm text-[var(--ui-ink-strong)]">
                              {label}
                            </div>
                            <Badge
                              tone={sourceTone(
                                source.desiredEnabled,
                                source.syncEligible
                              )}
                              size="sm"
                            >
                              {source.desiredEnabled ? "Enabled" : "Off"}
                            </Badge>
                            {pending ? (
                              <Badge tone="meta" size="sm">
                                Pending on phone
                              </Badge>
                            ) : (
                              <Badge tone="meta" size="sm">
                                Applied
                              </Badge>
                            )}
                          </div>
                          <div
                            className={`break-words text-xs [overflow-wrap:anywhere] ${mobileBodyClass}`}
                          >
                            Authorization{" "}
                            {formatSourceAuthorization(
                              source.authorizationStatus
                            )}
                            {" · "}
                            Last seen{" "}
                            {formatSourceObservedAt(source.lastObservedAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={source.desiredEnabled}
                          aria-label={`${label} sync source`}
                          disabled={loading}
                          onClick={() =>
                            sourceToggleMutation.mutate({
                              pairingSessionId: pairing.id,
                              source: sourceKey,
                              desiredEnabled: !source.desiredEnabled
                            })
                          }
                          className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                            source.desiredEnabled
                              ? "border-[color-mix(in_srgb,var(--primary)_45%,var(--ui-border-subtle)_55%)] bg-[var(--ui-accent-soft)]"
                              : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-3)]"
                          } ${loading ? "opacity-60" : ""}`}
                        >
                          <span
                            className={`inline-block size-5 rounded-full bg-[var(--ui-ink-strong)] shadow transition ${
                              source.desiredEnabled
                                ? "translate-x-6"
                                : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {activePairings.length === 0 ? (
              <div
                className={`${mobileInsetPanelClass} px-4 py-6 text-sm ${mobileBodyClass}`}
              >
                No companion paired yet. Generate a QR code, then open the iOS
                companion and scan it.
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => void overviewQuery.refetch()}
            >
              <RefreshCcw className="size-4" />
              Refresh status
            </Button>
            <Link to="/sleep" className={mobileActionLinkClass}>
              <Link2 className="size-4" />
              Open sleep view
            </Link>
            <Link to="/sports" className={mobileActionLinkClass}>
              <Link2 className="size-4" />
              Open sports view
            </Link>
            <Link to="/vitals" className={mobileActionLinkClass}>
              <Link2 className="size-4" />
              Open vitals view
            </Link>
          </div>
        </Card>
      </section>

      <Card className="grid min-w-0 gap-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={mobileEyebrowClass}>Sync history</div>
            <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
              Recent HealthKit import runs
            </div>
          </div>
          <Badge tone="meta">{overview.importRuns.length} recent runs</Badge>
        </div>

        <div className="grid min-w-0 gap-3">
          {overview.importRuns.map((run) => (
            <div
              key={run.id}
              className={`grid gap-3 ${mobilePanelClass} px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]`}
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <UploadCloud className={`size-4 ${mobileFaintClass}`} />
                  <div className="text-base text-[var(--ui-ink-strong)]">
                    {run.sourceDevice || "iPhone"} import
                  </div>
                  <Badge tone={run.status === "completed" ? "signal" : "meta"}>
                    {run.status}
                  </Badge>
                </div>
                <div
                  className={`break-words text-sm [overflow-wrap:anywhere] ${mobileBodyClass}`}
                >
                  {new Date(run.importedAt).toLocaleString()} ·{" "}
                  {formatSyncSummary(run.payloadSummary)}
                </div>
                <div
                  className={`flex flex-wrap gap-2 text-sm ${mobileBodyClass}`}
                >
                  <Badge tone="meta">Imported {run.importedCount}</Badge>
                  <Badge tone="meta">Created {run.createdCount}</Badge>
                  <Badge tone="meta">Updated {run.updatedCount}</Badge>
                  <Badge tone="meta">Merged {run.mergedCount}</Badge>
                </div>
                {run.errorMessage ? (
                  <div className="text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                    {run.errorMessage}
                  </div>
                ) : null}
              </div>
              {run.pairingSessionId ? (
                <div
                  className={`break-words text-sm [overflow-wrap:anywhere] ${mobileFaintClass} lg:text-right`}
                >
                  Pairing {run.pairingSessionId}
                </div>
              ) : null}
            </div>
          ))}
          {overview.importRuns.length === 0 ? (
            <div
              className={`${mobileInsetPanelClass} px-4 py-6 text-sm ${mobileBodyClass}`}
            >
              No sync runs yet. Pair the iPhone companion and run the first
              HealthKit import.
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
