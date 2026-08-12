import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { getUserDeactivationPreview } from "@/lib/api";
import type {
  UserDeactivationPreview,
  UserIdentityEvidence,
  UserSummary
} from "@/lib/types";

const panelClass =
  "rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";

type LifecycleDraft = {
  replacementUserId: string;
  reason: string;
  disconnectActiveSessions: boolean;
};

function initialDraft(user: UserSummary | null, activeUsers: UserSummary[]) {
  const replacement =
    activeUsers.find(
      (candidate) =>
        candidate.id === "user_operator" && candidate.id !== user?.id
    ) ??
    activeUsers.find((candidate) => candidate.id !== user?.id) ??
    null;
  return {
    replacementUserId: replacement?.id ?? "",
    reason: "",
    disconnectActiveSessions: false
  } satisfies LifecycleDraft;
}

function PreviewSummary({ preview }: { preview: UserDeactivationPreview }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={panelClass}>
          <div className="text-xs text-[var(--ui-ink-faint)]">
            Owned records
          </div>
          <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
            {preview.totalOwnedEntities}
          </div>
        </div>
        <div className={panelClass}>
          <div className="text-xs text-[var(--ui-ink-faint)]">Assignments</div>
          <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
            {preview.totalAssignments}
          </div>
        </div>
        <div className={panelClass}>
          <div className="text-xs text-[var(--ui-ink-faint)]">
            Live sessions
          </div>
          <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
            {preview.activeRuntimeSessions}
          </div>
        </div>
        <div className={panelClass}>
          <div className="text-xs text-[var(--ui-ink-faint)]">
            Active tokens
          </div>
          <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
            {preview.activeAgentTokens}
          </div>
        </div>
      </div>
      {preview.blockers.length > 0 ? (
        <div
          className="rounded-[18px] border border-[var(--danger)]/30 bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
          role="alert"
        >
          {preview.blockers.join(" ")}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {preview.ownership.map((item) => (
          <Badge key={`owner-${item.entityType}`} tone="meta">
            {item.count} {item.entityType} owned
          </Badge>
        ))}
        {preview.assignments.map((item) => (
          <Badge key={`assignment-${item.entityType}`} tone="meta">
            {item.count} {item.entityType} assigned
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function UserLifecycleFlowDialog({
  open,
  onOpenChange,
  user,
  activeUsers,
  identityEvidence,
  pending,
  onDeactivate,
  onReactivate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserSummary | null;
  activeUsers: UserSummary[];
  identityEvidence: UserIdentityEvidence | null;
  pending: boolean;
  onDeactivate: (draft: LifecycleDraft) => Promise<void>;
  onReactivate: (reason: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LifecycleDraft>(() =>
    initialDraft(user, activeUsers)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inactive = user?.lifecycleStatus === "inactive";

  useEffect(() => {
    if (!open || !user) return;
    setDraft(initialDraft(user, activeUsers));
    setSubmitError(null);
  }, [activeUsers, open, user]);

  const previewQuery = useQuery({
    queryKey: [
      "forge-user-deactivation-preview",
      user?.id,
      draft.replacementUserId
    ],
    queryFn: () =>
      getUserDeactivationPreview(user!.id, draft.replacementUserId),
    enabled:
      open && Boolean(user) && !inactive && draft.replacementUserId.length > 0
  });
  const preview = previewQuery.data?.preview ?? null;
  const replacement = useMemo(
    () =>
      activeUsers.find(
        (candidate) => candidate.id === draft.replacementUserId
      ) ?? null,
    [activeUsers, draft.replacementUserId]
  );

  if (!user) return null;

  const evidenceStep: QuestionFlowStep<LifecycleDraft> = {
    id: "identity",
    eyebrow: inactive ? "Inactive identity" : "Identity evidence",
    title: inactive
      ? "Review the inactive identity"
      : "Confirm the identity and trust boundary",
    description:
      "Forge keeps historical attribution, but active sessions, tokens, ownership, and assignments must follow the current lifecycle state.",
    render: () => (
      <div className="grid gap-4">
        <div className={panelClass}>
          <UserBadge user={user} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="meta">{user.kind}</Badge>
            <Badge tone="meta">{user.lifecycleStatus ?? "active"}</Badge>
            {identityEvidence ? (
              <>
                <Badge tone="meta">{identityEvidence.trustState}</Badge>
                <Badge tone="meta">
                  {identityEvidence.connectedSessionCount} connected
                </Badge>
              </>
            ) : null}
          </div>
          {identityEvidence?.actorLabels.length ? (
            <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">
              Runtime actors: {identityEvidence.actorLabels.join(", ")}
            </div>
          ) : null}
        </div>
        {inactive && user.lifecycleReason ? (
          <div className={panelClass}>
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Last lifecycle decision
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {user.lifecycleReason}
            </div>
          </div>
        ) : null}
      </div>
    )
  };

  const activeSteps: Array<QuestionFlowStep<LifecycleDraft>> = [
    evidenceStep,
    {
      id: "transfer",
      eyebrow: "Transfer",
      title: "Choose the active replacement",
      description:
        "Forge transfers every generic owner and assignment atomically, redirects ownership defaults, disconnects selected bot sessions, revokes linked tokens, and then marks this identity inactive.",
      render: (value, setValue) => (
        <div className="grid gap-4">
          <FlowField
            label="Replacement user"
            description="The replacement must remain active and cannot be the user being deactivated."
          >
            <FlowChoiceGrid
              columns={2}
              value={value.replacementUserId}
              onChange={(replacementUserId) => setValue({ replacementUserId })}
              options={activeUsers
                .filter((candidate) => candidate.id !== user.id)
                .map((candidate) => ({
                  value: candidate.id,
                  label: candidate.displayName,
                  description: `@${candidate.handle} · ${candidate.kind}`
                }))}
            />
          </FlowField>
          {previewQuery.isLoading ? (
            <div className={panelClass}>Calculating the transfer preview…</div>
          ) : preview ? (
            <PreviewSummary preview={preview} />
          ) : null}
          {preview?.activeRuntimeSessions ? (
            <label className={`${panelClass} flex min-h-11 items-start gap-3`}>
              <input
                type="checkbox"
                checked={value.disconnectActiveSessions}
                onChange={(event) =>
                  setValue({ disconnectActiveSessions: event.target.checked })
                }
              />
              <span className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                Disconnect the {preview.activeRuntimeSessions} active runtime
                session(s) as part of this atomic lifecycle change.
              </span>
            </label>
          ) : null}
        </div>
      )
    },
    {
      id: "reason",
      eyebrow: "Decision record",
      title: "Explain why this identity is being deactivated",
      description:
        "This reason is retained with the actor, source, transfer counts, and idempotent receipt so the decision remains auditable.",
      render: (value, setValue) => (
        <FlowField label="Reason">
          <Textarea
            value={value.reason}
            onChange={(event) => setValue({ reason: event.target.value })}
            className="min-h-36"
            placeholder="The collaborator left the project; move current responsibility to the project owner."
          />
        </FlowField>
      )
    },
    {
      id: "review",
      eyebrow: "Final review",
      title: "Review the atomic lifecycle change",
      description:
        "Nothing is deleted. Historical attribution remains attached to the inactive identity.",
      render: () => (
        <div className="grid gap-4">
          <div className={panelClass}>
            <div className="flex flex-wrap items-center gap-3">
              <UserBadge user={user} />
              <span className="text-[var(--ui-ink-faint)]">→</span>
              <UserBadge user={replacement} />
            </div>
          </div>
          {preview ? <PreviewSummary preview={preview} /> : null}
        </div>
      )
    }
  ];

  const inactiveSteps: Array<QuestionFlowStep<LifecycleDraft>> = [
    evidenceStep,
    {
      id: "reactivate",
      eyebrow: "Reactivate",
      title: "Record why this identity is returning",
      description:
        "Reactivation restores the user to active selection. Revoked agent tokens stay revoked and must be rotated deliberately.",
      render: (value, setValue) => (
        <FlowField label="Reason">
          <Textarea
            value={value.reason}
            onChange={(event) => setValue({ reason: event.target.value })}
            className="min-h-36"
            placeholder="This collaborator has returned and may receive new ownership again."
          />
        </FlowField>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="User lifecycle"
      title={
        inactive
          ? `Reactivate ${user.displayName}`
          : `Deactivate ${user.displayName}`
      }
      description="Move responsibility without erasing history or leaving an agent identity able to act after deactivation."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={`users.lifecycle.${user.id}.${inactive ? "reactivate" : "deactivate"}`}
      steps={inactive ? inactiveSteps : activeSteps}
      submitLabel={inactive ? "Reactivate user" : "Transfer and deactivate"}
      pending={pending}
      pendingLabel={
        inactive ? "Reactivating user" : "Transferring responsibility"
      }
      error={submitError}
      contentClassName="lg:w-[min(64rem,calc(100vw-1.5rem))]"
      onSubmit={async () => {
        if (!draft.reason.trim()) {
          setSubmitError(
            "Add the lifecycle decision reason before continuing."
          );
          return;
        }
        if (!inactive) {
          if (!preview || !preview.canDeactivate) {
            setSubmitError(
              preview?.blockers[0] ?? "Choose a valid active replacement user."
            );
            return;
          }
          if (
            preview.requiresSessionDisconnect &&
            !draft.disconnectActiveSessions
          ) {
            setSubmitError(
              "Confirm that the active runtime sessions should be disconnected."
            );
            return;
          }
        }
        try {
          if (inactive) {
            await onReactivate(draft.reason.trim());
          } else {
            await onDeactivate({ ...draft, reason: draft.reason.trim() });
          }
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Forge could not apply the lifecycle change."
          );
        }
      }}
    />
  );
}
