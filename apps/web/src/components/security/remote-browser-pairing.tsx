import { useEffect, useRef, useState } from "react";
import {
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";
import { KeyRound, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  approveRemoteBrowserPairingWithMasterPassword,
  beginRemoteBrowserPairing,
  beginTrustedBrowserAuthentication,
  beginTrustedBrowserRegistration,
  cancelRemoteBrowserPairing,
  cancelRemoteBrowserPairingOnPageExit,
  completeTrustedBrowserAuthentication,
  completeTrustedBrowserRegistration,
  pollRemoteBrowserPairing,
  refreshRemoteBrowserPairingCancelProof
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";

type Pairing = Awaited<ReturnType<typeof beginRemoteBrowserPairing>>;

async function registerCurrentDevice(clientId: string) {
  const ceremony = await beginTrustedBrowserRegistration({
    clientId,
    label: `Forge device passkey on ${navigator.platform || "this device"}`
  });
  const response = await startRegistration({
    optionsJSON: ceremony.options as unknown as Parameters<
      typeof startRegistration
    >[0]["optionsJSON"]
  });
  await completeTrustedBrowserRegistration({
    clientId,
    challengeId: ceremony.challengeId,
    response
  });
}

export function RemoteBrowserPairing({
  onPaired
}: {
  onPaired: () => Promise<void> | void;
}) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [status, setStatus] = useState<
    | "idle"
    | "checking"
    | "starting"
    | "pending"
    | "paired"
    | "restoring"
    | "trusting"
    | "denied"
    | "expired"
    | "limited"
    | "failed"
  >("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [masterPassword, setMasterPassword] = useState("");
  const [masterPasswordPending, setMasterPasswordPending] = useState(false);
  const [pairedClientId, setPairedClientId] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const automaticRestoreState = useRef<"idle" | "in-flight" | "finished">(
    "idle"
  );

  useEffect(() => {
    if (automaticRestoreState.current !== "idle") return;
    automaticRestoreState.current = "in-flight";
    let stopped = false;

    const restore = async () => {
      try {
        const ceremony = await beginTrustedBrowserAuthentication();
        if (stopped) return;
        setStatus("restoring");
        const response = await startAuthentication({
          optionsJSON: ceremony.options as unknown as Parameters<
            typeof startAuthentication
          >[0]["optionsJSON"]
        });
        if (stopped) return;
        await completeTrustedBrowserAuthentication({
          challengeId: ceremony.challengeId,
          response
        });
        if (stopped) return;
        automaticRestoreState.current = "finished";
        setMessage("This device is verified. Opening Forge…");
        await onPaired();
      } catch {
        if (stopped) return;
        setStatus("idle");
        setMessage(null);
      } finally {
        if (!stopped) {
          automaticRestoreState.current = "finished";
        }
      }
    };

    void restore();
    return () => {
      stopped = true;
      if (automaticRestoreState.current === "in-flight") {
        automaticRestoreState.current = "idle";
      }
    };
  }, [onPaired]);

  useEffect(() => {
    if (!pairing || status !== "pending") return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await pollRemoteBrowserPairing(pairing);
        if (stopped) return;
        if (result.status === "approved") {
          setPairedClientId(result.clientId);
          setStatus("trusting");
          setMessage(
            "Pairing is approved. Confirm the device passkey once so Forge can restore access in compatible browsers without another pairing code."
          );
          try {
            await registerCurrentDevice(result.clientId);
            if (stopped) return;
            setMessage("This device is trusted. Opening Forge…");
            await onPaired();
          } catch (error) {
            if (stopped) return;
            setStatus("paired");
            setMessage(
              error instanceof Error
                ? error.message
                : "Forge could not create the device passkey. The paired session remains usable, and you can retry device trust now."
            );
          }
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
    setMasterPassword("");
  };

  const authorizeWithMasterPassword = async () => {
    if (!pairing || !masterPassword) return;
    setMasterPasswordPending(true);
    setMessage(null);
    try {
      await approveRemoteBrowserPairingWithMasterPassword(
        pairing,
        masterPassword
      );
      setMasterPassword("");
      setMessage(
        "Master password accepted. Forge is finishing this sender-bound browser pairing."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Forge rejected the master password."
      );
    } finally {
      setMasterPasswordPending(false);
    }
  };

  const restoreTrustedBrowser = async () => {
    setStatus("restoring");
    setMessage(null);
    try {
      const ceremony = await beginTrustedBrowserAuthentication();
      const response = await startAuthentication({
        optionsJSON: ceremony.options as unknown as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"]
      });
      await completeTrustedBrowserAuthentication({
        challengeId: ceremony.challengeId,
        response
      });
      setMessage("Trusted-device verification succeeded. Opening Forge…");
      await onPaired();
    } catch (error) {
      setStatus("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Forge could not restore this trusted browser. You can still pair it normally."
      );
    }
  };

  const trustPairedBrowser = async () => {
    if (!pairedClientId) return;
    setStatus("trusting");
    setMessage(null);
    try {
      await registerCurrentDevice(pairedClientId);
      setMessage("This device is trusted. Opening Forge…");
      await onPaired();
    } catch (error) {
      setStatus("paired");
      setMessage(
        error instanceof Error
          ? error.message
          : "Forge could not trust this device. The current paired session remains usable."
      );
    }
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
            Authorize this device once
          </h1>
          <p className="type-body mt-2 text-[var(--ui-ink-soft)]">
            Forge first checks for your device passkey. After one approved
            pairing, that passkey can restore the same scoped access in
            compatible browsers without another pairing code.
          </p>
        </div>
      </div>

      {status === "paired" || status === "trusting" ? (
        <div className="grid gap-3 rounded-[18px] bg-[var(--ui-surface-2)] p-4">
          <p className="text-sm leading-6 text-[var(--ui-ink-medium)]">
            Device trust stores a passkey that restores only this exact paired
            profile and scopes. Forge will require Face ID, Touch ID, Windows
            Hello, or the device passcode when it restores access.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              pending={status === "trusting"}
              pendingLabel="Verifying this device"
              onClick={() => void trustPairedBrowser()}
            >
              <ShieldCheck className="mr-2 size-4" />
              Finish trusting this device
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={status === "trusting"}
              onClick={() => void onPaired()}
            >
              Use this browser session only
            </Button>
          </div>
        </div>
      ) : pairing && status === "pending" ? (
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
          {pairing.masterPasswordAvailable ? (
            <div className="grid gap-3 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
              <div>
                <div className="type-label text-[var(--ui-ink-faint)]">
                  Master-password pairing
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
                  The owner enabled an optional master password for remote
                  access. It is sent only to this Forge HTTPS origin and is
                  never saved in this browser.
                </p>
              </div>
              <label className="grid gap-1.5 text-sm text-[var(--ui-ink-medium)]">
                Master password
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(event) => {
                    setMasterPassword(event.target.value);
                    setMessage(null);
                  }}
                  autoComplete="current-password"
                  className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)] outline-none focus:border-[var(--ui-border-strong)]"
                />
              </label>
              <div>
                <Button
                  type="button"
                  disabled={!masterPassword || masterPasswordPending}
                  pending={masterPasswordPending}
                  pendingLabel="Verifying securely"
                  onClick={() => void authorizeWithMasterPassword()}
                >
                  <KeyRound className="mr-2 size-4" />
                  Pair with master password
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--ui-ink-muted)]">
              No master password is configured. The local owner can approve this
              request now or set one later in Settings → Agents.
            </p>
          )}
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
            variant="secondary"
            onClick={() => void restoreTrustedBrowser()}
            pending={status === "checking" || status === "restoring"}
            pendingLabel="Checking device passkey"
          >
            <ShieldCheck className="mr-2 size-4" />
            Restore this device
          </Button>
          <Button
            type="button"
            onClick={() => void start()}
            pending={status === "starting"}
            pendingLabel="Creating secure request"
            disabled={
              status === "checking" ||
              status === "restoring" ||
              (status === "limited" && retrySeconds > 0)
            }
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
