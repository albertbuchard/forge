import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const NON_MERGEABLE_STALE_TABLES = new Set([
  "absolute_signals",
  "notes",
  "pairwise_judgments",
  "preference_catalog_items",
  "preference_catalogs",
  "preference_contexts",
  "preference_dimension_summaries",
  "preference_item_scores",
  "preference_items",
  "preference_profiles",
  "preference_snapshots",
  "wiki_link_edges"
]);

function shouldSkipTable(table) {
  return NON_MERGEABLE_STALE_TABLES.has(table) || table.startsWith("wiki_pages_fts");
}

function usage() {
  console.error(
    "Usage: node ./scripts/merge-forge-sqlite.mjs <source.sqlite> <target.sqlite>"
  );
  process.exit(1);
}

const sourcePath = process.argv[2];
const targetPath = process.argv[3];

if (!sourcePath || !targetPath) {
  usage();
}

if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) {
  console.error("Both source and target database files must exist.");
  process.exit(1);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function readTableNames(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row) => row.name);
}

function readTableInfo(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
}

function pickTimeColumn(columns) {
  return (
    ["updated_at", "created_at", "started_at", "occurred_at", "observed_at"].find(
      (column) => columns.includes(column)
    ) ?? null
  );
}

function compareMoments(left, right) {
  const leftParsed = Date.parse(String(left));
  const rightParsed = Date.parse(String(right));
  if (Number.isFinite(leftParsed) && Number.isFinite(rightParsed)) {
    return leftParsed - rightParsed;
  }
  return String(left).localeCompare(String(right));
}

function buildTagIdMap(sourceDb, targetDb) {
  const sourceTags = sourceDb
    .prepare("SELECT id, name FROM tags")
    .all();
  const targetTags = targetDb
    .prepare("SELECT id, name FROM tags")
    .all();
  const targetIdByName = new Map(targetTags.map((row) => [row.name, row.id]));
  const remapped = new Map();

  for (const row of sourceTags) {
    const targetId = targetIdByName.get(row.name);
    if (targetId && targetId !== row.id) {
      remapped.set(row.id, targetId);
    }
  }

  return remapped;
}

function transformRow(table, row, tagIdMap) {
  if ((table === "goal_tags" || table === "task_tags") && tagIdMap.has(row.tag_id)) {
    return { ...row, tag_id: tagIdMap.get(row.tag_id) };
  }
  return row;
}

const sourceDb = new DatabaseSync(sourcePath, { readonly: true });
const targetDb = new DatabaseSync(targetPath);
const tagIdMap = buildTagIdMap(sourceDb, targetDb);

const targetTables = readTableNames(targetDb);
const sourceTables = new Set(readTableNames(sourceDb));

const summary = [];

targetDb.exec("PRAGMA foreign_keys = OFF;");
targetDb.exec("PRAGMA busy_timeout = 5000;");
targetDb.exec("BEGIN IMMEDIATE;");

try {
  for (const table of targetTables) {
    if (!sourceTables.has(table)) {
      continue;
    }
    if (shouldSkipTable(table)) {
      continue;
    }

    const targetInfo = readTableInfo(targetDb, table);
    const sourceInfo = readTableInfo(sourceDb, table);
    const targetColumns = targetInfo.map((column) => column.name);
    const sourceColumnSet = new Set(sourceInfo.map((column) => column.name));
    const commonColumns = targetColumns.filter((column) =>
      sourceColumnSet.has(column)
    );

    if (commonColumns.length === 0) {
      continue;
    }

    const primaryKeyColumns = targetInfo
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => column.name);
    const timeColumn = pickTimeColumn(commonColumns);

    const selectedColumnsSql = commonColumns.map(quoteIdentifier).join(", ");
    const sourceRows = sourceDb
      .prepare(`SELECT ${selectedColumnsSql} FROM ${quoteIdentifier(table)}`)
      .all();

    if (sourceRows.length === 0) {
      continue;
    }

    const placeholders = commonColumns.map(() => "?").join(", ");
    const insertStatement = targetDb.prepare(
      `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${selectedColumnsSql}) VALUES (${placeholders})`
    );

    const hasPrimaryKey = primaryKeyColumns.length > 0;
    const existingStatement = hasPrimaryKey
      ? targetDb.prepare(
          `SELECT ${
            timeColumn ? `${quoteIdentifier(timeColumn)} AS row_time` : "1 AS row_time"
          } FROM ${quoteIdentifier(table)} WHERE ${primaryKeyColumns
            .map((column) => `${quoteIdentifier(column)} = ?`)
            .join(" AND ")}`
        )
      : null;

    const updatableColumns = commonColumns.filter(
      (column) => !primaryKeyColumns.includes(column)
    );
    const updateStatement =
      hasPrimaryKey && timeColumn && updatableColumns.length > 0
        ? targetDb.prepare(
            `UPDATE ${quoteIdentifier(table)} SET ${updatableColumns
              .map((column) => `${quoteIdentifier(column)} = ?`)
              .join(", ")} WHERE ${primaryKeyColumns
              .map((column) => `${quoteIdentifier(column)} = ?`)
              .join(" AND ")}`
          )
        : null;

    let inserted = 0;
    let updated = 0;

    for (const row of sourceRows) {
      const transformedRow = transformRow(table, row, tagIdMap);
      const rowValues = commonColumns.map((column) => transformedRow[column] ?? null);

      if (!hasPrimaryKey) {
        const result = insertStatement.run(...rowValues);
        inserted += Number(result.changes ?? 0);
        continue;
      }

      const keyValues = primaryKeyColumns.map((column) => transformedRow[column]);
      const existing = existingStatement.get(...keyValues);

      if (!existing) {
        const result = insertStatement.run(...rowValues);
        inserted += Number(result.changes ?? 0);
        continue;
      }

      if (!updateStatement || !timeColumn) {
        continue;
      }

      const sourceMoment = transformedRow[timeColumn];
      const targetMoment = existing.row_time;

      if (!sourceMoment || !targetMoment) {
        continue;
      }

      if (compareMoments(sourceMoment, targetMoment) <= 0) {
        continue;
      }

      const updateValues = updatableColumns.map((column) => transformedRow[column] ?? null);
      const result = updateStatement.run(...updateValues, ...keyValues);
      updated += Number(result.changes ?? 0);
    }

    if (inserted > 0 || updated > 0) {
      summary.push({ table, inserted, updated });
    }
  }

  const foreignKeyViolations = targetDb
    .prepare("PRAGMA foreign_key_check")
    .all();
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `Foreign key check failed after merge: ${JSON.stringify(
        foreignKeyViolations.slice(0, 20)
      )}`
    );
  }

  targetDb.exec("COMMIT;");
} catch (error) {
  targetDb.exec("ROLLBACK;");
  throw error;
} finally {
  targetDb.exec("PRAGMA foreign_keys = ON;");
  sourceDb.close();
  targetDb.close();
}

for (const row of summary) {
  console.log(
    `${row.table}: inserted=${row.inserted} updated=${row.updated}`
  );
}
