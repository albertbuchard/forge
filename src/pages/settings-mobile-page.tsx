import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  ChevronDown,
  ChevronUp,
  Link2,
  QrCode,
  RefreshCcw,
  ShieldOff,
  UploadCloud
} from "lucide-react";
import { Link } from "react-router-dom";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
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
import { getSingleSelectedUserId } from "@/lib/user-ownership";

function formatCapabilityLabel(capability: string) {
  return capability.replaceAll(".", " ");
}

function formatSyncSummary(payloadSummary: Record<string, unknown>) {
  const sleepSessions =
    typeof payloadSummary.sleepSessions === "number"
      ? payloadSummary.sleepSessions
      : 0;
  const workouts =
    typeof payloadSummary.workouts === "number" ? payloadSummary.workouts : 0;
  return `${sleepSessions} sleep · ${workouts} workouts`;
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

export function SettingsMobilePage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPanelOpen, setQrPanelOpen] = useState(false);
  const [latestPairing, setLatestPairing] = useState<{
    qrPayload: {
      apiBaseUrl: string;
      sessionId: string;
      pairingToken: string;
      expiresAt: string;
      capabilities: string[];
    };
  } | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["forge-companion-overview", ...selectedUserIds],
    queryFn: async () => (await getCompanionOverview(selectedUserIds)).overview
  });

  const pairingMutation = useMutation({
    mutationFn: async () =>
      createCompanionPairingSession({
        userId: defaultUserId ?? null
      }),
    onSuccess: async (result) => {
      setLatestPairing({ qrPayload: result.qrPayload });
      setQrPanelOpen(true);
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
    }
  });

  const revokeMutation = useMutation({
    mutationFn: async (pairingSessionId: string) =>
      revokeCompanionPairingSession(pairingSessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
    }
  });

  const revokeAllMutation = useMutation({
    mutationFn: async () =>
      revokeAllCompanionPairingSessions({
        userIds: selectedUserIds,
        includeRevoked: false
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
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
      await queryClient.invalidateQueries({
        queryKey: ["forge-companion-overview"]
      });
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

  if (overviewQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Companion"
        title="Loading mobile companion"
        description="Checking pairing state and recent sync status."
        columns={2}
        blocks={5}
      />
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <ErrorState
        eyebrow="Companion"
        error={overviewQuery.error ?? new Error("Companion overview unavailable")}
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }

  const overview = overviewQuery.data;
  const activePairings = overview.pairings.filter(
    (pairing) => pairing.status !== "revoked"
  );
  const revokedPairingsCount = overview.pairings.length - activePairings.length;
  const handleQrAction = async () => {
    if (latestPairing && qrPanelOpen) {
      setQrPanelOpen(false);
      return;
    }
    if (latestPairing && !qrPanelOpen) {
      setQrPanelOpen(true);
      return;
    }
    await pairingMutation.mutateAsync();
  };

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Mobile companion"
        description="Pair the native iPhone companion, sync Apple Health, and keep the bridge open for watch and location signals."
        badge={overview.healthState.replaceAll("_", " ")}
      />

      <SettingsSectionNav />

      <section className="grid gap-4">
        {import.meta.env.DEV ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] p-4">
            <div className="grid gap-1">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
                QA lab
              </div>
              <div className="text-sm text-white/62">
                Open deterministic source-state and movement-gap fixtures without a real phone.
              </div>
            </div>
            <Link
              to="/settings/mobile/lab"
              className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-medium text-white transition hover:bg-white/[0.1]"
            >
              Open Companion Sync Lab
            </Link>
          </Card>
        ) : null}

        <Card className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Pair iPhone
              </div>
              <div className="mt-2 text-lg text-white">
                Open a pairing QR only when you need it
              </div>
              <div className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
                Keep the page compact by generating or reopening the one-time
                QR only when you are about to scan it from Forge Companion.
              </div>
            </div>
            <Button
              onClick={() => void handleQrAction()}
              pending={pairingMutation.isPending}
              pendingLabel="Generating"
            >
              <QrCode className="size-4" />
              {latestPairing
                ? qrPanelOpen
                  ? "Hide QR"
                  : "Show QR"
                : "Generate QR"}
              {latestPairing ? (
                qrPanelOpen ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )
              ) : null}
            </Button>
          </div>

          {qrPanelOpen ? (
            <div className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
              {qrDataUrl ? (
                <div className="grid justify-items-center gap-4 rounded-[24px] bg-white px-6 py-6 text-slate-950">
                  <img
                    src={qrDataUrl}
                    alt="Forge Companion pairing QR code"
                    className="w-full max-w-[320px]"
                  />
                  <div className="max-w-[320px] text-center text-sm text-slate-600">
                    Scan this in the iOS companion to pass the Forge API
                    address and the one-time pairing token.
                  </div>
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-5 py-8 text-center text-sm text-white/55">
                  Generating the QR code now.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-white/62">
                  {latestPairing ? (
                    <>
                      Expires{" "}
                      {new Date(
                        latestPairing.qrPayload.expiresAt
                      ).toLocaleString()}
                      .
                    </>
                  ) : (
                    "Generate the one-time QR and scan it from the iPhone app."
                  )}
                </div>
                {latestPairing ? (
                  <Button
                    variant="secondary"
                    pending={pairingMutation.isPending}
                    pendingLabel="Generating"
                    onClick={() => void pairingMutation.mutateAsync()}
                  >
                    <RefreshCcw className="size-4" />
                    Regenerate QR
                  </Button>
                ) : null}
              </div>

              {latestPairing ? (
                <div className="grid gap-3 rounded-[18px] bg-white/[0.04] p-4 text-sm text-white/62">
                  <div className="rounded-[16px] bg-slate-950/60 p-3 font-mono text-[11px] leading-5 text-white/70">
                    {JSON.stringify(latestPairing.qrPayload, null, 2)}
                  </div>
                  <div className="text-xs text-white/45">
                    The same payload can be pasted into the iPhone app if the
                    camera path is unavailable.
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-5 py-6 text-sm text-white/55">
              Tap the QR button when you actually want to pair a phone.
            </div>
          )}
        </Card>

        <Card className="grid gap-4">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Companion state
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Pairings</div>
              <div className="mt-2 font-display text-3xl text-white">
                {activePairings.length}
              </div>
              {revokedPairingsCount > 0 ? (
                <div className="mt-2 text-xs text-white/42">
                  {revokedPairingsCount} revoked hidden
                </div>
              ) : null}
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Sleep sessions</div>
              <div className="mt-2 font-display text-3xl text-white">
                {overview.counts.sleepSessions}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Workouts</div>
              <div className="mt-2 font-display text-3xl text-white">
                {overview.counts.workouts}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Reflected sleep</div>
              <div className="mt-2 font-display text-3xl text-white">
                {overview.counts.reflectiveSleepSessions}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Linked workouts</div>
              <div className="mt-2 font-display text-3xl text-white">
                {overview.counts.linkedWorkouts}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Habit-generated</div>
              <div className="mt-2 font-display text-3xl text-white">
                {overview.counts.habitGeneratedWorkouts}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Reconciled</div>
              <div className="mt-2 font-display text-3xl text-white">
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
            <Badge tone={permissionTone(overview.permissions.healthKitAuthorized)}>
              HealthKit {overview.permissions.healthKitAuthorized ? "ready" : "needed"}
            </Badge>
            <Badge
              tone={permissionTone(overview.permissions.backgroundRefreshEnabled)}
            >
              Background refresh{" "}
              {overview.permissions.backgroundRefreshEnabled ? "ready" : "not yet"}
            </Badge>
            <Badge tone="meta">
              Location {overview.permissions.locationReady ? "ready" : "later"}
            </Badge>
            <Badge tone="meta">
              Motion {overview.permissions.motionReady ? "ready" : "later"}
            </Badge>
          </div>

          <div className="grid gap-3 rounded-[18px] bg-white/[0.04] p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Pairing path
            </div>
            <div className="grid gap-2 text-sm text-white/62">
              <div>1. Generate a one-time QR code here inside Forge Settings.</div>
              <div>2. Scan it in Forge Companion to pass the API URL and pairing token.</div>
              <div>3. Approve Health access on iPhone, then run the first sync.</div>
              <div>4. Review import history below and open Sleep or Sports to enrich the imported records.</div>
            </div>
          </div>

          <div className="grid gap-3">
            {activePairings.length > 0 ? (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  pending={revokeAllMutation.isPending}
                  pendingLabel="Revoking all"
                  onClick={() => void revokeAllMutation.mutateAsync()}
                >
                  <ShieldOff className="size-4" />
                  Revoke all
                </Button>
              </div>
            ) : null}
            {activePairings.map((pairing) => (
              <div
                key={pairing.id}
                className="grid gap-3 rounded-[18px] bg-white/[0.04] px-4 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-base text-white">
                      {pairing.deviceName ?? pairing.label}
                    </div>
                    <div className="mt-1 text-sm text-white/56">
                      {pairing.platform ?? "ios"} · {pairing.status}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={pairing.status === "healthy" ? "signal" : "meta"}>
                      {pairing.status.replaceAll("_", " ")}
                    </Badge>
                    {pairing.lastSyncAt ? (
                      <Badge tone="meta">
                        Synced {new Date(pairing.lastSyncAt).toLocaleString()}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pairing.capabilities.map((capability) => (
                    <Badge key={capability} tone="meta" size="sm" wrap>
                      {formatCapabilityLabel(capability)}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/55">
                  <div className="grid gap-1">
                    <div>{pairing.apiBaseUrl}</div>
                    <div>
                      Expires {new Date(pairing.expiresAt).toLocaleString()}
                    </div>
                    {pairing.lastSyncError ? (
                      <div className="text-rose-200/80">
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
                    onClick={() => void revokeMutation.mutateAsync(pairing.id)}
                  >
                    <ShieldOff className="size-4" />
                    {pairing.status === "revoked" ? "Revoked" : "Revoke"}
                  </Button>
                </div>
                <div className="grid gap-3 rounded-[16px] border border-white/8 bg-white/[0.03] p-3">
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                    Device sync sources
                  </div>
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
                      sourceToggleMutation.variables?.pairingSessionId === pairing.id &&
                      sourceToggleMutation.variables?.source === sourceKey;
                    return (
                      <div
                        key={sourceKey}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-white/6 bg-white/[0.03] px-3 py-3"
                      >
                        <div className="grid gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm text-white">{label}</div>
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
                          <div className="text-xs text-white/55">
                            Authorization {formatSourceAuthorization(source.authorizationStatus)}
                            {" · "}
                            Last seen {formatSourceObservedAt(source.lastObservedAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={source.desiredEnabled}
                          aria-label={`${label} sync source`}
                          disabled={loading}
                          onClick={() =>
                            void sourceToggleMutation.mutateAsync({
                              pairingSessionId: pairing.id,
                              source: sourceKey,
                              desiredEnabled: !source.desiredEnabled
                            })
                          }
                          className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                            source.desiredEnabled
                              ? "border-[rgba(171,232,255,0.4)] bg-[rgba(111,133,232,0.36)]"
                              : "border-white/10 bg-white/[0.06]"
                          } ${loading ? "opacity-60" : ""}`}
                        >
                          <span
                            className={`inline-block size-5 rounded-full bg-white shadow transition ${
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
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-6 text-sm text-white/55">
                No companion paired yet. Generate a QR code, then open the iOS companion and scan it.
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => void overviewQuery.refetch()}>
              <RefreshCcw className="size-4" />
              Refresh status
            </Button>
            <Link
              to="/sleep"
              className="inline-flex min-h-11 items-center gap-2 rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/72 transition hover:bg-white/[0.06] hover:text-white"
            >
              <Link2 className="size-4" />
              Open sleep view
            </Link>
            <Link
              to="/sports"
              className="inline-flex min-h-11 items-center gap-2 rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/72 transition hover:bg-white/[0.06] hover:text-white"
            >
              <Link2 className="size-4" />
              Open sports view
            </Link>
          </div>
        </Card>
      </section>

      <Card className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Sync history
            </div>
            <div className="mt-2 text-lg text-white">
              Recent HealthKit import runs
            </div>
          </div>
          <Badge tone="meta">
            {overview.importRuns.length} recent runs
          </Badge>
        </div>

        <div className="grid gap-3">
          {overview.importRuns.map((run) => (
            <div
              key={run.id}
              className="grid gap-3 rounded-[18px] bg-white/[0.04] px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <UploadCloud className="size-4 text-white/55" />
                  <div className="text-base text-white">
                    {run.sourceDevice || "iPhone"} import
                  </div>
                  <Badge tone={run.status === "completed" ? "signal" : "meta"}>
                    {run.status}
                  </Badge>
                </div>
                <div className="text-sm text-white/60">
                  {new Date(run.importedAt).toLocaleString()} ·{" "}
                  {formatSyncSummary(run.payloadSummary)}
                </div>
                <div className="flex flex-wrap gap-2 text-sm text-white/60">
                  <Badge tone="meta">Imported {run.importedCount}</Badge>
                  <Badge tone="meta">Created {run.createdCount}</Badge>
                  <Badge tone="meta">Updated {run.updatedCount}</Badge>
                  <Badge tone="meta">Merged {run.mergedCount}</Badge>
                </div>
                {run.errorMessage ? (
                  <div className="text-sm text-rose-200/80">
                    {run.errorMessage}
                  </div>
                ) : null}
              </div>
              {run.pairingSessionId ? (
                <div className="text-sm text-white/45 lg:text-right">
                  Pairing {run.pairingSessionId}
                </div>
              ) : null}
            </div>
          ))}
          {overview.importRuns.length === 0 ? (
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-6 text-sm text-white/55">
              No sync runs yet. Pair the iPhone companion and run the first HealthKit import.
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
