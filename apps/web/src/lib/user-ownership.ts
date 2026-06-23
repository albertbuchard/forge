import type { OwnedEntity, UserSummary } from "@/lib/types";

function compactParts(parts: Array<string | null | undefined>) {
  return parts.map((value) => value?.trim() ?? "").filter(Boolean);
}

export function coerceSelectedUserIds(
  selectedUserIds: string[] | null | undefined
) {
  return Array.isArray(selectedUserIds) ? selectedUserIds : [];
}

export function getSingleSelectedUserId(
  selectedUserIds: string[] | null | undefined
) {
  const safeSelectedUserIds = coerceSelectedUserIds(selectedUserIds);
  return safeSelectedUserIds.length === 1 ? safeSelectedUserIds[0] : null;
}

export function formatUserSummaryLine(user: UserSummary | null | undefined) {
  if (!user) {
    return "";
  }
  return `${user.displayName} · ${user.kind}${user.handle ? ` · @${user.handle}` : ""}`;
}

export function formatOwnerSelectDefaultLabel(
  user: UserSummary | null | undefined,
  fallback = "Default Forge owner"
) {
  if (!user) {
    return fallback;
  }
  return `Suggested owner: ${user.displayName} · ${user.kind}`;
}

export function formatOwnedEntityOptionLabel(
  label: string,
  user: UserSummary | null | undefined
) {
  const ownerLine = formatUserSummaryLine(user);
  return ownerLine ? `${label} · ${ownerLine}` : label;
}

export function formatOwnedEntityDescription(
  description: string | null | undefined,
  user: UserSummary | null | undefined,
  fallback = "No description yet."
) {
  const parts = compactParts([description, formatUserSummaryLine(user)]);
  return parts.join(" · ") || fallback;
}

export function buildOwnedEntitySearchText(
  baseParts: Array<string | null | undefined>,
  owner: Pick<OwnedEntity, "user"> | UserSummary | null | undefined
) {
  const user =
    owner && "user" in owner
      ? owner.user
      : (owner as UserSummary | null | undefined);
  return compactParts([
    ...baseParts,
    user?.displayName,
    user?.handle,
    user?.kind,
    user?.description
  ])
    .join(" ")
    .toLowerCase();
}
