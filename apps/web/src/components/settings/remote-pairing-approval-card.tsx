import { useEffect, useState } from "react";
import {
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, ShieldCheck, ShieldX } from "lucide-react";

import {
  REMOTE_PAIRING_REQUESTS_QUERY_KEY,
  useRemotePairingRequests
} from "@/components/security/pairing-request-notification";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  approveRemotePairingRequest,
  beginPrivilegedPairingStepUp,
  completePrivilegedPairingStepUp,
  denyRemotePairingRequest,
  listRemoteClients,
  revokeRemoteClient,
  type RemotePairingRequest
} from "@/lib/api";

const REMOTE_CLIENTS_QUERY_KEY = ["forge-security-clients"] as const;

function requiresOwnerStepUp(review: RemotePairingRequest) {
  return (
    ["executor", "operator", "custom"].includes(review.requestedProfile) ||
    review.requestedScopes.some(
      (scope) =>
        scope === "*" ||
        scope.startsWith("machine.") ||
        scope.startsWith("secret.") ||
        scope.startsWith("admin.")
    )
  );
}

function PairingReviewDetails({ request }: { request: RemotePairingRequest }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-[var(--ui-ink-strong)]">
          {request.clientName}
        </strong>
        <Badge>{request.clientType}</Badge>
        <Badge>{request.requestedProfile.replaceAll("_", " ")}</Badge>
        <Badge>{request.status}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {request.requestedScopes.map((scope) => (
          <Badge key={scope}>{scope}</Badge>
        ))}
      </div>
      <p className="text-xs leading-5 text-[var(--ui-ink-muted)]">
        Expires {new Date(request.expiresAt).toLocaleTimeString()} · audience{" "}
        {request.audience}
      </p>
      <dl className="grid gap-2 rounded-[14px] border border-[var(--ui-border-subtle)] p-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
        <div>
          <dt className="font-medium text-[var(--ui-ink-strong)]">
            Forge installation
          </dt>
          <dd className="break-all font-mono">
            {request.installationFingerprint}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--ui-ink-strong)]">
            Secured endpoint
          </dt>
          <dd className="break-all">
            {request.endpoint.origin ?? "Local runtime only"} ·{" "}
            <span className="font-mono">{request.endpoint.fingerprint}</span>
          </dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--ui-ink-strong)]">
            Resource boundary
          </dt>
          <dd>
            Limited to this profile, these scopes, and each route’s
            authorization policy.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--ui-ink-strong)]">
            Network egress boundary
          </dt>
          <dd>
            Denied unless an approved capability permits it and the destination
            passes validation.
            {request.boundaries.egress.requestedScopes.length
              ? ` Egress-capable scopes: ${request.boundaries.egress.requestedScopes.join(", ")}.`
              : " No egress-capable scope is requested."}
          </dd>
        </div>
      </dl>
    </>
  );
}

