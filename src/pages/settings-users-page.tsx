import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { UserBadge } from "@/components/ui/user-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForgeShell } from "@/components/shell/app-shell";
import { createUser, getUserDirectory, patchUser } from "@/lib/api";
import type { UserKind, UserSummary } from "@/lib/types";

type UserDraft = {
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

function userToDraft(user: UserSummary): UserDraft {
  return {
    kind: user.kind,
    handle: user.handle,
    displayName: user.displayName,
    description: user.description,
    accentColor: user.accentColor
  };
}

export function SettingsUsersPage() {
  const shell = useForgeShell();
  const [draft, setDraft] = useState<UserDraft>(DEFAULT_USER_DRAFT);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const directoryQuery = useQuery({
    queryKey: ["forge-user-directory"],
    queryFn: getUserDirectory
  });

  const refreshUsers = async () => {
    await Promise.all([shell.refresh(), directoryQuery.refetch()]);
  };

  const saveUserMutation = useMutation({
    mutationFn: async ({
      input,
      userId
    }: {
      input: UserDraft;
      userId?: string;
    }) =>
      userId
        ? (await patchUser(userId, input)).user
        : (await createUser(input)).user,
    onSuccess: async () => {
      setDraft(DEFAULT_USER_DRAFT);
      setEditingUser(null);
      await refreshUsers();
    }
  });

  const directory = directoryQuery.data?.directory;
  const ownershipByUserId = useMemo(
    () =>
      new Map(
        (directory?.ownership ?? []).map((entry) => [entry.userId, entry])
      ),
    [directory?.ownership]
  );
  const readableTargetsByUserId = useMemo(() => {
    const map = new Map<string, UserSummary[]>();
    for (const grant of directory?.grants ?? []) {
      if (!grant.targetUser || grant.subjectUserId === grant.targetUserId) {
        continue;
      }
      const current = map.get(grant.subjectUserId) ?? [];
      current.push(grant.targetUser);
      map.set(grant.subjectUserId, current);
    }
    return map;
  }, [directory?.grants]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const groupedUsers = useMemo(() => {
    const baseUsers = directory?.users ?? shell.snapshot.users;
    const visibleUsers = baseUsers.filter((user) => {
      if (!normalizedSearch) {
        return true;
      }
      return [user.displayName, user.handle, user.kind, user.description]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
    return {
      humans: visibleUsers.filter((user) => user.kind === "human"),
      bots: visibleUsers.filter((user) => user.kind === "bot")
    };
  }, [directory?.users, normalizedSearch, shell.snapshot.users]);

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Users"
        description="Forge users can be human or bot. Ownership, search, and routing are prepared so work can move across both sides of the system."
        badge={`${shell.snapshot.users.length} users`}
      />

      <SettingsSectionNav />

      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Multi-user posture
            </div>
            <div className="mt-2 text-sm leading-6 text-white/60">
              {directory?.posture.summary ??
                "Forge is preparing modular user access while keeping the current posture permissive."}
            </div>
          </div>
          <Badge className="bg-white/[0.08] text-white/72">
            {directory?.posture.accessModel ?? "permissive"}
          </Badge>
        </div>
        <div className="flex items-center gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search human, bot, @handle, or description"
          />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(20rem,1.05fr)]">
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            {editingUser ? "Edit user" : "Create user"}
          </div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Kind</span>
              <select
                value={draft.kind}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    kind: event.target.value as UserKind
                  }))
                }
                className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
              >
                <option value="human">Human</option>
                <option value="bot">Bot</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Handle</span>
              <Input
                value={draft.handle}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    handle: event.target.value
                  }))
                }
                placeholder="forge-operator"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Display name</span>
              <Input
                value={draft.displayName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    displayName: event.target.value
                  }))
                }
                placeholder="Forge Operator"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Description</span>
              <Textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value
                  }))
                }
                placeholder="What this user is responsible for and which side of Forge it represents."
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Accent color</span>
              <Input
                value={draft.accentColor}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    accentColor: event.target.value
                  }))
                }
                placeholder="#c0c1ff"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                pending={saveUserMutation.isPending}
                pendingLabel={editingUser ? "Saving user" : "Creating user"}
                onClick={() => {
                  void saveUserMutation.mutateAsync({
                    input: draft,
                    userId: editingUser?.id
                  });
                }}
              >
                {editingUser ? "Save user" : "Create user"}
              </Button>
              {editingUser ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingUser(null);
                    setDraft(DEFAULT_USER_DRAFT);
                  }}
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <div className="grid gap-5">
          {(
            [
              { title: "Human users", users: groupedUsers.humans },
              { title: "Bot users", users: groupedUsers.bots }
            ] as const
          ).map((group) => (
            <Card key={group.title}>
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                  {group.title}
                </div>
                <Badge className="bg-white/[0.08] text-white/72">
                  {group.users.length}
                </Badge>
              </div>
              <div className="mt-4 grid gap-3">
                {group.users.map((user) => (
                  <div
                    key={user.id}
                    className="rounded-[18px] bg-white/[0.04] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <UserBadge user={user} />
                        <div className="mt-3 text-sm text-white/58">
                          @{user.handle}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-white/60">
                          {user.description || "No description yet."}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {Object.entries(
                            ownershipByUserId.get(user.id)?.entityCounts ?? {}
                          )
                            .sort((left, right) => right[1] - left[1])
                            .slice(0, 4)
                            .map(([entityType, count]) => (
                              <Badge
                                key={`${user.id}-${entityType}`}
                                className="bg-white/[0.08] text-white/70"
                              >
                                {count} {entityType}
                              </Badge>
                            ))}
                          <Badge className="bg-white/[0.08] text-white/70">
                            {ownershipByUserId.get(user.id)
                              ?.totalOwnedEntities ?? 0}{" "}
                            owned
                          </Badge>
                        </div>
                        <div className="mt-3 text-xs leading-5 text-white/50">
                          Can currently read:{" "}
                          {(readableTargetsByUserId.get(user.id) ?? [])
                            .map(
                              (target) =>
                                `${target.displayName} (${target.kind})`
                            )
                            .join(", ") || "no other users"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditingUser(user);
                            setDraft(userToDraft(user));
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Access matrix
          </div>
          <div className="mt-4 grid gap-3">
            {(directory?.users ?? shell.snapshot.users).map((user) => (
              <div
                key={`matrix-${user.id}`}
                className="rounded-[18px] bg-white/[0.04] px-4 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <UserBadge user={user} />
                  <Badge className="bg-white/[0.08] text-white/70">
                    {(readableTargetsByUserId.get(user.id) ?? []).length}{" "}
                    readable users
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(readableTargetsByUserId.get(user.id) ?? []).map(
                    (target) => (
                      <UserBadge
                        key={`${user.id}-${target.id}`}
                        user={target}
                        compact
                      />
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
