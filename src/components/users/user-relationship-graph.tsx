import { useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UserBadge } from "@/components/ui/user-badge";
import type { UserAccessGrant, UserSummary } from "@/lib/types";

type GrantRightKey = keyof UserAccessGrant["config"]["rights"];

const RIGHT_LABELS: Array<{
  key: GrantRightKey;
  label: string;
  description: string;
}> = [
  {
    key: "canReadEntities",
    label: "Read entities",
    description: "A can read B's goals, projects, tasks, notes, strategies, and related records."
  },
  {
    key: "canSearchEntities",
    label: "Search",
    description: "A can find B-owned entities through Forge search and pickers."
  },
  {
    key: "canLinkEntities",
    label: "Link",
    description: "A can connect B-owned entities into notes, strategies, calendar links, and cross-user views."
  },
  {
    key: "canAffectEntities",
    label: "Affect",
    description: "A can create or mutate work that belongs to B."
  },
  {
    key: "canManageStrategies",
    label: "Manage strategies",
    description: "A can draft or update strategy plans that belong to B."
  },
  {
    key: "canCreateOnBehalf",
    label: "Create on behalf",
    description: "A can intentionally create new B-owned entities."
  },
  {
    key: "canViewMetrics",
    label: "View metrics",
    description: "A can inspect B's alignment, XP, and progress metrics."
  },
  {
    key: "canViewActivity",
    label: "View activity",
    description: "A can inspect B's activity and execution trace."
  },
  {
    key: "canListUsers",
    label: "List users",
    description: "A can include B in wider user-directory and comparison views."
  },
  {
    key: "canReadProfile",
    label: "Read profile",
    description: "A can inspect B's user card, handle, and descriptive metadata."
  },
  {
    key: "discoverable",
    label: "Discoverable",
    description: "B appears as a reachable user in A's directed relationship graph."
  }
];

function summarizeGrant(grant: UserAccessGrant) {
  const labels = [];
  if (grant.config.rights.canReadEntities) {
    labels.push("See");
  }
  if (grant.config.rights.canLinkEntities) {
    labels.push("Link");
  }
  if (grant.config.rights.canAffectEntities) {
    labels.push("Affect");
  }
  if (grant.config.rights.canManageStrategies) {
    labels.push("Plan");
  }
  return labels.join(" · ") || "No rights";
}

function buildNodes(users: UserSummary[]): Node[] {
  const humans = users.filter((user) => user.kind === "human");
  const bots = users.filter((user) => user.kind === "bot");
  const groups = [
    { entries: humans, x: 72 },
    { entries: bots, x: 432 }
  ] as const;

  return groups.flatMap((group) =>
    group.entries.map((user, index) => ({
      id: user.id,
      position: { x: group.x, y: 48 + index * 132 },
      draggable: false,
      selectable: false,
      data: {
        label: (
          <div className="min-w-[180px] rounded-[18px] border border-white/10 bg-[rgba(9,15,28,0.92)] px-3 py-3 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
            <UserBadge user={user} />
            <div className="mt-2 text-xs text-white/52">@{user.handle}</div>
          </div>
        )
      },
      style: {
        background: "transparent",
        border: "none",
        padding: 0
      }
    }))
  );
}

function buildEdges(
  grants: UserAccessGrant[],
  selectedGrantId: string | null
): Edge[] {
  return grants
    .filter((grant) => grant.subjectUserId !== grant.targetUserId)
    .map((grant) => ({
      id: grant.id,
      source: grant.subjectUserId,
      target: grant.targetUserId,
      label: summarizeGrant(grant),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: selectedGrantId === grant.id ? "#f4b97a" : "rgba(255,255,255,0.52)"
      },
      labelStyle: {
        fill: selectedGrantId === grant.id ? "#f4b97a" : "rgba(255,255,255,0.66)",
        fontSize: 11,
        fontWeight: 600
      },
      style: {
        stroke: selectedGrantId === grant.id ? "#f4b97a" : "rgba(255,255,255,0.35)",
        strokeWidth: selectedGrantId === grant.id ? 2.3 : 1.3
      },
      animated: selectedGrantId === grant.id
    }));
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
  const [selectedGrantId, setSelectedGrantId] = useState<string | null>(
    grants.find((grant) => grant.subjectUserId !== grant.targetUserId)?.id ?? null
  );

  const nodes = useMemo(() => buildNodes(users), [users]);
  const edges = useMemo(
    () => buildEdges(grants, selectedGrantId),
    [grants, selectedGrantId]
  );
  const selectedGrant =
    grants.find((grant) => grant.id === selectedGrantId) ?? null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.9fr)]">
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Directed relationship graph
            </div>
            <div className="mt-1 text-sm text-white/58">
              Click an arrow to edit what the source user can see or do to the target user.
            </div>
          </div>
          <Badge className="bg-white/[0.08] text-white/70">
            {grants.filter((grant) => grant.subjectUserId !== grant.targetUserId).length} edges
          </Badge>
        </div>
        <div className="h-[620px] bg-[radial-gradient(circle_at_top,rgba(244,185,122,0.08),transparent_38%),linear-gradient(180deg,rgba(6,10,20,0.96),rgba(8,14,26,0.92))]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onEdgeClick={(_event, edge) => setSelectedGrantId(edge.id)}
            attributionPosition="bottom-left"
          >
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                users.find((user) => user.id === node.id)?.accentColor ?? "#c0c1ff"
              }
            />
            <Controls showInteractive={false} />
            <Background gap={28} size={1} color="rgba(255,255,255,0.06)" />
          </ReactFlow>
        </div>
      </Card>

      <Card className="grid gap-4">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Edge rights
          </div>
          <div className="mt-2 text-sm leading-6 text-white/58">
            The arrow direction matters. `A → B` configures what `A` can inspect, link, plan, or change on `B`.
          </div>
        </div>

        {selectedGrant ? (
          <>
            <div className="grid gap-3">
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <UserBadge user={selectedGrant.subjectUser} />
                  <span className="text-white/45">→</span>
                  <UserBadge user={selectedGrant.targetUser} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className="bg-white/[0.08] text-white/74">
                    {selectedGrant.accessLevel}
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/74">
                    {summarizeGrant(selectedGrant)}
                  </Badge>
                </div>
              </div>

              {RIGHT_LABELS.map((right) => {
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
          </>
        ) : (
          <div className="rounded-[18px] bg-white/[0.04] px-4 py-4 text-sm text-white/55">
            Select one arrow in the graph to edit its rights.
          </div>
        )}
      </Card>
    </div>
  );
}