export function RemotePairingApprovalCard() {
  const queryClient = useQueryClient();
  const requestsQuery = useRemotePairingRequests(true);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{
    requestId: string;
    action: "approve" | "deny";
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const clientsQuery = useQuery({
    queryKey: REMOTE_CLIENTS_QUERY_KEY,
    queryFn: listRemoteClients,
    refetchInterval: (state) =>
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      state.state.data?.clients.some(
        (client) => client.activationState === "awaiting_client"
      )
        ? 3_000
        : false,
    refetchIntervalInBackground: false
  });
  const revokeMutation = useMutation({
    mutationFn: revokeRemoteClient,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: REMOTE_PAIRING_REQUESTS_QUERY_KEY
        }),
        queryClient.invalidateQueries({ queryKey: REMOTE_CLIENTS_QUERY_KEY })
      ]);
    }
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.location.hash !== "#pending-pairings"
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById("pending-pairings");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const refreshPairingState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: REMOTE_PAIRING_REQUESTS_QUERY_KEY
      }),
      queryClient.invalidateQueries({ queryKey: REMOTE_CLIENTS_QUERY_KEY })
    ]);
  };

  const approve = async (request: RemotePairingRequest) => {
    const userCode = (codes[request.requestId] ?? "").trim().toUpperCase();
    if (userCode.length < 8) return;
    setPending({ requestId: request.requestId, action: "approve" });
    setMessage(null);
    try {
      if (requiresOwnerStepUp(request)) {
        const ceremony = await beginPrivilegedPairingStepUp(userCode);
        if (ceremony.review.requestId !== request.requestId) {
          throw new Error(
            "The pairing code does not match the selected request."
          );
        }
        const response =
          ceremony.ceremony === "register"
            ? await startRegistration({
                optionsJSON: ceremony.options as Parameters<
                  typeof startRegistration
                >[0]["optionsJSON"]
              })
            : await startAuthentication({
                optionsJSON: ceremony.options as Parameters<
                  typeof startAuthentication
                >[0]["optionsJSON"]
              });
        await completePrivilegedPairingStepUp({
          userCode,
          review: request,
          challengeId: ceremony.challengeId,
          response
        });
      } else {
        await approveRemotePairingRequest(request.requestId, userCode);
      }
      setCodes((current) => {
        const next = { ...current };
        delete next[request.requestId];
        return next;
      });
      await refreshPairingState();
      setMessage(
        `${request.clientName} is approved and waiting for the device to finish.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Forge could not approve this pairing."
      );
    } finally {
      setPending(null);
    }
  };

  const deny = async (request: RemotePairingRequest) => {
    setPending({ requestId: request.requestId, action: "deny" });
    setMessage(null);
    try {
      await denyRemotePairingRequest(request.requestId);
      await refreshPairingState();
      setMessage(`${request.clientName} was denied.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Forge could not deny this pairing."
      );
    } finally {
      setPending(null);
    }
  };

  const requests = requestsQuery.data?.requests ?? [];

  return (
    <Card
      id="pending-pairings"
      tabIndex={-1}
      className="scroll-mt-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
        Pairing requests
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-muted)]">
        Match the short code shown on the device, enter it once on that request,
        and approve. The details below are the full review.
      </p>

      <div className="mt-4 grid gap-3">
        {requestsQuery.isLoading ? (
          <p className="text-sm text-[var(--ui-ink-muted)]">
            Checking for pairing requests…
          </p>
        ) : requestsQuery.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-[var(--danger)]">
              Pairing requests could not be loaded.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void requestsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : requests.length ? (
          requests.map((request) => {
            const normalizedCode = (codes[request.requestId] ?? "")
              .trim()
              .toUpperCase();
            const approving =
              pending?.requestId === request.requestId &&
              pending.action === "approve";
            const denying =
              pending?.requestId === request.requestId &&
              pending.action === "deny";
            return (
              <section
                key={request.requestId}
                className="grid gap-3 rounded-[18px] bg-[var(--ui-surface-2)] p-4"
                aria-label={`Pairing request from ${request.clientName}`}
              >
                <PairingReviewDetails request={request} />
                {request.status === "approved" ? (
                  <div className="flex items-center gap-2 rounded-[14px] bg-[var(--ui-success-soft)] px-3 py-2 text-sm text-[var(--success)]">
                    <Clock3 className="size-4" aria-hidden="true" />
                    Approved — waiting for the device to finish securely.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <label className="grid gap-1.5 text-sm text-[var(--ui-ink-medium)]">
                      Short code shown on {request.clientName}
                      <input
                        value={codes[request.requestId] ?? ""}
                        onChange={(event) => {
                          setCodes((current) => ({
                            ...current,
                            [request.requestId]: event.target.value
                          }));
                          setMessage(null);
                        }}
                        placeholder="ABCD-EFGH"
                        autoComplete="off"
                        spellCheck={false}
                        className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 font-mono uppercase tracking-[0.12em] text-[var(--ui-ink-strong)] outline-none focus:border-[var(--ui-border-strong)]"
                      />
                    </label>
                    <Button
                      type="button"
                      disabled={normalizedCode.length < 8 || denying}
                      pending={approving}
                      pendingLabel="Approving"
                      onClick={() => void approve(request)}
                    >
                      <ShieldCheck className="mr-2 size-4" aria-hidden="true" />
                      {requiresOwnerStepUp(request)
                        ? "Verify and approve"
                        : "Approve"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={approving}
                      pending={denying}
                      pendingLabel="Denying"
                      onClick={() => void deny(request)}
                    >
                      <ShieldX className="mr-2 size-4" aria-hidden="true" />
                      Deny
                    </Button>
                  </div>
                )}
              </section>
            );
          })
        ) : (
          <p className="text-sm text-[var(--ui-ink-muted)]">
            No device is waiting for approval.
          </p>
        )}
      </div>

      {message ? (
        <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
          {message}
        </p>
      ) : null}

      <div className="mt-6 border-t border-[var(--ui-border-subtle)] pt-4">
        <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
          Paired clients
        </div>
        <div className="mt-3 grid gap-3">
          {clientsQuery.isLoading ? (
            <p className="text-sm text-[var(--ui-ink-muted)]">
              Loading paired clients…
            </p>
          ) : clientsQuery.isError ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[var(--danger)]">
                Paired clients could not be loaded.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void clientsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : clientsQuery.data?.clients.length ? (
            clientsQuery.data.clients.map((client) => (
              <div
                key={client.id}
                className="flex flex-col gap-3 rounded-[18px] bg-[var(--ui-surface-2)] p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[var(--ui-ink-strong)]">
                      {client.clientName}
                    </strong>
                    <Badge>{client.clientType}</Badge>
                    <Badge>{client.profile.replaceAll("_", " ")}</Badge>
                    <Badge>{client.activationState.replaceAll("_", " ")}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {client.scopes.map((scope) => (
                      <Badge key={scope}>{scope}</Badge>
                    ))}
                  </div>
                  <p className="mt-2 break-all text-xs text-[var(--ui-ink-muted)]">
                    {client.id} · paired{" "}
                    {new Date(client.createdAt).toLocaleString()}
                  </p>
                </div>
                {!client.revokedAt && client.activationState !== "revoked" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    pending={
                      revokeMutation.isPending &&
                      revokeMutation.variables === client.id
                    }
                    pendingLabel="Revoking"
                    onClick={() => revokeMutation.mutate(client.id)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--ui-ink-muted)]">
              No remote browser or API client has been paired.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
