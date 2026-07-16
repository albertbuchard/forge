import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWikiFtsQuery,
  mergeWikiSearchCandidateChannels,
  WIKI_PAGE_LIST_MAX_RESULTS,
  WIKI_SEARCH_MAX_FTS_TOKENS,
  WIKI_SEARCH_MAX_QUERY_CHARS,
  WIKI_SEARCH_MAX_RESULTS,
  wikiPageListQuerySchema,
  wikiSearchQuerySchema
} from "./repositories/wiki-memory.js";

test("wiki query and pagination schemas enforce terminal bounds", () => {
  assert.equal(
    wikiSearchQuerySchema.safeParse({
      query: "x".repeat(WIKI_SEARCH_MAX_QUERY_CHARS)
    }).success,
    true
  );
  assert.equal(
    wikiSearchQuerySchema.safeParse({
      query: "x".repeat(WIKI_SEARCH_MAX_QUERY_CHARS + 1)
    }).success,
    false
  );
  assert.equal(
    wikiSearchQuerySchema.safeParse({
      offset: WIKI_SEARCH_MAX_RESULTS - 1
    }).success,
    true
  );
  assert.equal(
    wikiSearchQuerySchema.safeParse({ offset: WIKI_SEARCH_MAX_RESULTS })
      .success,
    false
  );
  assert.equal(
    wikiPageListQuerySchema.safeParse({
      offset: WIKI_PAGE_LIST_MAX_RESULTS - 1
    }).success,
    true
  );
  assert.equal(
    wikiPageListQuerySchema.safeParse({
      offset: WIKI_PAGE_LIST_MAX_RESULTS
    }).success,
    false
  );
});

test("wiki FTS expressions use only the bounded leading token set", () => {
  const tokens = Array.from(
    { length: WIKI_SEARCH_MAX_FTS_TOKENS + 5 },
    (_, index) => `token${index + 1}`
  );
  const expression = buildWikiFtsQuery(tokens.join(" "));
  assert.ok(expression);
  const clauses = expression.split(" AND ");
  assert.equal(clauses.length, WIKI_SEARCH_MAX_FTS_TOKENS);
  assert.equal(clauses[0], "token1*");
  assert.equal(clauses.at(-1), `token${WIKI_SEARCH_MAX_FTS_TOKENS}*`);
  assert.equal(
    expression.includes(`token${WIKI_SEARCH_MAX_FTS_TOKENS + 1}`),
    false
  );
});

test("wiki search reserves bounded capacity for every retrieval channel", () => {
  const fts = Array.from(
    { length: WIKI_SEARCH_MAX_RESULTS },
    (_, index) => `fts_${String(index).padStart(4, "0")}`
  );
  const channels = {
    fts,
    direct: ["direct_only"],
    entity: ["entity_only"],
    semantic: ["semantic_only"],
    recent: ["recent_only"]
  } as const;
  const merged = mergeWikiSearchCandidateChannels(channels);

  assert.equal(merged.length, WIKI_SEARCH_MAX_RESULTS);
  for (const reserved of [
    "direct_only",
    "entity_only",
    "semantic_only",
    "recent_only"
  ]) {
    assert.ok(merged.includes(reserved), `${reserved} must not be starved`);
  }
  assert.deepEqual(merged, mergeWikiSearchCandidateChannels(channels));
});
