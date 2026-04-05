import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { UserBadge } from "@/components/ui/user-badge";
import type { UserAccessGrant, UserSummary } from "@/lib/types";

type GrantRightKey = keyof UserAccessGrant["config"]["rights"];

type RightGroup = {
  id: string;
  label: string;
  description: string;
  rights: Array<{
    key: GrantRightKey;
    label: string;
    description: string;
  }>;
};

const RIGHT_GROUPS: RightGroup[] = [
  {
    id: "visibility",
    label: "Discovery and visibility",
    description:
      "What the source user can discover, inspect, and pull into read flows on the target side.",
    rights: [
      {
        key: "discoverable",
        label: "Discoverable",
        description:
          "The target appears as a reachable collaborator in the source user's graph and pickers."
      },
      {
        key: "canListUsers",
        label: "List users",
        description:
          "The source user can include the target in directory, comparison, and routing surfaces."
      },
      {
        key: "canReadProfile",
        label: "Read profile",
        description:
          "The source user can inspect the target's identity card, handle, type, and description."
      },
      {
        key: "canReadEntities",
        label: "Read entities",
        description:
          "The source user can read the target's goals, projects, tasks, notes, strategies, and related records."
      },
      {
        key: "canSearchEntities",
        label: "Search entities",
        description:
          "The source user can find the target's work through Forge search and entity pickers."
      }
    ]
  },
  {
    id: "coordination",
    label: "Messaging, context, and handoff",
    description:
      "What the source user can message, connect, and coordinate on the target side before changing execution.",
    rights: [
      {
        key: "canLinkEntities",
        label: "Share context",
        description:
          "The source user can attach the target's records into shared notes, strategies, calendar context, and cross-owner plans."
      },
      {
        key: "canCoordinate",
        label: "Message and coordinate",
        description:
          "The source user can communicate with the target through Forge, hand off work, and coordinate execution."
      },
      {
        key: "canViewMetrics",
        label: "View metrics",
        description:
          "The source user can inspect the target's XP, alignment, and progress metrics."
      },
      {
        key: "canViewActivity",
        label: "View activity",
        description:
          "The source user can inspect the target's activity stream, evidence, and execution trail."
      }
    ]
  },
  {
    id: "execution",
    label: "Plan and execution control",
    description:
      "What the source user can actually change on the target side once collaboration is trusted.",
    rights: [
      {
        key: "canManageStrategies",
        label: "Manage strategies",
        description:
          "The source user can draft and update strategies that belong to the target."
      },
      {
        key: "canCreateOnBehalf",
        label: "Create on behalf",
        description:
          "The source user can intentionally create new target-owned entities."
      },
      {
        key: "canAffectEntities",
        label: "Affect entities",
        description:
          "The source user can mutate work that belongs to the target."
      }
    ]
  }
];

const EDGE_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  rights: Partial<UserAccessGrant["config"]["rights"]>;
}> = [
  {
    id: "full_collab",
    label: "Full collaboration",
    description:
      "Use when two humans or agents can see, coordinate, plan, and change each other's work.",
    rights: {
      discoverable: true,
      canListUsers: true,
      canReadProfile: true,
      canReadEntities: true,
      canSearchEntities: true,
      canLinkEntities: true,
      canCoordinate: true,
      canAffectEntities: true,
      canManageStrategies: true,
      canCreateOnBehalf: true,
      canViewMetrics: true,
      canViewActivity: true
    }
  },
  {
    id: "coordination_only",
    label: "Coordinate only",
    description:
      "Use when the source user may see and coordinate with the target but should not directly mutate target-owned work.",
    rights: {
      discoverable: true,
      canListUsers: true,
      canReadProfile: true,
      canReadEntities: true,
      canSearchEntities: true,
      canLinkEntities: true,
      canCoordinate: true,
      canAffectEntities: false,
      canManageStrategies: true,
      canCreateOnBehalf: false,
      canViewMetrics: true,
      canViewActivity: true
    }
  },
  {
    id: "observe_only",
    label: "Observe only",
    description:
      "Use when the source user should keep visibility into the target without planning or execution control.",
    rights: {
      discoverable: true,
      canListUsers: true,
      canReadProfile: true,
      canReadEntities: true,
      canSearchEntities: true,
      canLinkEntities: false,
      canCoordinate: false,
      canAffectEntities: false,
      canManageStrategies: false,
      canCreateOnBehalf: false,
      canViewMetrics: true,
      canViewActivity: true
    }
  },
  {
    id: "hidden",
    label: "Hidden edge",
    description:
      "Use when this direction should stop discovering, reading, or acting on the target.",
    rights: {
      discoverable: false,
      canListUsers: false,
      canReadProfile: false,
      canReadEntities: false,
      canSearchEntities: false,
      canLinkEntities: false,
      canCoordinate: false,
      canAffectEntities: false,
      canManageStrategies: false,
      canCreateOnBehalf: false,
      canViewMetrics: false,
      canViewActivity: false
    }
  }
];

