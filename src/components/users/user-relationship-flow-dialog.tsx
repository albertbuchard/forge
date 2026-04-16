import { useEffect, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { UserBadge } from "@/components/ui/user-badge";
import type { UserAccessGrant } from "@/lib/types";
import {
  buildGrantCapabilitySummary,
  countEnabledRights,
  describeGrantTone,
  EDGE_PRESETS,
  presetMatchesGrant,
  RIGHT_GROUPS,
  TOTAL_RIGHTS
} from "@/components/users/user-relationship-graph";

type RelationshipDraft = {
  accessLevel: "view" | "manage";
  applyScope: "this_arrow" | "both_arrows";
  rights: UserAccessGrant["config"]["rights"];
};

function buildInitialDraft(
  grant: UserAccessGrant | null,
  hasReverseGrant: boolean
): RelationshipDraft {
  return {
    accessLevel: grant?.accessLevel ?? "manage",
    applyScope: hasReverseGrant ? "this_arrow" : "this_arrow",
    rights: {
      discoverable: grant?.config.rights.discoverable ?? true,
      canListUsers: grant?.config.rights.canListUsers ?? true,
      canReadProfile: grant?.config.rights.canReadProfile ?? true,
      canReadEntities: grant?.config.rights.canReadEntities ?? true,
      canSearchEntities: grant?.config.rights.canSearchEntities ?? true,
      canLinkEntities: grant?.config.rights.canLinkEntities ?? true,
      canCoordinate: grant?.config.rights.canCoordinate ?? true,
      canAffectEntities: grant?.config.rights.canAffectEntities ?? true,
      canManageStrategies: grant?.config.rights.canManageStrategies ?? true,
      canCreateOnBehalf: grant?.config.rights.canCreateOnBehalf ?? true,
      canViewMetrics: grant?.config.rights.canViewMetrics ?? true,
      canViewActivity: grant?.config.rights.canViewActivity ?? true
    }
  };
}

export function UserRelationshipFlowDialog({
  open,
  onOpenChange,
  grant,
  grants,
  pending = false,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grant: UserAccessGrant | null;
  grants: UserAccessGrant[];
  pending?: boolean;
  onSubmit: (input: {
    grantId: string;
    patch: {
      accessLevel: "view" | "manage";
      rights: UserAccessGrant["config"]["rights"];
    };
    reverseGrantId: string | null;
    applyToReverse: boolean;
  }) => Promise<void>;
}) {
  const reverseGrant = useMemo(
    () =>
      grant
        ? (grants.find(
            (candidate) =>
              candidate.subjectUserId === grant.targetUserId &&
              candidate.targetUserId === grant.subjectUserId
          ) ?? null)
        : null,
    [grant, grants]
  );
  const [draft, setDraft] = useState<RelationshipDraft>(() =>
    buildInitialDraft(grant, Boolean(reverseGrant))
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(buildInitialDraft(grant, Boolean(reverseGrant)));
  }, [grant, open, reverseGrant]);

  const rightsEnabledCount = useMemo(
    () => Object.values(draft.rights).filter(Boolean).length,
    [draft.rights]
  );
  const rightsRatio = Math.round((rightsEnabledCount / TOTAL_RIGHTS) * 100);

  const steps: Array<QuestionFlowStep<RelationshipDraft>> = [
    {
      id: "posture",
      eyebrow: "Relationship posture",
      title: "Set the trust mode for this arrow",
      description:
        "Each arrow is directional. Decide whether you want to tune only this lane or mirror the same contract onto both directions.",
      render: (value, setValue) => (
        <>
          {grant ? (
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <UserBadge user={grant.subjectUser} />
                <span className="text-white/45">→</span>
                <UserBadge user={grant.targetUser} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/74">
                  {describeGrantTone(grant)}
                </Badge>
                <Badge className="bg-white/[0.08] text-white/74">
                  {countEnabledRights(grant)}/{TOTAL_RIGHTS} rights
                </Badge>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-3">
              <div className="text-sm font-medium text-white">Access level</div>
              <FlowChoiceGrid
                columns={2}
                value={value.accessLevel}
                onChange={(accessLevel) =>
                  setValue({ accessLevel: accessLevel as "view" | "manage" })
                }
                options={[
                  {
                    value: "view",
                    label: "View",
                    description:
                      "Use when this lane should stay mostly observational."
                  },
                  {
                    value: "manage",
                    label: "Manage",
                    description:
                      "Use when the source side can actively collaborate or act."
                  }
                ]}
              />
            </div>

            {reverseGrant ? (
              <div className="grid gap-3">
                <div className="text-sm font-medium text-white">
                  Apply scope
                </div>
                <FlowChoiceGrid
                  columns={2}
                  value={value.applyScope}
                  onChange={(applyScope) =>
                    setValue({
                      applyScope: applyScope as "this_arrow" | "both_arrows"
                    })
                  }
                  options={[
                    {
                      value: "this_arrow",
                      label: "This arrow",
                      description: "Only change the exact direction you opened."
                    },
                    {
                      value: "both_arrows",
                      label: "Both arrows",
                      description:
                        "Mirror the same contract onto the reverse direction too."
                    }
                  ]}
                />
              </div>
            ) : null}
          </div>

          <div className="grid gap-3">
            <div className="text-sm font-medium text-white">Quick preset</div>
            <div className="grid gap-3 md:grid-cols-2">
              {EDGE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`rounded-[22px] border p-4 text-left transition ${
                    grant && presetMatchesGrant(grant, preset)
                      ? "border-[rgba(244,185,122,0.35)] bg-[rgba(244,185,122,0.08)]"
                      : "border-white/8 bg-white/[0.03] hover:bg-white/[0.05]"
                  }`}
                  onClick={() =>
                    setValue({ rights: { ...value.rights, ...preset.rights } })
                  }
                >
                  <div className="text-sm font-medium text-white">
                    {preset.label}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/56">
                    {preset.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )
    },
    {
      id: "rights",
      eyebrow: "Rights",
      title: "Tune the individual permissions",
      description:
        "Use the preset as the starting point, then sharpen the exact boundaries only where this relationship needs them.",
      render: (value, setValue) => (
        <>
          {RIGHT_GROUPS.map((group) => (
            <div key={group.id} className="grid gap-3">
              <div>
                <div className="text-sm font-medium text-white">
                  {group.label}
                </div>
                <div className="mt-1 text-sm leading-6 text-white/54">
                  {group.description}
                </div>
              </div>
              <div className="grid gap-2">
                {group.rights.map((right) => (
                  <label
                    key={right.key}
                    className="flex items-start justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-white">
                        {right.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/50">
                        {right.description}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={value.rights[right.key]}
                      onChange={(event) =>
                        setValue({
                          rights: {
                            ...value.rights,
                            [right.key]: event.target.checked
                          }
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </>
      )
    },
    {
      id: "review",
      eyebrow: "Review",
      title: "Review the final relationship contract",
      description:
        "Check the enabled capabilities, confirm whether both directions should match, and then save the relationship.",
      render: (value) => (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm font-medium text-white">
                Capability coverage
              </div>
              <div className="mt-4">
                <ProgressMeter value={rightsRatio} />
              </div>
              <div className="mt-3 text-sm text-white/62">
                {rightsEnabledCount}/{TOTAL_RIGHTS} rights enabled
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {buildGrantCapabilitySummary({
                  ...(grant ?? {
                    id: "draft",
                    subjectUserId: "",
                    targetUserId: "",
                    accessLevel: value.accessLevel,
                    config: {
                      self: false,
                      mutable: true,
                      linkedEntities: true,
                      rights: value.rights
                    },
                    createdAt: "",
                    updatedAt: "",
                    subjectUser: null,
                    targetUser: null
                  }),
                  accessLevel: value.accessLevel,
                  config: {
                    ...(grant?.config ?? {
                      self: false,
                      mutable: true,
                      linkedEntities: true
                    }),
                    rights: value.rights
                  }
                }).map((capability) => (
                  <Badge
                    key={capability.id}
                    className={
                      capability.enabled
                        ? "bg-white/[0.08] text-white/74"
                        : "bg-white/[0.04] text-white/38"
                    }
                  >
                    {capability.label}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm font-medium text-white">Save scope</div>
              <div className="mt-3 text-sm leading-6 text-white/58">
                {value.applyScope === "both_arrows" && reverseGrant
                  ? "Forge will apply the same access level and rights to both directions of this pair."
                  : "Forge will only update the exact arrow you opened."}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/74">
                  access {value.accessLevel}
                </Badge>
                <Badge className="bg-white/[0.08] text-white/74">
                  scope{" "}
                  {value.applyScope === "both_arrows" && reverseGrant
                    ? "both arrows"
                    : "this arrow"}
                </Badge>
              </div>
              {reverseGrant ? (
                <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/54">
                  Reverse arrow available:{" "}
                  {reverseGrant.subjectUser?.displayName ??
                    reverseGrant.subjectUserId}{" "}
                  →{" "}
                  {reverseGrant.targetUser?.displayName ??
                    reverseGrant.targetUserId}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Relationship settings"
      title="Relationship settings"
      description="Edit the exact directional contract between two users without keeping the full rights editor pinned on the page."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={
        grant ? `users.relationship.${grant.id}` : "users.relationship.new"
      }
      steps={steps}
      submitLabel="Save relationship"
      pending={pending}
      pendingLabel="Saving relationship"
      contentClassName="lg:w-[min(62rem,calc(100vw-1.5rem))]"
      onSubmit={async () => {
        if (!grant) {
          return;
        }
        await onSubmit({
          grantId: grant.id,
          patch: {
            accessLevel: draft.accessLevel,
            rights: draft.rights
          },
          reverseGrantId: reverseGrant?.id ?? null,
          applyToReverse:
            draft.applyScope === "both_arrows" && reverseGrant !== null
        });
        onOpenChange(false);
      }}
    />
  );
}
