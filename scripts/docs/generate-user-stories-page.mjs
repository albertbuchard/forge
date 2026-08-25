import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const STORY_FAMILIES = [
  ["SYS", "Global shell and navigation"],
  ["HOME", "Overview, attention, and review"],
  ["PLAN", "Planning and execution"],
  ["CAL", "Calendar and Life Events"],
  ["KNOW", "Notes, KarpaWiki, and Knowledge Graph"],
  ["ART", "Artifact Store"],
  ["PEOPLE", "People and selective sharing"],
  ["PREF", "Preferences, insights, and personal models"],
  ["PSY", "Psyche and reflection"],
  ["HEALTH", "Health"],
  ["NUTR", "Nutrition"],
  ["MOVE", "Movement"],
  ["LF", "Life Force"],
  ["WORK", "Work and opportunity management"],
  ["FLOW", "Workbench"],
  ["LEARN", "Courses and learning"],
  ["AGENT", "Agents, MCPs, and plugins"],
  ["OPS", "Settings and data safety"],
  ["GAME", "Progression and rewards"],
  ["IOS", "iPhone companion"],
  ["WATCH", "watchOS companion"],
  ["ONB", "First use and adoption"],
  ["ECO", "Templates and ecosystem"],
  ["ANDROID", "Android companion"]
];

export const CURRENT_READINESS_STATES = [
  "Verified",
  "In review",
  "Needs audit",
  "Limited",
  "Externally blocked"
];

const familyNames = new Map(STORY_FAMILIES);
const acceptedStates = new Set([...CURRENT_READINESS_STATES, "Planned"]);
const storySections = new Set([
  "Global Shell And Navigation",
  "Overview, Attention, And Review",
  "Planning And Execution",
  "Calendar And Life Events",
  "Notes, KarpaWiki, Knowledge Graph, And Artifacts",
  "People And Selective Sharing",
  "Preferences, Insights, And Personal Models",
  "Psyche And Reflection",
  "Health, Nutrition, Movement, And Life Force",
  "Work And Opportunity Management",
  "Workbench, Agents, MCPs, And Plugins",
  "Settings, Data Safety, And Progression",
  "iPhone Companion",
  "watchOS Companion",
  "Planned User Stories",
  "Product Expansion Stories"
]);

function splitTableRow(line) {
  const cells = [];
  let cell = "";
  let escaped = false;
  let inCode = false;

  for (const character of line.slice(1, -1)) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      cell += character;
      escaped = true;
    } else if (character === "`") {
      inCode = !inCode;
      cell += character;
    } else if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell.trim());
  return cells;
}

