import { describe, expect, it } from "vitest";
import {
  MAX_WIKI_INGEST_FILES,
  mergeWikiIngestFiles,
  validateWikiIngestUrlInput
} from "@/components/wiki/wiki-ingest-modal";

function file(name: string, size = 10, lastModified = 1) {
  return new File(["x".repeat(size)], name, { lastModified });
}

describe("wiki ingest upload batches", () => {
  it("deduplicates files and caps one batch without dropping accepted files", () => {
    const first = file("first.md");
    const incoming = [
      first,
      ...Array.from({ length: MAX_WIKI_INGEST_FILES }, (_, index) =>
        file(`source-${index}.md`, 10, index + 2)
      )
    ];

    const result = mergeWikiIngestFiles([first], incoming);

    expect(result.files).toHaveLength(MAX_WIKI_INGEST_FILES);
    expect(result.files[0]).toBe(first);
    expect(result.duplicateCount).toBe(1);
    expect(result.overflowCount).toBe(1);
  });

  it("accepts only credential-free HTTP(S) URLs before submission", () => {
    expect(validateWikiIngestUrlInput("https://example.com/source")).toBeNull();
    expect(validateWikiIngestUrlInput("file:///etc/passwd")).toMatch(
      /only HTTP or HTTPS/
    );
    expect(
      validateWikiIngestUrlInput("https://user:secret@example.com/source")
    ).toMatch(/embedded credentials/);
    expect(validateWikiIngestUrlInput("not a url")).toMatch(/valid HTTP/);
  });
});
