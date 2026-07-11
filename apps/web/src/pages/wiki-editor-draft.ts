const WIKI_EDITOR_DRAFT_PREFIX = "forge.wiki-editor.draft.v1";

export type StoredWikiEditorDraft<TDraft> = {
  version: 1;
  savedAt: string;
  baseRevisionHash: string | null;
  draft: TDraft;
};

export function buildWikiEditorDraftStorageKey(
  spaceId: string,
  pageId: string | null
) {
  return `${WIKI_EDITOR_DRAFT_PREFIX}:${encodeURIComponent(spaceId)}:${encodeURIComponent(pageId ?? "new")}`;
}

export function readWikiEditorDraft<TDraft>(
  storage: Pick<Storage, "getItem">,
  key: string
): StoredWikiEditorDraft<TDraft> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredWikiEditorDraft<TDraft>>;
    if (
      parsed.version !== 1 ||
      typeof parsed.savedAt !== "string" ||
      !parsed.draft ||
      typeof parsed.draft !== "object"
    ) {
      return null;
    }
    return parsed as StoredWikiEditorDraft<TDraft>;
  } catch {
    return null;
  }
}

export function writeWikiEditorDraft<TDraft>(
  storage: Pick<Storage, "setItem">,
  key: string,
  value: StoredWikiEditorDraft<TDraft>
) {
  storage.setItem(key, JSON.stringify(value));
}

export function removeWikiEditorDraft(
  storage: Pick<Storage, "removeItem">,
  key: string
) {
  storage.removeItem(key);
}
