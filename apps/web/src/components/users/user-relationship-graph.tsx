import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { UserBadge } from "@/components/ui/user-badge";
import type { UserAccessGrant, UserSummary } from "@/lib/types";

export type GrantRightKey = keyof UserAccessGrant["config"]["rights"];

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

export const RIGHT_GROUPS: RightGroup[] = [
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

export const EDGE_PRESETS: Array<{
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

export const TOTAL_RIGHTS = RIGHT_GROUPS.reduce(
  (sum, group) => sum + group.rights.length,
  0
);

export function countEnabledRights(grant: UserAccessGrant) {
  return Object.values(grant.config.rights).filter(Boolean).length;
}

export function summarizeGrant(grant: UserAccessGrant) {
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

export function describeGrantTone(grant: UserAccessGrant) {
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

export function buildGrantCapabilitySummary(grant: UserAccessGrant) {
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

export function presetMatchesGrant(
  grant: UserAccessGrant,
  preset: (typeof EDGE_PRESETS)[number]
) {
  return Object.entries(preset.rights).every(
    ([key, value]) => grant.config.rights[key as GrantRightKey] === value
  );
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
  const center = { x: 560, y: 360 };
  const nodeSize = { width: 226, height: 132 };
  const primaryHuman = humans[0] ?? null;
  const orbitingHumans = humans.slice(primaryHuman ? 1 : 0);
  const orbitingUsers = [
    ...orbitingHumans.map((user) => ({ user, radius: 245, offset: -90 })),
    ...bots.map((user) => ({ user, radius: 390, offset: -90 }))
  ];
  const totalOrbitingUsers = orbitingUsers.length;
  const positionedUsers = [
    ...(primaryHuman
      ? [
          {
            user: primaryHuman,
            position: {
              x: center.x - nodeSize.width / 2,
              y: center.y - nodeSize.height / 2
            }
          }
        ]
      : []),
    ...orbitingUsers.map((entry, index) => {
      const angle =
        ((entry.offset + (360 / Math.max(totalOrbitingUsers, 1)) * index) *
          Math.PI) /
        180;
      return {
        user: entry.user,
        position: {
          x: center.x + Math.cos(angle) * entry.radius - nodeSize.width / 2,
          y: center.y + Math.sin(angle) * entry.radius - nodeSize.height / 2
        }
      };
    })
  ];
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

  return positionedUsers.map(({ user, position }) => {
    const isHighlighted = highlightedUserIds.has(user.id);
    const isSelected = user.id === options.selectedUserId;
    return {
      id: user.id,
      position,
      draggable: false,
      selectable: false,
      data: {
        label: (
          <div
            className={`min-w-[206px] rounded-[22px] border px-4 py-4 shadow-[var(--ui-shadow-soft)] transition ${
              isSelected
                ? "border-[color-mix(in_srgb,var(--warning)_45%,var(--ui-border-subtle)_55%)] bg-[var(--ui-warning-soft)]"
                : isHighlighted
                  ? "border-[color-mix(in_srgb,var(--primary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-accent-soft)]"
                  : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <UserBadge user={user} />
              <Badge tone="meta">{user.kind}</Badge>
            </div>
            <div className="mt-3 text-xs text-[var(--ui-ink-soft)]">
              @{user.handle}
            </div>
            <div className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--ui-ink-faint)]">
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
  });
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
        ? "var(--warning)"
        : !grant.config.rights.discoverable &&
            !grant.config.rights.canReadEntities
          ? "var(--danger)"
          : touchesSelectedUser
            ? "var(--primary)"
            : "var(--ui-border-strong)";
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
          fill: isSelected ? "var(--warning)" : "var(--ui-ink-medium)",
          fontSize: 11,
          fontWeight: 600
        },
        labelBgStyle: {
          fill: isSelected ? "var(--ui-warning-soft)" : "var(--ui-surface-1)",
          stroke: isSelected
            ? "color-mix(in_srgb,var(--warning)_36%,var(--ui-border-subtle)_64%)"
            : "var(--ui-border-subtle)",
          strokeWidth: 1
        },
        labelBgPadding: [7, 5] as [number, number],
        labelBgBorderRadius: 8,
        style: {
          stroke,
          strokeWidth: isSelected ? 2.5 : touchesSelectedUser ? 1.8 : 1.25
        },
        animated: isSelected
      };
    });
}

export function UserRelationshipGraph({
  users,
  grants,
  selectedGrantId = null,
  selectedUserId = null,
  onOpenGrant,
  onOpenUser
}: {
  users: UserSummary[];
  grants: UserAccessGrant[];
  selectedGrantId?: string | null;
  selectedUserId?: string | null;
  onOpenGrant: (grantId: string) => void;
  onOpenUser: (userId: string) => void;
}) {
  const selectedGrant =
    grants.find((grant) => grant.id === selectedGrantId) ?? null;
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

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid gap-4 border-b border-[var(--ui-border-subtle)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Directed relationship graph
              </div>
              <InfoTooltip
                content="Keep Forge, OpenClaw, Hermes, and the browser on the same runtime and storage root when these arrows should describe one shared human and bot system."
                label="Explain the shared runtime rule"
              />
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Click a user card to open that user&apos;s settings. Click any
              arrow to open the exact directional relationship flow for that
              lane.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="meta">{directionalGrants.length} edges</Badge>
            <Badge className="bg-[var(--ui-success-soft)] text-[var(--success)]">
              {fullyOpenEdges} fully open
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
            <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Full collaboration
            </div>
            <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
              {fullyOpenEdges}
            </div>
            <div className="text-xs leading-5 text-[var(--ui-ink-faint)]">
              Directions still running with the default fully open posture.
            </div>
          </div>
          <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
            <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Coordination lanes
            </div>
            <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
              {coordinationEdges}
            </div>
            <div className="text-xs leading-5 text-[var(--ui-ink-faint)]">
              Directions allowed to coordinate directly through Forge.
            </div>
          </div>
          <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
            <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Execution control
            </div>
            <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
              {executionEdges}
            </div>
            <div className="text-xs leading-5 text-[var(--ui-ink-faint)]">
              Directions allowed to create or mutate target-owned work.
            </div>
          </div>
        </div>
      </div>

      <div className="h-[clamp(26rem,58vh,42rem)] bg-[linear-gradient(180deg,var(--ui-surface-2),var(--ui-surface-1))] sm:h-[min(72vh,54rem)] sm:min-h-[34rem]">
        <ReactFlow
          className="user-relationship-flow"
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 0.95 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => {
            onOpenUser(node.id);
          }}
          onEdgeClick={(_event, edge) => {
            onOpenGrant(edge.id);
          }}
          attributionPosition="bottom-left"
        >
          <Controls showInteractive={false} />
          <Background gap={28} size={1} color="var(--ui-border-subtle)" />
        </ReactFlow>
      </div>
    </Card>
  );
}