const TOTAL_RIGHTS = RIGHT_GROUPS.reduce(
  (sum, group) => sum + group.rights.length,
  0
);

function countEnabledRights(grant: UserAccessGrant) {
  return Object.values(grant.config.rights).filter(Boolean).length;
}

function summarizeGrant(grant: UserAccessGrant) {
  const labels = [];
  if (grant.config.rights.canReadEntities) {
    labels.push("See");
  }
  if (grant.config.rights.canCoordinate) {
    labels.push("Message");
  }
  if (grant.config.rights.canManageStrategies) {
    labels.push("Plan");
  }
  if (grant.config.rights.canAffectEntities) {
    labels.push("Affect");
  }
  return labels.join(" · ") || "Hidden";
}

function describeGrantTone(grant: UserAccessGrant) {
  if (
    !grant.config.rights.discoverable &&
    !grant.config.rights.canReadEntities
  ) {
    return "Hidden";
  }
  if (
    grant.config.rights.canAffectEntities &&
    grant.config.rights.canManageStrategies
  ) {
    return "Trusted";
  }
  if (
    grant.config.rights.canCoordinate ||
    grant.config.rights.canLinkEntities
  ) {
    return "Coordinated";
  }
  return "Observed";
}

function buildNodes(
  users: UserSummary[],
  options: {
    selectedUserId: string | null;
    selectedGrant: UserAccessGrant | null;
  }
): Node[] {
  const humans = users.filter((user) => user.kind === "human");
  const bots = users.filter((user) => user.kind === "bot");
  const groups = [
    { entries: humans, x: 72 },
    { entries: bots, x: 432 }
  ] as const;
  const highlightedUserIds = new Set(
    options.selectedGrant
      ? [
          options.selectedGrant.subjectUserId,
          options.selectedGrant.targetUserId
        ]
      : options.selectedUserId
        ? [options.selectedUserId]
        : []
  );

  return groups.flatMap((group) =>
    group.entries.map((user, index) => {
      const isHighlighted = highlightedUserIds.has(user.id);
      const isSelected = user.id === options.selectedUserId;
      return {
        id: user.id,
        position: { x: group.x, y: 52 + index * 140 },
        draggable: false,
        selectable: false,
        data: {
          label: (
            <div
              className={`min-w-[206px] rounded-[22px] border px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.28)] transition ${
                isSelected
                  ? "border-[rgba(244,185,122,0.45)] bg-[rgba(27,16,10,0.92)]"
                  : isHighlighted
                    ? "border-white/18 bg-[rgba(14,20,34,0.94)]"
                    : "border-white/10 bg-[rgba(9,15,28,0.92)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <UserBadge user={user} />
                <Badge className="bg-white/[0.08] text-white/65">
                  {user.kind}
                </Badge>
              </div>
              <div className="mt-3 text-xs text-white/52">@{user.handle}</div>
              <div className="mt-2 line-clamp-2 text-xs leading-5 text-white/46">
                {user.description || "No user description yet."}
              </div>
            </div>
          )
        },
        style: {
          background: "transparent",
          border: "none",
          padding: 0
        }
      };
    })
  );
}

function buildEdges(
  grants: UserAccessGrant[],
  selectedGrantId: string | null,
  selectedUserId: string | null
): Edge[] {
  return grants
    .filter((grant) => grant.subjectUserId !== grant.targetUserId)
    .map((grant) => {
      const isSelected = selectedGrantId === grant.id;
      const touchesSelectedUser =
        selectedUserId !== null &&
        (grant.subjectUserId === selectedUserId ||
          grant.targetUserId === selectedUserId);
      const enabledCount = countEnabledRights(grant);
      const stroke = isSelected
        ? "#f4b97a"
        : !grant.config.rights.discoverable &&
            !grant.config.rights.canReadEntities
          ? "rgba(248,113,113,0.55)"
          : touchesSelectedUser
            ? "rgba(192,193,255,0.78)"
            : "rgba(255,255,255,0.32)";
      return {
        id: grant.id,
        source: grant.subjectUserId,
        target: grant.targetUserId,
        label: `${summarizeGrant(grant)} · ${enabledCount}/${TOTAL_RIGHTS}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke
        },
        labelStyle: {
          fill: isSelected ? "#f4b97a" : "rgba(255,255,255,0.68)",
          fontSize: 11,
          fontWeight: 600
        },
        style: {
          stroke,
          strokeWidth: isSelected ? 2.5 : touchesSelectedUser ? 1.8 : 1.25
        },
        animated: isSelected
      };
    });
}

function presetMatchesGrant(
  grant: UserAccessGrant,
  preset: (typeof EDGE_PRESETS)[number]
) {
  return Object.entries(preset.rights).every(
    ([key, value]) => grant.config.rights[key as GrantRightKey] === value
  );
}

function grantPartnerLabels(
  grants: UserAccessGrant[],
  predicate: (grant: UserAccessGrant) => boolean
) {
  return grants
    .filter(predicate)
    .map((grant) => grant.targetUser?.displayName ?? grant.targetUserId);
}

function buildGrantCapabilitySummary(grant: UserAccessGrant) {
  return [
    {
      id: "see",
      label: "See",
      enabled:
        grant.config.rights.discoverable &&
        grant.config.rights.canReadEntities &&
        grant.config.rights.canSearchEntities
    },
    {
      id: "message",
      label: "Message",
      enabled: grant.config.rights.canCoordinate
    },
    {
      id: "share",
      label: "Share context",
      enabled: grant.config.rights.canLinkEntities
    },
    {
      id: "plan",
      label: "Plan",
      enabled: grant.config.rights.canManageStrategies
    },
    {
      id: "affect",
      label: "Affect",
      enabled:
        grant.config.rights.canAffectEntities ||
        grant.config.rights.canCreateOnBehalf
    }
  ];
}

export function UserRelationshipGraph({
  users,
  grants,
  pendingGrantId = null,
  onUpdateGrant
}: {
  users: UserSummary[];
  grants: UserAccessGrant[];
  pendingGrantId?: string | null;
  onUpdateGrant: (
    grantId: string,
    patch: Partial<{
      accessLevel: "view" | "manage";
      rights: Partial<UserAccessGrant["config"]["rights"]>;
    }>
  ) => Promise<void>;
}) {
  const defaultGrantId =
    grants.find((grant) => grant.subjectUserId !== grant.targetUserId)?.id ??
    null;
  const [selectedGrantId, setSelectedGrantId] = useState<string | null>(
    defaultGrantId
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    users[0]?.id ?? null
  );

  useEffect(() => {
    if (
      selectedGrantId !== null &&
      !grants.some((grant) => grant.id === selectedGrantId)
    ) {
      setSelectedGrantId(defaultGrantId);
    }
  }, [defaultGrantId, grants, selectedGrantId]);

  useEffect(() => {
    if (!selectedUserId || !users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(users[0]?.id ?? null);
    }
  }, [selectedUserId, users]);

  const selectedGrant =
    grants.find((grant) => grant.id === selectedGrantId) ?? null;
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const reverseGrant =
    selectedGrant === null
      ? null
      : (grants.find(
          (grant) =>
            grant.subjectUserId === selectedGrant.targetUserId &&
            grant.targetUserId === selectedGrant.subjectUserId
        ) ?? null);

  const nodes = useMemo(
    () => buildNodes(users, { selectedUserId, selectedGrant }),
    [selectedGrant, selectedUserId, users]
  );
  const edges = useMemo(
    () => buildEdges(grants, selectedGrantId, selectedUserId),
    [grants, selectedGrantId, selectedUserId]
  );

  const directionalGrants = useMemo(
    () => grants.filter((grant) => grant.subjectUserId !== grant.targetUserId),
    [grants]
  );
  const selectedUserOutgoing = useMemo(
    () =>
      directionalGrants.filter(
        (grant) => grant.subjectUserId === selectedUserId
      ),
    [directionalGrants, selectedUserId]
  );
  const selectedUserIncoming = useMemo(
    () =>
      directionalGrants.filter(
        (grant) => grant.targetUserId === selectedUserId
      ),
    [directionalGrants, selectedUserId]
  );
  const fullyOpenEdges = directionalGrants.filter(
    (grant) => countEnabledRights(grant) === TOTAL_RIGHTS
  ).length;
  const coordinationEdges = directionalGrants.filter(
    (grant) => grant.config.rights.canCoordinate
  ).length;
  const executionEdges = directionalGrants.filter(
    (grant) =>
      grant.config.rights.canAffectEntities ||
      grant.config.rights.canCreateOnBehalf
  ).length;

  const selectedGrantRatio = selectedGrant
    ? Math.round((countEnabledRights(selectedGrant) / TOTAL_RIGHTS) * 100)
    : 0;
  const reverseGrantRatio = reverseGrant
    ? Math.round((countEnabledRights(reverseGrant) / TOTAL_RIGHTS) * 100)
    : 0;

  const applyRightsPatch = async (
    nextGrant: UserAccessGrant,
    rights: Partial<UserAccessGrant["config"]["rights"]>
  ) => {
    await onUpdateGrant(nextGrant.id, { rights });
  };

  const applyRightsToPair = async (
    rights: Partial<UserAccessGrant["config"]["rights"]>
  ) => {
    if (!selectedGrant) {
      return;
    }
    await applyRightsPatch(selectedGrant, rights);
    if (reverseGrant) {
      await applyRightsPatch(reverseGrant, rights);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.92fr)]">
      <Card className="overflow-hidden p-0">
        <div className="grid gap-4 border-b border-white/8 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Directed relationship graph
              </div>
              <div className="mt-1 text-sm leading-6 text-white/58">
                Nodes are humans or bots. Each arrow is one directional
                contract: `A → B` defines what `A` can see, coordinate, plan, or
                change on `B`.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-white/[0.08] text-white/70">
                {directionalGrants.length} edges
              </Badge>
              <Badge className="bg-emerald-500/12 text-emerald-200">
                {fullyOpenEdges} fully open
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                Full collaboration
              </div>
              <div className="mt-2 text-lg text-white">{fullyOpenEdges}</div>
              <div className="text-xs leading-5 text-white/48">
                Directions still running with the default fully open posture.
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                Coordination lanes
              </div>
              <div className="mt-2 text-lg text-white">{coordinationEdges}</div>
              <div className="text-xs leading-5 text-white/48">
                Directions allowed to coordinate directly through Forge.
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
              <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                Execution control
              </div>
              <div className="mt-2 text-lg text-white">{executionEdges}</div>
              <div className="text-xs leading-5 text-white/48">
                Directions allowed to create or mutate target-owned work.
              </div>
            </div>
          </div>
        </div>

        <div className="h-[680px] bg-[radial-gradient(circle_at_top,rgba(244,185,122,0.08),transparent_34%),linear-gradient(180deg,rgba(6,10,20,0.97),rgba(8,14,26,0.94))]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_event, node) => {
              setSelectedUserId(node.id);
              setSelectedGrantId(null);
            }}
            onEdgeClick={(_event, edge) => {
              setSelectedGrantId(edge.id);
              setSelectedUserId(edge.source);
            }}
            attributionPosition="bottom-left"
          >
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                users.find((user) => user.id === node.id)?.accentColor ??
                "#c0c1ff"
              }
            />
            <Controls showInteractive={false} />
            <Background gap={28} size={1} color="rgba(255,255,255,0.06)" />
          </ReactFlow>
        </div>
      </Card>

      <div className="grid gap-4">
        {selectedGrant ? (
          <Card className="grid gap-4">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Edge rights
              </div>
              <div className="mt-2 text-sm leading-6 text-white/58">
                Use presets for the common trust levels, then tune the
                individual rights only where that relationship needs a sharper
                boundary.
              </div>
            </div>

            <div className="rounded-[20px] bg-white/[0.04] px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <UserBadge user={selectedGrant.subjectUser} />
                <span className="text-white/45">→</span>
                <UserBadge user={selectedGrant.targetUser} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/74">
                  {describeGrantTone(selectedGrant)}
                </Badge>
                <Badge className="bg-white/[0.08] text-white/74">
                  {selectedGrant.accessLevel}
                </Badge>
                <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                  {countEnabledRights(selectedGrant)}/{TOTAL_RIGHTS} rights
                  enabled
                </Badge>
              </div>
              <div className="mt-4">
                <ProgressMeter value={selectedGrantRatio} />
              </div>
            </div>

            <div className="grid gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Pair contract
                </div>
                <div className="mt-1 text-xs leading-5 text-white/48">
                  Read the two arrows separately. `A → B` answers what A can see
                  or do to B. `B → A` may stay different.
                </div>
              </div>
              <div className="grid gap-3">
                {[
                  {
                    grant: selectedGrant,
                    ratio: selectedGrantRatio,
                    active: true
                  },
                  ...(reverseGrant
                    ? [
                        {
                          grant: reverseGrant,
                          ratio: reverseGrantRatio,
                          active: false
                        }
                      ]
                    : [])
                ].map(({ grant, ratio, active }) => (
                  <button
                    key={grant.id}
                    type="button"
                    className={`rounded-[18px] border px-4 py-4 text-left transition ${
                      active
                        ? "border-[rgba(244,185,122,0.32)] bg-[rgba(244,185,122,0.08)]"
                        : "border-white/8 bg-white/[0.03] hover:bg-white/[0.05]"
                    }`}
                    onClick={() => {
                      setSelectedGrantId(grant.id);
                      setSelectedUserId(grant.subjectUserId);
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <UserBadge user={grant.subjectUser} />
                      <span className="text-white/45">→</span>
                      <UserBadge user={grant.targetUser} />
                      <Badge className="bg-white/[0.08] text-white/70">
                        {describeGrantTone(grant)}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {buildGrantCapabilitySummary(grant).map((capability) => (
                        <Badge
                          key={`${grant.id}-${capability.id}`}
                          className={
                            capability.enabled
                              ? "bg-white/[0.08] text-white/78"
                              : "bg-white/[0.04] text-white/38"
                          }
                        >
                          {capability.label}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3">
                      <ProgressMeter value={ratio} />
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {reverseGrant ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pendingGrantId === selectedGrant.id}
                    onClick={() => {
                      void applyRightsPatch(
                        reverseGrant,
                        selectedGrant.config.rights
                      );
                    }}
                  >
                    Mirror to reverse arrow
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pendingGrantId === selectedGrant.id}
                  onClick={() => {
                    void applyRightsToPair(EDGE_PRESETS[0]!.rights);
                  }}
                >
                  Open both directions
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pendingGrantId === selectedGrant.id}
                  onClick={() => {
                    void applyRightsToPair(EDGE_PRESETS[2]!.rights);
                  }}
                >
                  Observe both ways
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Quick presets
              </div>
              <div className="grid gap-2">
                {EDGE_PRESETS.map((preset) => (
                  <div
                    key={preset.id}
                    className={`rounded-[18px] border px-4 py-3 transition ${
                      presetMatchesGrant(selectedGrant, preset)
                        ? "border-[rgba(244,185,122,0.42)] bg-[rgba(244,185,122,0.10)]"
                        : "border-white/8 bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          {preset.label}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-white/50">
                          {preset.description}
                        </div>
                      </div>
                      {presetMatchesGrant(selectedGrant, preset) ? (
                        <Badge className="bg-white/[0.08] text-white/72">
                          Active
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={pendingGrantId === selectedGrant.id}
                        onClick={() => {
                          void applyRightsPatch(selectedGrant, preset.rights);
                        }}
                      >
                        This arrow
                      </Button>
                      {reverseGrant ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={pendingGrantId === selectedGrant.id}
                          onClick={() => {
                            void applyRightsToPair(preset.rights);
                          }}
                        >
                          Both arrows
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {RIGHT_GROUPS.map((group) => (
              <div key={group.id} className="grid gap-3">
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                    {group.label}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-white/48">
                    {group.description}
                  </div>
                </div>
                <div className="grid gap-2">
                  {group.rights.map((right) => {
                    const checked = selectedGrant.config.rights[right.key];
                    return (
                      <label
                        key={right.key}
                        className="flex items-start justify-between gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3"
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
                          checked={checked}
                          disabled={pendingGrantId === selectedGrant.id}
                          onChange={(event) => {
                            void onUpdateGrant(selectedGrant.id, {
                              rights: {
                                [right.key]: event.target.checked
                              }
                            });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        ) : null}

        {selectedUser ? (
          <Card className="grid gap-4">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                User lane summary
              </div>
              <div className="mt-2 text-sm leading-6 text-white/58">
                Click any node to inspect the user's inbound and outbound trust
                lanes. Click any arrow to edit that exact direction.
              </div>
            </div>

            <div className="rounded-[20px] bg-white/[0.04] px-4 py-4">
              <UserBadge user={selectedUser} />
              <div className="mt-3 text-sm leading-6 text-white/56">
                @{selectedUser.handle} ·{" "}
                {selectedUser.description || "No description yet."}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                  Outbound lanes
                </div>
                <div className="mt-2 text-lg text-white">
                  {selectedUserOutgoing.length}
                </div>
                <div className="text-xs leading-5 text-white/48">
                  Directions where this user can inspect or act on others.
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-3">
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                  Inbound lanes
                </div>
                <div className="mt-2 text-lg text-white">
                  {selectedUserIncoming.length}
                </div>
                <div className="text-xs leading-5 text-white/48">
                  Directions where other users can inspect or act on this user.
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-4">
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                  This user can message
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {grantPartnerLabels(
                    selectedUserOutgoing,
                    (grant) => grant.config.rights.canCoordinate
                  ).length > 0 ? (
                    grantPartnerLabels(
                      selectedUserOutgoing,
                      (grant) => grant.config.rights.canCoordinate
                    ).map((label) => (
                      <Badge
                        key={`out-${selectedUser.id}-${label}`}
                        className="bg-white/[0.08] text-white/74"
                      >
                        {label}
                      </Badge>
                    ))
                  ) : (
                    <div className="text-sm text-white/52">
                      No active messaging or coordination lanes from this user
                      yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[18px] bg-white/[0.04] px-4 py-4">
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                  Others can affect this user
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedUserIncoming.filter(
                    (grant) => grant.config.rights.canAffectEntities
                  ).length > 0 ? (
                    selectedUserIncoming
                      .filter((grant) => grant.config.rights.canAffectEntities)
                      .map((grant) => (
                        <Badge
                          key={`in-${grant.id}`}
                          className="bg-white/[0.08] text-white/74"
                        >
                          {grant.subjectUser?.displayName ??
                            grant.subjectUserId}
                        </Badge>
                      ))
                  ) : (
                    <div className="text-sm text-white/52">
                      No other user can directly mutate this user's work.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedGrant ? null : (
              <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-4 text-sm leading-6 text-white/52">
                Select an arrow to edit the exact directional rights from one
                user to another. The graph defaults to full collaboration so
                onboarding stays easy, then narrows only where a boundary is
                intentional.
              </div>
            )}
          </Card>
        ) : null}

        {selectedGrant && selectedUser ? (
          <Card className="grid gap-3">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Shared-runtime rule
            </div>
            <div className="text-sm leading-6 text-white/58">
              Keep OpenClaw, Hermes, and the Forge UI on the same runtime and
              storage root when these lanes should describe one shared human and
              bot system. The graph stays directional, but the runtime stays
              single-source.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSelectedGrantId(null)}
              >
                Inspect user lane
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
