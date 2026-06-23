const STORAGE_KEY = "forge_api_runtime_base_url";
const SPEC_URL = "./openapi.json";

const state = {
  spec: null,
  runtimeBaseUrl: "",
  ui: null
};

function normalizeRuntimeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed === "/") {
    return "/";
  }

  return trimmed.replace(/\/+$/, "");
}

function readInitialRuntimeBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("server");
  const fromStorage = window.localStorage.getItem(STORAGE_KEY);
  return normalizeRuntimeBaseUrl(fromQuery ?? fromStorage ?? "");
}

function updateQueryString(runtimeBaseUrl) {
  const url = new URL(window.location.href);
  if (runtimeBaseUrl) {
    url.searchParams.set("server", runtimeBaseUrl);
  } else {
    url.searchParams.delete("server");
  }
  window.history.replaceState({}, "", url);
}

function setRuntimeBaseUrl(runtimeBaseUrl) {
  state.runtimeBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl);

  if (state.runtimeBaseUrl) {
    window.localStorage.setItem(STORAGE_KEY, state.runtimeBaseUrl);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  updateQueryString(state.runtimeBaseUrl);
  syncRuntimeUi();
}

function uniqueServers(servers) {
  const seen = new Set();
  return servers.filter((server) => {
    if (!server || typeof server.url !== "string" || !server.url) {
      return false;
    }
    if (seen.has(server.url)) {
      return false;
    }
    seen.add(server.url);
    return true;
  });
}

function buildServers(spec) {
  const servers = [];

  if (state.runtimeBaseUrl) {
    servers.push({
      url: state.runtimeBaseUrl,
      description: "Selected live Forge runtime"
    });
  }

  if (
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
  ) {
    servers.push({
      url: window.location.origin,
      description: "Current local docs origin"
    });
  }

  servers.push(
    ...(Array.isArray(spec.servers) ? spec.servers : []).map((server) => ({
      url: server.url,
      description: server.description
    }))
  );

  return uniqueServers(servers);
}

function buildExplorerSpec(spec) {
  const explorerSpec = structuredClone(spec);
  explorerSpec.servers = buildServers(spec);
  return explorerSpec;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function renderStats(spec) {
  const pathEntries = Object.entries(spec.paths ?? {});
  const operationCount = pathEntries.reduce((count, [, pathItem]) => {
    return (
      count +
      Object.keys(pathItem ?? {}).filter((method) =>
        ["get", "post", "put", "patch", "delete", "head", "options"].includes(
          method.toLowerCase()
        )
      ).length
    );
  }, 0);

  setText("path-count", String(pathEntries.length));
  setText("operation-count", String(operationCount));
  setText("tag-count", String(Array.isArray(spec.tags) ? spec.tags.length : 0));
}

function renderTagGroups(spec) {
  const container = document.getElementById("tag-groups");
  if (!container) {
    return;
  }

  const groups = Array.isArray(spec["x-tagGroups"]) ? spec["x-tagGroups"] : [];
  const tags = new Map(
    (Array.isArray(spec.tags) ? spec.tags : []).map((tag) => [tag.name, tag])
  );

  container.innerHTML = "";

  for (const group of groups) {
    const article = document.createElement("article");
    article.className = "section-card tag-group-card";

    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = group.name;
    article.appendChild(eyebrow);

    const title = document.createElement("h3");
    title.textContent = `${group.tags.length} tagged surfaces`;
    article.appendChild(title);

    const list = document.createElement("div");
    list.className = "tag-pill-list";

    for (const tagName of group.tags) {
      const pill = document.createElement("span");
      pill.className = "pill";
      const description = tags.get(tagName)?.description ?? tagName;
      pill.title = description;
      pill.textContent = tagName;
      list.appendChild(pill);
    }

    const summary = document.createElement("p");
    summary.textContent = group.tags
      .map((tagName) => tags.get(tagName)?.description ?? tagName)
      .join(" ");

    article.appendChild(list);
    article.appendChild(summary);
    container.appendChild(article);
  }
}

function syncRuntimeUi() {
  const input = document.getElementById("runtime-base-url");
  const runtimeLabel = state.runtimeBaseUrl || "Spec defaults";
  const statusLabel = state.runtimeBaseUrl
    ? "Custom runtime active"
    : "Spec defaults active";
  const healthLink = document.getElementById("runtime-health-link");

  if (input instanceof HTMLInputElement) {
    input.value = state.runtimeBaseUrl;
  }

  setText("runtime-target", runtimeLabel);
  setText("runtime-status-pill", statusLabel);

  if (healthLink instanceof HTMLAnchorElement) {
    if (state.runtimeBaseUrl && state.runtimeBaseUrl !== "/") {
      healthLink.href = `${state.runtimeBaseUrl}/api/v1/health`;
    } else if (state.runtimeBaseUrl === "/") {
      healthLink.href = "/api/v1/health";
    } else {
      healthLink.href = "http://127.0.0.1:4317/api/v1/health";
    }
  }
}

function renderSwaggerUi() {
  if (!state.spec) {
    return;
  }

  const target = document.getElementById("swagger-ui");
  if (!target) {
    return;
  }

  target.innerHTML = "";

  state.ui = SwaggerUIBundle({
    dom_id: "#swagger-ui",
    spec: buildExplorerSpec(state.spec),
    deepLinking: true,
    persistAuthorization: true,
    displayOperationId: false,
    displayRequestDuration: true,
    docExpansion: "list",
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 1,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    tryItOutEnabled: true,
    operationsSorter: "alpha",
    tagsSorter: "alpha",
    supportedSubmitMethods: ["get", "post", "put", "patch", "delete"],
    syntaxHighlight: {
      activated: true,
      theme: "obsidian"
    }
  });
}

function bindControls() {
  const runtimeForm = document.getElementById("runtime-form");
  const useLocalButton = document.getElementById("use-local-runtime");
  const clearRuntimeButton = document.getElementById("clear-runtime");

  runtimeForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("runtime-base-url");
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    setRuntimeBaseUrl(input.value);
    renderSwaggerUi();
  });

  useLocalButton?.addEventListener("click", () => {
    setRuntimeBaseUrl("http://127.0.0.1:4317");
    renderSwaggerUi();
  });

  clearRuntimeButton?.addEventListener("click", () => {
    setRuntimeBaseUrl("");
    renderSwaggerUi();
  });
}

function renderError(error) {
  const target = document.getElementById("swagger-ui");
  if (!target) {
    return;
  }

  target.innerHTML = "";

  const card = document.createElement("div");
  card.className = "swagger-error";

  const title = document.createElement("h3");
  title.textContent = "Unable to load the Forge OpenAPI document.";

  const body = document.createElement("p");
  body.textContent =
    error instanceof Error
      ? error.message
      : "Unknown error while loading the spec.";

  card.appendChild(title);
  card.appendChild(body);
  target.appendChild(card);
}

async function initialize() {
  setRuntimeBaseUrl(readInitialRuntimeBaseUrl());
  bindControls();

  try {
    const response = await fetch(SPEC_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `Received ${response.status} while fetching ${SPEC_URL}.`
      );
    }

    state.spec = await response.json();
    renderStats(state.spec);
    renderTagGroups(state.spec);
    renderSwaggerUi();
  } catch (error) {
    renderError(error);
  }
}

window.addEventListener("DOMContentLoaded", initialize);
