const TOOLS_URL = "./agent-tools.json";

const state = {
  tools: [],
  groups: []
};

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = text;
  }
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text != null) {
    element.textContent = text;
  }
  return element;
}

function renderToolCard(tool) {
  const article = el("article", "tool-card");

  const heading = el("div", "tool-card-heading");
  heading.appendChild(el("h3", "", tool.name));
  heading.appendChild(el("span", "pill secondary", tool.groupTitle));
  article.appendChild(heading);

  article.appendChild(el("p", "tool-summary", tool.summary));
  article.appendChild(el("p", "tool-when", tool.whenToUse));

  const details = el("dl", "tool-details");
  const required = Array.isArray(tool.requiredFields)
    ? tool.requiredFields.join(", ")
    : "";
  const rows = [
    ["Input", tool.inputShape || "{}"],
    ["Required", required || "None"],
    ["Example", tool.example || "{}"]
  ];

  for (const [label, value] of rows) {
    details.appendChild(el("dt", "", label));
    const dd = el("dd", "");
    const code = el("code", "", value);
    dd.appendChild(code);
    details.appendChild(dd);
  }

  article.appendChild(details);

  if (Array.isArray(tool.notes) && tool.notes.length > 0) {
    const list = el("ul", "tool-notes");
    for (const note of tool.notes) {
      list.appendChild(el("li", "", note));
    }
    article.appendChild(list);
  }

  return article;
}

function matchesFilter(tool, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    tool.name,
    tool.groupTitle,
    tool.summary,
    tool.whenToUse,
    tool.inputShape,
    ...(tool.notes ?? [])
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function renderTools() {
  const container = document.getElementById("tools-container");
  const search = document.getElementById("tool-search");
  if (!container) {
    return;
  }

  const query =
    search instanceof HTMLInputElement ? search.value.trim().toLowerCase() : "";
  const visibleTools = state.tools.filter((tool) => matchesFilter(tool, query));
  container.innerHTML = "";

  for (const group of state.groups) {
    const groupTools = visibleTools.filter((tool) => tool.groupId === group.id);
    if (groupTools.length === 0) {
      continue;
    }

    const section = el("section", "tool-group");
    section.id = `group-${group.id}`;

    const header = el("div", "section-heading compact");
    header.appendChild(el("p", "eyebrow", "Tool Group"));
    header.appendChild(el("h2", "", group.title));
    header.appendChild(
      el("p", "", `${groupTools.length} registered tools in this group.`)
    );
    section.appendChild(header);

    const grid = el("div", "tool-grid");
    for (const tool of groupTools) {
      grid.appendChild(renderToolCard(tool));
    }
    section.appendChild(grid);
    container.appendChild(section);
  }

  setText("tool-count", String(state.tools.length));
  setText("visible-tool-count", String(visibleTools.length));
  setText("group-count", String(state.groups.length));
}

async function loadTools() {
  const response = await fetch(TOOLS_URL);
  if (!response.ok) {
    throw new Error(`Could not load ${TOOLS_URL}`);
  }
  const payload = await response.json();
  state.tools = Array.isArray(payload.tools) ? payload.tools : [];
  state.groups = Array.isArray(payload.groups) ? payload.groups : [];
  renderTools();
}

function bindSearch() {
  const input = document.getElementById("tool-search");
  if (input instanceof HTMLInputElement) {
    input.addEventListener("input", renderTools);
  }
}

bindSearch();
loadTools().catch((error) => {
  const container = document.getElementById("tools-container");
  if (container) {
    container.innerHTML = `<div class="note warning">${error.message}</div>`;
  }
});