export function parseUserStories(markdown) {
  const stories = [];
  const ids = new Set();
  let currentSection = "";
  let inCodeFence = false;

  for (const [lineIndex, line] of markdown.split(/\r?\n/).entries()) {
    if (/^```/.test(line.trim())) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const sectionMatch = line.match(/^##\s+(.+?)\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    if (!storySections.has(currentSection)) continue;

    const idMatch = line.match(/^\|\s*([A-Z]+-\d{2})\s*\|/);
    if (!idMatch) continue;

    const cells = splitTableRow(line);
    if (cells.length !== 4) {
      throw new Error(
        `Malformed story row on line ${lineIndex + 1}: expected 4 cells, found ${cells.length}.`
      );
    }

    const [id, outcome, surfaces, stateCell] = cells;
    const prefix = id.split("-")[0];
    const family = familyNames.get(prefix);
    if (!family) {
      throw new Error(
        `Unknown story family ${prefix} for ${id} on line ${lineIndex + 1}.`
      );
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate story ID ${id} on line ${lineIndex + 1}.`);
    }
    if (!outcome || !surfaces || !stateCell) {
      throw new Error(
        `Story ${id} has an empty required cell on line ${lineIndex + 1}.`
      );
    }

    const stateMatch = stateCell.match(/^`([^`]+)`:\s*(.+)$/);
    if (!stateMatch) {
      throw new Error(
        `Story ${id} must begin its final cell with a backticked state and a colon.`
      );
    }

    const [, state, nextCheck] = stateMatch;
    if (!acceptedStates.has(state)) {
      throw new Error(`Unknown story state ${state} for ${id}.`);
    }

    stories.push({
      id,
      prefix,
      family,
      lifecycle: state === "Planned" ? "planned" : "current",
      readiness: state === "Planned" ? null : state,
      state,
      outcome,
      surfaces,
      nextCheck
    });
    ids.add(id);
  }

  if (stories.length === 0) {
    throw new Error("No user-story rows were found in the contract.");
  }

  return stories;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineMarkdown(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function countBy(stories, field, value) {
  return stories.filter((story) => story[field] === value).length;
}

function renderMetric(value, label, href, dataAttribute, className = "") {
  return `<a class="story-metric ${className}" href="${href}" ${dataAttribute}><strong>${value}</strong><span>${label}</span></a>`;
}

function renderStory(story) {
  const readiness = story.readiness ?? "planned";
  return `
                <details class="story-card" id="story-${story.id.toLowerCase()}" data-story-id="${story.id}" data-lifecycle="${story.lifecycle}" data-readiness="${escapeHtml(readiness)}" data-family="${story.prefix}">
                  <summary class="story-summary">
                    <span class="story-id">${story.id}</span>
                    <span class="story-summary-outcome">${inlineMarkdown(story.outcome)}</span>
                    <span class="story-state state-${story.state.toLowerCase().replaceAll(" ", "-")}">${story.state}</span>
                  </summary>
                  <div class="story-expanded">
                    <p class="story-expanded-outcome">${inlineMarkdown(story.outcome)}</p>
                    <dl class="story-details">
                      <div><dt>Where it lives</dt><dd>${inlineMarkdown(story.surfaces)}</dd></div>
                      <div><dt>${story.lifecycle === "planned" ? "First evidence needed" : "Current evidence and next check"}</dt><dd>${inlineMarkdown(story.nextCheck)}</dd></div>
                    </dl>
                  </div>
                </details>`;
}

function renderFamily(prefix, name, stories) {
  const current = countBy(stories, "lifecycle", "current");
  const planned = countBy(stories, "lifecycle", "planned");
  const currentLabel = current === 1 ? "1 current" : `${current} current`;
  const plannedLabel = planned === 1 ? "1 planned" : `${planned} planned`;

  return `
            <details class="story-family" data-family-group="${prefix}">
              <summary>
                <span class="family-title"><span class="family-code">${prefix}</span>${escapeHtml(name)}</span>
                <span class="family-counts"><span data-family-visible>${stories.length}</span><span class="family-count-word"> shown</span><span class="family-count-breakdown"> · ${currentLabel}${planned ? ` · ${plannedLabel}` : ""}</span></span>
              </summary>
              <div class="story-list">
${stories.map(renderStory).join("\n")}
              </div>
            </details>`;
}

export function renderUserStoriesPage(stories) {
  assert(stories.length > 0, "At least one story is required.");

  const grouped = STORY_FAMILIES.map(([prefix, name]) => [
    prefix,
    name,
    stories.filter((story) => story.prefix === prefix)
  ]).filter(([, , familyStories]) => familyStories.length > 0);

  const currentCount = countBy(stories, "lifecycle", "current");
  const plannedCount = countBy(stories, "lifecycle", "planned");
  const verifiedCount = countBy(stories, "readiness", "Verified");
  const reviewCount = countBy(stories, "readiness", "In review");
  const auditCount = countBy(stories, "readiness", "Needs audit");

  return `<!doctype html>
