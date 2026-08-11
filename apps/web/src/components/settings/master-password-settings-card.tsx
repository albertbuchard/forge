import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getMasterPasswordStatus, setMasterPassword } from "@/lib/api";

export const MASTER_PASSWORD_STATUS_QUERY_KEY = [
  "forge-master-password-status"
] as const;

export function MasterPasswordSettingsCard() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: MASTER_PASSWORD_STATUS_QUERY_KEY,
    queryFn: getMasterPasswordStatus
  });
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: setMasterPassword,
    onSuccess: async (status) => {
      queryClient.setQueryData(MASTER_PASSWORD_STATUS_QUERY_KEY, status);
      setPassword("");
      setConfirmation("");
      setCurrentPassword("");
      setEditing(false);
      setMessage(
        status.configuredAt === status.updatedAt
          ? "Master password set. Remote browsers may now choose master-password pairing."
          : "Master password changed. New remote pairing attempts must use the new password."
      );
    },
    onError: (error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Forge could not save the master password."
      );
    }
  });

  const status = statusQuery.data;
  const configured = status?.configured === true;
  const formVisible = !configured || editing;
  const minimumLength = status?.minimumLength ?? 15;
  const canSubmit =
    [...password.normalize("NFC")].length >= minimumLength &&
    password.normalize("NFC") === confirmation.normalize("NFC") &&
    (!configured || currentPassword.length > 0);

  return (
    <Card className="grid gap-4" aria-labelledby="master-password-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-full bg-[var(--ui-surface-2)] p-2.5">
            <KeyRound className="size-5 text-[var(--ui-ink-strong)]" />
          </div>
          <div>
            <div className="type-label text-[var(--ui-ink-faint)]">
              Remote access
            </div>
            <h2
              id="master-password-title"
              className="mt-1 text-lg font-semibold text-[var(--ui-ink-strong)]"
            >
              Master password
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ui-ink-muted)]">
              Optional and unset by default. Set a unique passphrase only if you
              want a remote browser to pair without waiting for a second local
              approval. Every paired browser still receives its own scoped,
              sender-bound, revocable credential.
            </p>
          </div>
        </div>
        <Badge>{configured ? "Set" : "Not set"}</Badge>
      </div>

      {statusQuery.isLoading ? (
        <p className="text-sm text-[var(--ui-ink-muted)]">
          Checking master-password status…
        </p>
      ) : statusQuery.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-[var(--danger)]">
            Master-password status could not be loaded.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void statusQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : configured && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-[var(--ui-success-soft)] p-3">
          <div className="flex items-center gap-2 text-sm text-[var(--success)]">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Configured. The password itself is not stored and cannot be shown.
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditing(true);
              setMessage(null);
            }}
          >
            Change master password
          </Button>
        </div>
      ) : null}

      {formVisible && !statusQuery.isLoading && !statusQuery.isError ? (
        <form
          className="grid gap-3 rounded-[18px] bg-[var(--ui-surface-2)] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            setMessage(null);
            mutation.mutate({
              password,
              confirmation,
              ...(configured ? { currentPassword } : {})
            });
          }}
        >
          <p className="text-sm leading-6 text-[var(--ui-ink-muted)]">
            Use at least {minimumLength} characters. A long, unique passphrase
            is stronger than forced symbol rules. Common, Forge-derived, and
            owner-derived passwords are rejected.
          </p>
          {configured ? (
            <label className="grid gap-1.5 text-sm text-[var(--ui-ink-medium)]">
              Current master password
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-[var(--ui-ink-strong)] outline-none focus:border-[var(--ui-border-strong)]"
              />
            </label>
          ) : null}
          <label className="grid gap-1.5 text-sm text-[var(--ui-ink-medium)]">
            {configured ? "New master password" : "Create master password"}
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setMessage(null);
              }}
              minLength={minimumLength}
              maxLength={status?.maximumLength ?? 128}
              autoComplete="new-password"
              className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-[var(--ui-ink-strong)] outline-none focus:border-[var(--ui-border-strong)]"
            />
          </label>
          <label className="grid gap-1.5 text-sm text-[var(--ui-ink-medium)]">
            Confirm master password
            <input
              type="password"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setMessage(null);
              }}
              minLength={minimumLength}
              maxLength={status?.maximumLength ?? 128}
              autoComplete="new-password"
              className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-[var(--ui-ink-strong)] outline-none focus:border-[var(--ui-border-strong)]"
            />
          </label>
          {password && confirmation && password !== confirmation ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              The two passwords do not match.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={!canSubmit || mutation.isPending}
              pending={mutation.isPending}
              pendingLabel="Saving securely"
            >
              {configured ? "Change master password" : "Set master password"}
            </Button>
            {configured ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setPassword("");
                  setConfirmation("");
                  setCurrentPassword("");
                  setMessage(null);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {message ? (
        <p aria-live="polite" className="text-sm text-[var(--ui-ink-medium)]">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
