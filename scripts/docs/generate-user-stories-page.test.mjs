import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

import {
  CURRENT_READINESS_STATES,
  parseUserStories,
  renderUserStoriesPage,
  STORY_FAMILIES
} from "./generate-user-stories-page.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const contractPath = path.join(
  repositoryRoot,
  "docs/reference/user-stories-and-use-cases.md"
);
const clientPath = path.join(
  repositoryRoot,
  "plugins/openclaw/docs/user-stories.js"
);

function storyFixture(rows, section = "Global Shell And Navigation") {
  return `## ${section}\n\n${rows}`;
}

async function createClient(url = "https://forge.test/user-stories.html") {
  const stories = parseUserStories(await readFile(contractPath, "utf8"));
  const dom = new JSDOM(renderUserStoriesPage(stories), {
    url,
    runScripts: "outside-only"
  });
  dom.window.eval(await readFile(clientPath, "utf8"));
  return dom;
}

function visibleStories(document) {
  return [...document.querySelectorAll("[data-story-id]")].filter(
    (story) => !story.hidden
  );
}

test("the authoritative contract has the expected current and planned inventory", async () => {
  const stories = parseUserStories(await readFile(contractPath, "utf8"));
  const count = (field, value) =>
    stories.filter((story) => story[field] === value).length;

  assert.equal(stories.length, 203);
  assert.equal(new Set(stories.map((story) => story.id)).size, 203);
  assert.equal(count("lifecycle", "current"), 190);
  assert.equal(count("lifecycle", "planned"), 13);
  assert.equal(count("readiness", "Verified"), 14);
  assert.equal(count("readiness", "In review"), 146);
  assert.equal(count("readiness", "Needs audit"), 30);
  assert.equal(count("readiness", "Limited"), 0);
  assert.equal(count("readiness", "Externally blocked"), 0);
  assert.equal(new Set(stories.map((story) => story.prefix)).size, 23);
  assert.deepEqual(
    [...new Set(stories.map((story) => story.prefix))],
    STORY_FAMILIES.map(([prefix]) => prefix)
  );
  assert.deepEqual(
    [
      ...new Set(
        stories
          .filter((story) => story.lifecycle === "current")
          .map((story) => story.readiness)
      )
    ].sort(),
    CURRENT_READINESS_STATES.slice(0, 3).sort()
  );

  const knowledgeAudit = stories.find((story) => story.id === "KNOW-01");
  assert.equal(knowledgeAudit.readiness, "Needs audit");
});

