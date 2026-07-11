import { describe, expect, it } from "vitest";
import {
  buildWikiEditorDraftStorageKey,
  readWikiEditorDraft,
  removeWikiEditorDraft,
  writeWikiEditorDraft
} from "@/pages/wiki-editor-draft";

describe("wiki editor local drafts", () => {
  it("scopes drafts by wiki space and page and restores revision provenance", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    };
    const key = buildWikiEditorDraftStorageKey("space/shared", "page:one");

    writeWikiEditorDraft(adapter, key, {
      version: 1,
      savedAt: "2026-07-11T08:00:00.000Z",
      baseRevisionHash: "revision-a",
      draft: { title: "Recovered", contentMarkdown: "# Recovered" }
    });

    expect(readWikiEditorDraft(adapter, key)).toEqual({
      version: 1,
      savedAt: "2026-07-11T08:00:00.000Z",
      baseRevisionHash: "revision-a",
      draft: { title: "Recovered", contentMarkdown: "# Recovered" }
    });
    expect(key).not.toBe(
      buildWikiEditorDraftStorageKey("space/shared", "page:two")
    );

    removeWikiEditorDraft(adapter, key);
    expect(readWikiEditorDraft(adapter, key)).toBeNull();
  });

  it("ignores corrupt or obsolete stored values", () => {
    expect(
      readWikiEditorDraft(
        { getItem: () => "not-json" },
        "forge.wiki-editor.draft.v1:test"
      )
    ).toBeNull();
    expect(
      readWikiEditorDraft(
        { getItem: () => JSON.stringify({ version: 0, draft: {} }) },
        "forge.wiki-editor.draft.v1:test"
      )
    ).toBeNull();
  });
});
