import { useEffect, useRef, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  beginRemoteBrowserPairing,
  cancelRemoteBrowserPairing,
  cancelRemoteBrowserPairingOnPageExit,
  pollRemoteBrowserPairing,
  refreshRemoteBrowserPairingCancelProof
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";

type Pairing = Awaited<ReturnType<typeof beginRemoteBrowserPairing>>;

export function RemoteBrowserPairing({
  onPaired
}: {
  onPaired: () => Promise<void> | void;
}) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [status, setStatus] = useState<
    | "idle"
    | "starting"
    | "pending"
    | "paired"
    | "denied"
    | "expired"
    | "limited"
    | "failed"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!pairing || status !== "pending") return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await pollRemoteBrowserPairing(pairing);
        if (stopped) return;
        if (result.status === "approved") {
          setStatus("paired");
          setMessage("This browser is paired. Opening Forge…");
          await onPaired();
          return;
        }
        if (result.status === "access_denied") {
          setStatus("denied");
          setMessage(
            "The owner denied this request. Start a new request only if that was unintended."
          );
          return;
        }
        if (result.status === "expired_token") {
          setStatus("expired");
          setMessage(
            "This pairing request expired. Start a new request when the owner is ready."
          );
          return;
        }
        const intervalSeconds =
          result.status === "slow_down"
            ? (result.intervalSeconds ?? pairing.intervalSeconds)
            : Math.max(
                pairing.intervalSeconds,
                result.intervalSeconds ?? pairing.intervalSeconds
              );
        timer.current = window.setTimeout(poll, intervalSeconds * 1_000);
      } catch (error) {
        if (stopped) return;
        setStatus("failed");
        setMessage(
          error instanceof Error
            ? error.message
            : "Forge could not check this pairing request."
        );
      }
    };
    timer.current = window.setTimeout(poll, pairing.intervalSeconds * 1_000);
    return () => {
      stopped = true;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, [onPaired, pairing, status]);

  useEffect(() => {
    if (!pairing || status !== "pending") return;
    const cancelOnExit = () => {
      cancelRemoteBrowserPairingOnPageExit(pairing);
    };
    const proofRefresh = window.setInterval(() => {
      void refreshRemoteBrowserPairingCancelProof(pairing).catch(() => {
        // The server request still expires quickly if this browser cannot sign.
      });
    }, 30_000);
    window.addEventListener("pagehide", cancelOnExit);
    return () => {
      window.clearInterval(proofRefresh);
      window.removeEventListener("pagehide", cancelOnExit);
    };
  }, [pairing, status]);

  useEffect(() => {
    if (status !== "limited" || retrySeconds <= 0) return;
    const retryTimer = window.setTimeout(() => {
      setRetrySeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearTimeout(retryTimer);
  }, [retrySeconds, status]);

  const start = async () => {
    setStatus("starting");
    setMessage(null);
    setRetrySeconds(0);
    try {
      const next = await beginRemoteBrowserPairing();
      setPairing(next);
      setStatus("pending");
    } catch (error) {
      if (
        error instanceof ForgeApiError &&
        error.code === "pairing_admission_limited"
      ) {
        const reportedRetrySeconds =
          error.retryAfterSeconds ??
          (typeof error.response === "object" &&
          error.response !== null &&
          typeof error.response.retryAfterSeconds === "number"
            ? error.response.retryAfterSeconds
            : 180);
        const boundedRetrySeconds = Math.max(
          1,
          Math.min(600, Math.ceil(reportedRetrySeconds))
        );
        setStatus("limited");
        setRetrySeconds(boundedRetrySeconds);
        setMessage(
          `Forge is protecting this installation from too many unfinished pairing requests. Leave this page open, then try again when the ${boundedRetrySeconds}-second countdown ends.`
        );
        return;
      }
      setStatus("failed");
      setMessage(
        error instanceof Error
          ? error.message
          : "Forge could not start browser pairing."
      );
    }
  };

  const cancel = async () => {
    if (pairing) {
      try {
        await cancelRemoteBrowserPairing(pairing);
      } catch {
        // The local state still stops. The server request also expires quickly.
      }
    }
    setPairing(null);
    setStatus("idle");
    setMessage(null);
    setRetrySeconds(0);
  };

  return (
    <Card
      role="region"
      aria-live="polite"
      className="mx-auto grid w-full max-w-2xl gap-5"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-[var(--ui-surface-2)] p-2.5">
          <ShieldCheck className="size-5 text-[var(--ui-ink-strong)]" />
        </div>
        <div>
          <div className="type-label text-[var(--ui-ink-faint)]">
            Secure browser pairing
          </div>
          <h1 className="type-display-section mt-1 text-[var(--ui-ink-strong)]">
            Authorize this browser once
          </h1>
          <p className="type-body mt-2 text-[var(--ui-ink-soft)]">
            Network or Tailscale access alone is not enough. Forge will create
            a scoped browser session only after the local owner approves this
            exact request.
          </p>
        </div>
      </div>

      {pairing && status === "pending" ? (
        <div className="grid gap-4 rounded-[18px] bg-[var(--ui-surface-2)] p-4">
          <div>
            <div className="type-label text-[var(--ui-ink-faint)]">
              Pairing code
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold tracking-[0.16em] text-[var(--ui-ink-strong)]">
              {pairing.userCode}
            </div>
          </div>
          <p className="text-sm leading-6 text-[var(--ui-ink-medium)]">
            In an already authorized local Forge browser, open{" "}
            <strong>Settings → Agents</strong>, review this code, and approve
            the displayed browser name, trusted-assistant profile, and
            read/write scopes. This page checks silently at the server’s
            required interval.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel request
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => void start()}
            pending={status === "starting"}
            pendingLabel="Creating secure request"
            disabled={status === "limited" && retrySeconds > 0}
          >
            <KeyRound className="mr-2 size-4" />
            {status === "limited" && retrySeconds > 0
              ? `Try again in ${retrySeconds}s`
              : "Pair this browser"}
          </Button>
        </div>
      )}

      {message ? (
        <p className="text-sm leading-6 text-[var(--ui-ink-medium)]">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
