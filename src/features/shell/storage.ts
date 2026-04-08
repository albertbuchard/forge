const USER_SCOPE_STORAGE_KEY = "forge.selected-user-ids";

export function readStoredSelectedUserIds() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(USER_SCOPE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function writeStoredSelectedUserIds(userIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      USER_SCOPE_STORAGE_KEY,
      JSON.stringify(Array.from(new Set(userIds)))
    );
  } catch {
    return;
  }
}
