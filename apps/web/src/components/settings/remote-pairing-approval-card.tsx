import { useState } from "react";
import {
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  approveRemotePairing,
  beginPrivilegedPairingStepUp,
  completePrivilegedPairingStepUp,
  denyRemotePairing,
  listRemoteClients,
  reviewRemotePairing,
  revokeRemoteClient,
  type RemotePairingReview
} from "@/lib/api";

function requiresOwnerStepUp(review: RemotePairingReview) {
  return (
    ["executor", "operator", "custom"].includes(
      review.requestedProfile
    ) ||
    review.requestedScopes.some(
      (scope) =>
        scope === "*" ||
        scope.startsWith("machine.") ||
        scope.startsWith("secret.") ||
        scope.startsWith("admin.")
    )
  );
}

export function RemotePairingApprovalCard() {
  const queryClient = useQueryClient();
  const [userCode, setUserCode] = useState("");
  const [review, setReview] = useState<RemotePairingReview | null>(null);
  const [pending, setPending] = useState<
    "review" | "approve" | "deny" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const clientsQuery = useQuery({
    queryKey: ["forge-security-clients"],
    queryFn: listRemoteClients
  });
  const revokeMutation = useMutation({
    mutationFn: revokeRemoteClient,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-security-clients"]
      });
    }
  });

  const normalizedCode = userCode.trim().toUpperCase();
  const reset = (nextMessage: string) => {
    setReview(null);
    setUserCode("");
    setMessage(nextMessage);
  };

  return (
    <Card>
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
        Remote device pairing
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-muted)]">
        Enter the short code shown by the remote browser or integration.
        Review the exact client, profile, and scopes before approving it.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={userCode}
          onChange={(event) => {
            setUserCode(event.target.value);
            setReview(null);
            setMessage(null);
          }}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 flex-1 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 font-mono uppercase tracking-[0.12em] text-[var(--ui-ink-strong)] outline-none focus:border-[var(--ui-border-strong)]"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={normalizedCode.length < 8}
          pending={pending === "review"}
          pendingLabel="Reviewing"
          onClick={async () => {
            setPending("review");
            setMessage(null);
            try {
              setReview(await reviewRemotePairing(normalizedCode));
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Forge could not review that pairing code."
              );
            } finally {
              setPending(null);
            }
          }}
        >
          Review request
        </Button>
      </div>

      {review ? (
        <div className="mt-4 grid gap-3 rounded-[18px] bg-[var(--ui-surface-2)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[var(--ui-ink-strong)]">
              {review.clientName}
            </strong>
            <Badge>{review.clientType}</Badge>
            <Badge>{review.requestedProfile.replaceAll("_", " ")}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {review.requestedScopes.map((scope) => (
              <Badge key={scope}>{scope}</Badge>
            ))}
          </div>
          <p className="text-xs leading-5 text-[var(--ui-ink-muted)]">
            Audience {review.audience} · expires{" "}
            {new Date(review.expiresAt).toLocaleTimeString()}
          </p>
          <dl className="grid gap-2 rounded-[14px] border border-[var(--ui-border-subtle)] p-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
            <div>
              <dt className="font-medium text-[var(--ui-ink-strong)]">
                Forge installation
              </dt>
              <dd className="break-all font-mono">
                {review.installationFingerprint}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ui-ink-strong)]">
                Secured endpoint
              </dt>
              <dd className="break-all">
                {review.endpoint.origin ?? "Local runtime only"} ·{" "}
                <span className="font-mono">
                  {review.endpoint.fingerprint}
                </span>
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ui-ink-strong)]">
                Resource boundary
              </dt>
              <dd>
                Limited to the reviewed profile, scopes, and each route’s
                authorization policy.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ui-ink-strong)]">
                Network egress boundary
              </dt>
              <dd>
                Denied unless an approved capability explicitly permits it
                and its destination passes validation.
                {review.boundaries.egress.requestedScopes.length
                  ? ` Egress-capable scopes: ${review.boundaries.egress.requestedScopes.join(", ")}.`
                  : " No egress-capable scope is requested."}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              pending={pending === "approve"}
              pendingLabel="Approving"
              onClick={async () => {
                setPending("approve");
                setMessage(null);
                try {
                  if (requiresOwnerStepUp(review)) {
                    const ceremony =
                      await beginPrivilegedPairingStepUp(normalizedCode);
                    if (ceremony.review.requestId !== review.requestId) {
                      throw new Error(
                        "The pairing request changed before owner verification."
                      );
                    }
                    const response =
                      ceremony.ceremony === "register"
                        ? await startRegistration({
                            optionsJSON:
                              ceremony.options as Parameters<
                                typeof startRegistration
                              >[0]["optionsJSON"]
                          })
                        : await startAuthentication({
                            optionsJSON:
                              ceremony.options as Parameters<
                                typeof startAuthentication
                              >[0]["optionsJSON"]
                          });
                    await completePrivilegedPairingStepUp({
                      userCode: normalizedCode,
                      review,
                      challengeId: ceremony.challengeId,
                      response
                    });
                  } else {
                    await approveRemotePairing(normalizedCode, review);
                  }
                  reset("Pairing approved with exactly the reviewed grant.");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Forge could not approve this pairing."
                  );
                } finally {
                  setPending(null);
                }
              }}
            >
              <ShieldCheck className="mr-2 size-4" />
              {requiresOwnerStepUp(review)
                ? "Verify and approve"
                : "Approve exact grant"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              pending={pending === "deny"}
              pendingLabel="Denying"
              onClick={async () => {
                setPending("deny");
                setMessage(null);
                try {
                  await denyRemotePairing(normalizedCode);
                  reset("Pairing denied. The remote client cannot continue.");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Forge could not deny this pairing."
                  );
                } finally {
                  setPending(null);
                }
              }}
            >
              <ShieldX className="mr-2 size-4" />
              Deny
            </Button>
          </div>
        </div>
      ) : null}

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
                    <Badge>{client.revokedAt ? "revoked" : "active"}</Badge>
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
                {!client.revokedAt ? (
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