<html lang="en" class="no-js">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge User Stories</title>
    <meta name="description" content="Explore every current and planned Forge user story by family and readiness." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Sora:wght@600;700&display=swap" rel="stylesheet" />
    <link rel="icon" href="./assets/brand-icons/forge-logo-imagegen2-mark-transparent.png" />
    <link rel="stylesheet" href="./styles.css" />
    <link rel="stylesheet" href="./user-stories.css?v=20260808-4" />
    <script src="./user-stories.js?v=20260808-4" defer></script>
  </head>
  <body class="stories-document">
    <div class="page-shell">
      <header class="topbar">
        <a class="brand" href="./index.html">
          <img class="brand-lockup" src="./assets/brand-icons/forge-logo-imagegen2-transparent-640.png" alt="Forge" />
          <span class="brand-copy"><span>Project Guide</span></span>
        </a>
        <nav class="topnav" aria-label="Documentation">
          <a href="./index.html">Home</a>
          <a href="./features.html">Features</a>
          <a class="active" href="./user-stories.html" aria-current="page">Stories</a>
          <a href="./engineering.html">Engineering</a>
          <a href="./development.html">Development</a>
          <a href="./integrations.html">Integrations</a>
          <a href="./tools.html">Agent Tools</a>
          <a href="./support.html">Support</a>
          <a href="./privacy.html">Privacy</a>
          <a href="./api/">API</a>
          <a href="https://github.com/albertbuchard/forge">GitHub</a>
        </nav>
      </header>

      <main class="page stories-page">
        <div class="breadcrumbs"><a href="./index.html">Docs</a><span>/</span><span>User stories</span></div>

        <section class="stories-hero" aria-labelledby="stories-title">
          <h1 id="stories-title">Forge user stories</h1>
        </section>

        <section class="story-metrics" aria-label="Story totals">
          ${renderMetric(stories.length, "All stories", "./user-stories.html", 'data-metric-scope="all"', "metric-all")}
          ${renderMetric(currentCount, "Current product", "?scope=current", 'data-metric-scope="current"')}
          ${renderMetric(plannedCount, "Planned", "?scope=planned", 'data-metric-scope="planned"', "metric-planned")}
          ${renderMetric(verifiedCount, "Verified", "?readiness=Verified", 'data-metric-readiness="Verified"', "metric-verified")}
          ${renderMetric(reviewCount, "In review", "?readiness=In%20review", 'data-metric-readiness="In review"')}
          ${renderMetric(auditCount, "Needs audit", "?readiness=Needs%20audit", 'data-metric-readiness="Needs audit"')}
          ${renderMetric(grouped.length, "Story families", "#story-families", "data-metric-family-picker")}
        </section>

        <section class="story-browser" id="story-families" aria-label="Story families">
          <div class="browse-toolbar enhanced-control">
            <details class="filter-panel" data-filter-panel>
              <summary><span>Filter stories</span><span data-filter-summary>Search, lifecycle, readiness, or family</span></summary>
              <form class="story-filters" data-story-filters>
                <div class="filter-field filter-search">
                  <label for="story-search">Search stories</label>
                  <input id="story-search" type="search" name="q" placeholder="Try “calendar”, “offline”, or “HealthKit”" autocomplete="off" />
                </div>
                <fieldset class="scope-filter">
                  <legend>Lifecycle</legend>
                  <div class="segmented-control">
                    <button type="button" data-scope="all" aria-pressed="true">All</button>
                    <button type="button" data-scope="current" aria-pressed="false">Current product</button>
                    <button type="button" data-scope="planned" aria-pressed="false">Planned</button>
                  </div>
                </fieldset>
                <div class="filter-field">
                  <label for="readiness-filter">Readiness</label>
                  <select id="readiness-filter" name="readiness">
                    <option value="all">All readiness</option>
                    ${CURRENT_READINESS_STATES.map((state) => `<option value="${escapeHtml(state)}">${state}</option>`).join("\n                    ")}
                  </select>
                </div>
                <div class="filter-field">
                  <label for="family-filter">Story family</label>
                  <select id="family-filter" name="family">
                    <option value="all">All story families</option>
                    ${grouped.map(([prefix, name]) => `<option value="${prefix}">${prefix} · ${escapeHtml(name)}</option>`).join("\n                    ")}
                  </select>
                </div>
              </form>
            </details>
            <div class="expand-actions"><button type="button" class="quiet-button" data-expand-all>Expand all</button><button type="button" class="quiet-button" data-collapse-all>Collapse all</button></div>
          </div>

          <div class="result-bar">
            <p data-result-count aria-live="polite">Showing all ${stories.length} stories.</p>
            <button type="button" class="reset-button" data-reset-filters hidden>Clear filters</button>
          </div>
          <noscript><p class="noscript-note">Filtering needs JavaScript. The complete story contract remains available below; open any family to read its stories.</p></noscript>
          <div class="empty-results" data-empty-results hidden>
            <h3>No stories match these filters</h3>
            <p>Try a broader search, choose another family, or clear the filters.</p>
            <button type="button" class="button primary" data-reset-filters>Clear filters</button>
          </div>

          <div class="story-families">
${grouped.map(([prefix, name, familyStories]) => renderFamily(prefix, name, familyStories)).join("\n")}
          </div>
        </section>
      </main>
    </div>
  </body>
</html>
`;
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "../..");
  const contractPath = path.join(
    repositoryRoot,
    "docs/reference/user-stories-and-use-cases.md"
  );
  const outputPath = path.join(
    repositoryRoot,
    "plugins/openclaw/docs/user-stories.html"
  );
  const markdown = await readFile(contractPath, "utf8");
  const output = renderUserStoriesPage(parseUserStories(markdown));

  if (process.argv.includes("--check")) {
    let existing = "";
    try {
      existing = await readFile(outputPath, "utf8");
    } catch {
      throw new Error(`Generated page is missing: ${outputPath}`);
    }
    if (existing !== output) {
      throw new Error(
        "The tracked user-stories page is stale. Run npm run docs:user-stories and review the generated diff."
      );
    }
    console.log(
      `User-stories page is current (${parseUserStories(markdown).length} stories).`
    );
    return;
  }

  await writeFile(outputPath, output);
  console.log(
    `Generated ${outputPath} with ${parseUserStories(markdown).length} stories.`
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