test("the generated page is deterministic and contains every story exactly once", async () => {
  const stories = parseUserStories(await readFile(contractPath, "utf8"));
  const first = renderUserStoriesPage(stories);
  const second = renderUserStoriesPage(stories);

  assert.equal(first, second);
  assert.equal(first.match(/class="story-card"/g)?.length, 203);
  assert.equal(first.match(/class="story-family"/g)?.length, 23);
  assert.doesNotMatch(first, /class="story-family"[^>]* open/);
  assert.doesNotMatch(first, /class="story-card"[^>]* open/);
  assert.match(first, /<html lang="en" class="no-js">/);
  assert.match(first, /class="browse-toolbar enhanced-control"/);
  assert.equal(first.match(/class="story-metric /g)?.length, 7);
  assert.match(first, /href="\?readiness=In%20review"/);
  assert.match(first, /data-metric-family-picker/);
  assert.doesNotMatch(first, /Read the source contract/);
  assert.doesNotMatch(first, /Explore what Forge supports today/);
  assert.doesNotMatch(first, /Browse Forge by story family/);
  assert.doesNotMatch(first, /Open a family to see/);
  assert.match(first, /data-scope="current"/);
  assert.match(first, /data-scope="planned"/);
  assert.match(first, /<option value="Limited">Limited<\/option>/);
  assert.match(
    first,
    /<option value="Externally blocked">Externally blocked<\/option>/
  );

  for (const story of stories) {
    assert.equal(
      first.match(new RegExp(`data-story-id="${story.id}"`, "g"))?.length,
      1,
      `${story.id} should appear once as a story element`
    );
  }
});

test("the parser rejects duplicate IDs", () => {
  const row =
    "| SYS-01 | As a user, I can test. | Test surface. | `Verified`: Test evidence. |";
  assert.throws(
    () => parseUserStories(storyFixture(`${row}\n${row}`)),
    /Duplicate story ID SYS-01/
  );
});

test("the parser rejects malformed rows, unknown families, and unknown states", () => {
  assert.throws(
    () =>
      parseUserStories(
        storyFixture("| SYS-01 | Missing cells | `Verified`: Evidence. |")
      ),
    /expected 4 cells/
  );
  assert.throws(
    () =>
      parseUserStories(
        storyFixture(
          "| OTHER-01 | As a user, I can test. | Test surface. | `Verified`: Evidence. |"
        )
      ),
    /Unknown story family OTHER/
  );
  assert.throws(
    () =>
      parseUserStories(
        storyFixture(
          "| SYS-01 | As a user, I can test. | Test surface. | `Almost ready`: Evidence. |"
        )
      ),
    /Unknown story state Almost ready/
  );
});

test("the parser ignores story-shaped rows outside authoritative sections and in code fences", () => {
  const valid =
    "| SYS-01 | As a user, I can test. | Test surface. | `Verified`: Evidence. |";
  const unrelated =
    "| SYS-98 | As a user, I am only an example. | Example. | `Verified`: Example. |";
  const fenced =
    "| SYS-99 | As a user, I am fenced code. | Example. | `Verified`: Example. |";
  const markdown = `${storyFixture(valid)}\n\n## Route Coverage Index\n\n${unrelated}\n\n\`\`\`md\n${fenced}\n\`\`\``;

  assert.deepEqual(
    parseUserStories(markdown).map((story) => story.id),
    ["SYS-01"]
  );
});

test("rendering escapes authored HTML while retaining inline code", () => {
  const stories = parseUserStories(
    storyFixture(
      "| SYS-01 | As a user, I can see <script>alert(1)</script> and `safe code`. | Test surface. | `Verified`: Evidence. |"
    )
  );
  const page = renderUserStoriesPage(stories);

  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page, /<code>safe code<\/code>/);
});

test("the client restores filters, canonicalizes contradictory URLs, and keeps matches visible", async () => {
  const dom = await createClient(
    "https://forge.test/user-stories.html?scope=planned&readiness=Verified"
  );
  const { document, location } = dom.window;

  assert.equal(location.search, "?scope=planned");
  assert.equal(document.querySelector("#readiness-filter").value, "all");
  assert.equal(document.querySelector("#readiness-filter").disabled, true);
  assert.equal(visibleStories(document).length, 13);
  assert.equal(document.querySelector("[data-collapse-all]").hidden, true);
  assert.equal(document.querySelector("[data-expand-all]").hidden, true);
  assert.equal(document.querySelector("[data-filter-panel]").open, true);
  assert.equal(
    document.querySelector("[data-filter-summary]").textContent,
    "Filters active"
  );

  document.querySelector('[data-scope="current"]').click();
  const readiness = document.querySelector("#readiness-filter");
  readiness.value = "Verified";
  readiness.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  assert.equal(visibleStories(document).length, 14);
  assert.equal(
    visibleStories(document).every(
      (story) => story.dataset.readiness === "Verified"
    ),
    true
  );
  assert.equal(document.querySelector("[data-collapse-all]").hidden, true);
  assert.equal(
    [...document.querySelectorAll("[data-family-group]")]
      .filter((group) => !group.hidden)
      .every((group) => group.open),
    true
  );
});

test("the client supports search, empty recovery, reset focus, and safe anchors", async () => {
  const defaultDom = await createClient();
  assert.equal(
    [
      ...defaultDom.window.document.querySelectorAll("[data-family-group]")
    ].every((group) => !group.open),
    true
  );
  assert.equal(
    defaultDom.window.document.querySelector("[data-filter-panel]").open,
    false
  );
  assert.equal(
    defaultDom.window.document.documentElement.classList.contains("js"),
    true
  );
  assert.equal(
    defaultDom.window.document.querySelector("[data-expand-all]").hidden,
    false
  );
  assert.equal(
    defaultDom.window.document.querySelector("[data-collapse-all]").hidden,
    true
  );
  const inReviewMetric = defaultDom.window.document.querySelector(
    '[data-metric-readiness="In review"]'
  );
  inReviewMetric.click();
  assert.equal(visibleStories(defaultDom.window.document).length, 146);
  assert.equal(inReviewMetric.getAttribute("aria-current"), "true");
  assert.equal(defaultDom.window.location.search, "?readiness=In+review");
  defaultDom.window.document.querySelector('[data-metric-scope="all"]').click();
  assert.equal(visibleStories(defaultDom.window.document).length, 203);
  assert.equal(defaultDom.window.location.search, "");
  defaultDom.window.document
    .querySelector("[data-metric-family-picker]")
    .click();
  assert.equal(
    defaultDom.window.document.querySelector("[data-filter-panel]").open,
    true
  );
  assert.equal(
    defaultDom.window.document.activeElement,
    defaultDom.window.document.querySelector("#family-filter")
  );
  assert.equal(
    [...defaultDom.window.document.querySelectorAll("[data-story-id]")].every(
      (story) => !story.open
    ),
    true
  );
  const firstStory =
    defaultDom.window.document.querySelector("[data-story-id]");
  firstStory.querySelector("summary").click();
  assert.equal(firstStory.open, true);
  firstStory.querySelector("summary").click();
  assert.equal(firstStory.open, false);
  defaultDom.window.document.querySelector("[data-expand-all]").click();
  assert.equal(
    [
      ...defaultDom.window.document.querySelectorAll("[data-family-group]")
    ].every((group) => group.open),
    true
  );
  assert.equal(
    defaultDom.window.document.querySelector("[data-expand-all]").hidden,
    true
  );
  assert.equal(
    defaultDom.window.document.querySelector("[data-collapse-all]").hidden,
    false
  );
  defaultDom.window.document.querySelector("[data-collapse-all]").click();
  assert.equal(
    [
      ...defaultDom.window.document.querySelectorAll("[data-family-group]")
    ].every((group) => !group.open),
    true
  );

  const dom = await createClient(
    "https://forge.test/user-stories.html?scope=current&family=SYS#story-android-01"
  );
  const { document } = dom.window;
  const anchoredStory = document.querySelector("#story-android-01");
  assert.equal(anchoredStory.open, true);
  assert.equal(anchoredStory.closest(".story-family").open, true);
  assert.equal(anchoredStory.hidden, false);
  assert.equal(anchoredStory.closest(".story-family").hidden, false);
  assert.equal(dom.window.location.search, "");
  document.querySelector('[data-metric-scope="current"]').click();
  assert.equal(dom.window.location.hash, "");
  assert.equal(visibleStories(document).length, 190);

  const search = document.querySelector("#story-search");
  search.focus();
  search.value = "HealthKit";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(visibleStories(document).length, 3);
  assert.equal(
    visibleStories(document).every((story) =>
      story.textContent.toLowerCase().includes("healthkit")
    ),
    true
  );

  search.value = "";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(document.querySelector("[data-filter-panel]").open, true);
  assert.equal(document.activeElement, search);
  document.querySelector('[data-scope="current"]').click();
  const family = document.querySelector("#family-filter");
  family.value = "ANDROID";
  family.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(visibleStories(document).length, 0);
  assert.equal(document.querySelector("[data-empty-results]").hidden, false);

  document.querySelector("[data-reset-filters]").click();
  assert.equal(visibleStories(document).length, 203);
  assert.equal(
    document.activeElement,
    document.querySelector("[data-filter-panel] > summary")
  );
  assert.equal(dom.window.location.search, "");
  assert.equal(document.querySelector("[data-filter-panel]").open, false);
  assert.equal(
    [...document.querySelectorAll("[data-family-group]")].every(
      (group) => !group.open
    ),
    true
  );
  assert.equal(
    [...document.querySelectorAll("[data-story-id]")].every(
      (story) => !story.open
    ),
    true
  );

  dom.window.history.replaceState(
    null,
    "",
    "/user-stories.html#story-android-01"
  );
  document.querySelector("[data-metric-family-picker]").click();
  assert.equal(dom.window.location.hash, "#story-families");

  await assert.doesNotReject(() =>
    createClient("https://forge.test/user-stories.html#%")
  );
});
