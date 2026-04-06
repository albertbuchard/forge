import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "../server/src/db.ts";
import { deleteEntity } from "../server/src/services/entity-crud.ts";

type WikiNoteRow = {
  id: string;
  title: string;
  slug: string;
  space_id: string;
  content_markdown: string;
  created_at: string;
};

type DuplicateCandidate = {
  keeper: WikiNoteRow;
  duplicates: WikiNoteRow[];
  normalizedBody: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDataRoot = path.resolve(projectRoot, "..", "..", "data", "forge");
const deleteReason =
  "Duplicate wiki page removed after repeated ingest publish.";

function normalizeMarkdownForDuplicateComparison(markdown: string) {
  return markdown
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line.replace(/^(#{1,6}\s+.+?)\s+\d+$/, "$1").replace(/\s+$/g, "")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function canonicalScore(note: WikiNoteRow, title: string) {
  const canonicalSlug = slugify(title) || "page";
  if (note.slug === canonicalSlug) {
    return 0;
  }
  const suffixMatch = note.slug.match(new RegExp(`^${canonicalSlug}-(\\d+)$`));
  if (suffixMatch) {
    return Number(suffixMatch[1] ?? "9999");
  }
  return 10_000;
}

function chooseKeeper(title: string, group: WikiNoteRow[]) {
  return [...group].sort((left, right) => {
    const leftScore = canonicalScore(left, title);
    const rightScore = canonicalScore(right, title);
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    if (left.created_at !== right.created_at) {
      return left.created_at.localeCompare(right.created_at);
    }
    return left.id.localeCompare(right.id);
  })[0]!;
}

function collectDuplicateCandidates(rows: WikiNoteRow[]) {
  const byTitle = new Map<string, WikiNoteRow[]>();
  for (const row of rows) {
    const key = `${row.space_id}:${row.title}`;
    const current = byTitle.get(key) ?? [];
    current.push(row);
    byTitle.set(key, current);
  }

  const candidates: DuplicateCandidate[] = [];
  for (const group of byTitle.values()) {
    if (group.length < 2) {
      continue;
    }
    const byBody = new Map<string, WikiNoteRow[]>();
    for (const row of group) {
      const key = normalizeMarkdownForDuplicateComparison(row.content_markdown);
      const current = byBody.get(key) ?? [];
      current.push(row);
      byBody.set(key, current);
    }
    for (const [normalizedBody, matching] of byBody.entries()) {
      if (matching.length < 2) {
        continue;
      }
      const keeper = chooseKeeper(matching[0]!.title, matching);
      const duplicates = matching.filter((row) => row.id !== keeper.id);
      if (duplicates.length > 0) {
        candidates.push({
          keeper,
          duplicates,
          normalizedBody
        });
      }
    }
  }
  return candidates.sort((left, right) =>
    left.keeper.title.localeCompare(right.keeper.title)
  );
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dataRootArg = args.find((entry) => entry.startsWith("--data-root="));
  const dataRoot = dataRootArg
    ? path.resolve(dataRootArg.slice("--data-root=".length))
    : defaultDataRoot;

  configureDatabase({ dataRoot });
  await initializeDatabase();

  try {
    const rows = getDatabase()
      .prepare(
        `SELECT notes.id, notes.title, notes.slug, notes.space_id, notes.content_markdown, notes.created_at
         FROM notes
         LEFT JOIN deleted_entities
           ON deleted_entities.entity_type = 'note'
          AND deleted_entities.entity_id = notes.id
         WHERE notes.kind = 'wiki'
           AND deleted_entities.entity_id IS NULL
         ORDER BY notes.space_id ASC, notes.title ASC, notes.created_at ASC`
      )
      .all() as WikiNoteRow[];

    const duplicates = collectDuplicateCandidates(rows);
    if (duplicates.length === 0) {
      console.log(`No duplicate wiki pages found in ${dataRoot}.`);
      return;
    }

    for (const candidate of duplicates) {
      console.log(
        `${apply ? "Deduping" : "Would dedupe"} "${candidate.keeper.title}" in space ${candidate.keeper.space_id}`
      );
      console.log(`  keep: ${candidate.keeper.slug} (${candidate.keeper.id})`);
      for (const duplicate of candidate.duplicates) {
        console.log(`  drop: ${duplicate.slug} (${duplicate.id})`);
      }
      if (apply) {
        for (const duplicate of candidate.duplicates) {
          deleteEntity(
            "note",
            duplicate.id,
            {
              mode: "soft",
              reason: deleteReason
            },
            {
              source: "system",
              actor: "codex"
            }
          );
        }
      }
    }

    const removedCount = duplicates.reduce(
      (sum, candidate) => sum + candidate.duplicates.length,
      0
    );
    console.log(
      `${apply ? "Soft-deleted" : "Would soft-delete"} ${removedCount} duplicate wiki page${removedCount === 1 ? "" : "s"}.`
    );
    if (!apply) {
      console.log("Run again with --apply to persist the dedupe.");
    }
  } finally {
    closeDatabase();
  }
}

void main();
