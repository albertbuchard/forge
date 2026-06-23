import { useEffect, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import type {
  UserAccessGrant,
  UserKind,
  UserOwnershipSummary,
  UserSummary,
  UserXpSummary
} from "@/lib/types";
import {
  buildGrantCapabilitySummary,
  countEnabledRights,
  summarizeGrant,
  TOTAL_RIGHTS
} from "@/components/users/user-relationship-graph";

const userDialogPanelClass =
  "rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const userDialogTitleClass = "text-sm font-medium text-[var(--ui-ink-strong)]";
const userDialogBodyClass = "text-sm leading-6 text-[var(--ui-ink-soft)]";
const userDialogFaintClass = "text-xs leading-5 text-[var(--ui-ink-faint)]";

export type UserDraft = {
  kind: UserKind;
  handle: string;
  displayName: string;
  description: string;
  accentColor: string;
};

const DEFAULT_USER_DRAFT: UserDraft = {
  kind: "human",
  handle: "",
  displayName: "",
  description: "",
  accentColor: "#c0c1ff"
};

function userToDraft(user: UserSummary | null): UserDraft {
  if (!user) {
    return DEFAULT_USER_DRAFT;
  }
  return {
    kind: user.kind,
    handle: user.handle,
    displayName: user.displayName,
    description: user.description,
    accentColor: user.accentColor
  };
}

export function UserSettingsFlowDialog({
  open,
  onOpenChange,
  user,
  grants,
  ownership,
  xp,
  pending = false,
  onSubmit,
  onOpenRelationship
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserSummary | null;
  grants: UserAccessGrant[];
  ownership?: UserOwnershipSummary | null;
  xp?: UserXpSummary | null;
  pending?: boolean;
  onSubmit: (input: { input: UserDraft; userId?: string }) => Promise<void>;
  onOpenRelationship: (grantId: string) => void;
}) {
  const [draft, setDraft] = useState<UserDraft>(() => userToDraft(user));
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(userToDraft(user));
    setSubmitError(null);
  }, [open, user]);

  const directionalGrants = useMemo(
    () => grants.filter((grant) => grant.subjectUserId !== grant.targetUserId),
    [grants]
  );
  const outboundGrants = useMemo(
    () =>
      user
        ? directionalGrants.filter((grant) => grant.subjectUserId === user.id)
        : [],
    [directionalGrants, user]
  );
  const inboundGrants = useMemo(
    () =>
      user
        ? directionalGrants.filter((grant) => grant.targetUserId === user.id)
        : [],
    [directionalGrants, user]
  );

  const steps: Array<QuestionFlowStep<UserDraft>> = [
    {
      id: "identity",
      eyebrow: user ? "Edit user" : "Create user",
      title: user ? "Update the user identity" : "Add a human or bot user",
      description:
        "Set the owner type and the public identity Forge will use across ownership, routing, and collaboration surfaces.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Kind"
            description="Humans represent real people. Bots represent agents or automations with their own ownership lane."
          >
            <FlowChoiceGrid
              columns={2}
              value={value.kind}
              onChange={(kind) => setValue({ kind: kind as UserKind })}
              options={[
                {
                  value: "human",
                  label: "Human",
                  description: "Use for a real person in the Forge runtime."
                },
                {
                  value: "bot",
                  label: "Bot",
                  description:
                    "Use for an agent, assistant, or automation actor."
                }
              ]}
            />
          </FlowField>

          <FlowField
            label="Handle"
            description="This becomes the stable short id shown as @handle."
            hint="Use lowercase and a durable label, for example forge-operator or planner-bot."
          >
            <Input
              value={value.handle}
              onChange={(event) => setValue({ handle: event.target.value })}
              placeholder="forge-operator"
            />
          </FlowField>

          <FlowField
            label="Display name"
            description="This is the human-readable label used across the UI."
          >
            <Input
              value={value.displayName}
              onChange={(event) =>
                setValue({ displayName: event.target.value })
              }
              placeholder="Forge Operator"
            />
          </FlowField>
        </>
      )
    },
    {
      id: "profile",
      eyebrow: "Profile",
      title: "Describe the user lane",
      description:
        "Capture what this user represents in the shared Forge runtime and pick the accent color that helps the lane stay recognizable.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Description"
            description="Explain what this user is responsible for and what side of the system it represents."
          >
            <Textarea
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              className="min-h-36"
              placeholder="Primary human operator for strategy, execution, and review."
            />
          </FlowField>

          <FlowField
            label="Accent color"
            description="Forge uses this accent to help the user stand out in ownership and collaboration surfaces."
          >
            <div className="flex items-center gap-3">
              <Input
                value={value.accentColor}
                onChange={(event) =>
                  setValue({ accentColor: event.target.value })
                }
                placeholder="#c0c1ff"
              />
              <div
                className="size-10 shrink-0 rounded-full border border-[var(--ui-border-subtle)]"
                style={{ backgroundColor: value.accentColor || "#c0c1ff" }}
              />
            </div>
          </FlowField>

          <div className="grid gap-3 md:grid-cols-3">
            <div className={`${userDialogPanelClass} px-4 py-3`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Owned records
              </div>
              <div className="mt-2 text-[var(--ui-ink-strong)]">
                {ownership?.totalOwnedEntities ?? 0}
              </div>
            </div>
            <div className={`${userDialogPanelClass} px-4 py-3`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Total XP
              </div>
              <div className="mt-2 text-[var(--ui-ink-strong)]">
                {xp?.totalXp ?? 0}
              </div>
            </div>
            <div className={`${userDialogPanelClass} px-4 py-3`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Weekly XP
              </div>
              <div className="mt-2 text-[var(--ui-ink-strong)]">
                {xp?.weeklyXp ?? 0}
              </div>
            </div>
          </div>
        </>
      )
    },
    {
      id: "relationships",
      eyebrow: "Relationships",
      title: "Open directional relationship settings",
      description:
        "Each arrow is a separate contract. Open the exact lane you want to adjust and Forge will take you into the relationship flow.",
      render: () =>
        user ? (
          <>
            <div className={`${userDialogPanelClass} p-4`}>
              <UserBadge user={user} />
              <div className={`mt-3 ${userDialogBodyClass}`}>
                @{user.handle} · {user.description || "No description yet."}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-3">
                <div className={userDialogTitleClass}>Outbound lanes</div>
                {outboundGrants.length > 0 ? (
                  outboundGrants.map((grant) => (
                    <button
                      key={grant.id}
                      type="button"
                      className={`${userDialogPanelClass} px-4 py-4 text-left transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]`}
                      onClick={() => onOpenRelationship(grant.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <UserBadge user={grant.subjectUser} />
                        <span className="text-[var(--ui-ink-faint)]">→</span>
                        <UserBadge user={grant.targetUser} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge tone="meta">{summarizeGrant(grant)}</Badge>
                        <Badge tone="meta">
                          {countEnabledRights(grant)}/{TOTAL_RIGHTS} rights
                        </Badge>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-4 text-sm text-[var(--ui-ink-soft)]">
                    No outbound relationship lanes yet.
                  </div>
                )}
              </div>

              <div className="grid gap-3">
                <div className={userDialogTitleClass}>Inbound lanes</div>
                {inboundGrants.length > 0 ? (
                  inboundGrants.map((grant) => (
                    <button
                      key={grant.id}
                      type="button"
                      className={`${userDialogPanelClass} px-4 py-4 text-left transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]`}
                      onClick={() => onOpenRelationship(grant.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <UserBadge user={grant.subjectUser} />
                        <span className="text-[var(--ui-ink-faint)]">→</span>
                        <UserBadge user={grant.targetUser} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {buildGrantCapabilitySummary(grant).map(
                          (capability) => (
                            <Badge
                              key={`${grant.id}-${capability.id}`}
                              className={
                                capability.enabled
                                  ? "bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]"
                                  : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-faint)] opacity-70"
                              }
                            >
                              {capability.label}
                            </Badge>
                          )
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-4 text-sm text-[var(--ui-ink-soft)]">
                    No inbound relationship lanes yet.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
            Create the user first, then Forge will generate the directional
            relationship lanes you can tune from here.
          </div>
        )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={user ? "User settings" : "Create user"}
      title={user ? "User settings" : "Create user"}
      description="Edit the user identity, clarify what this lane represents, and jump into relationship settings without crowding the page."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={
        user ? `users.settings.${user.id}` : "users.settings.new"
      }
      steps={steps}
      submitLabel={user ? "Save user" : "Create user"}
      pending={pending}
      pendingLabel={user ? "Saving user" : "Creating user"}
      error={submitError}
      contentClassName="lg:w-[min(58rem,calc(100vw-1.5rem))]"
      onSubmit={async () => {
        const nextHandle = draft.handle.trim();
        const nextDisplayName = draft.displayName.trim();
        if (nextHandle.length === 0) {
          setSubmitError("Add a handle before saving this user.");
          return;
        }
        if (nextDisplayName.length === 0) {
          setSubmitError("Add a display name before saving this user.");
          return;
        }

        await onSubmit({
          userId: user?.id,
          input: {
            kind: draft.kind,
            handle: nextHandle,
            displayName: nextDisplayName,
            description: draft.description.trim(),
            accentColor: draft.accentColor.trim() || "#c0c1ff"
          }
        });
        onOpenChange(false);
      }}
    />
  );
}
