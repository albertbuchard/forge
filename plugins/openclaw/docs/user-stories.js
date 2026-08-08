(() => {
  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  const form = document.querySelector("[data-story-filters]");
  if (!form) return;

  const search = form.querySelector("[name='q']");
  const readiness = form.querySelector("[name='readiness']");
  const family = form.querySelector("[name='family']");
  const filterPanel = document.querySelector("[data-filter-panel]");
  const filterSummary = document.querySelector("[data-filter-summary]");
  const scopeButtons = [...form.querySelectorAll("[data-scope]")];
  const storyCards = [...document.querySelectorAll("[data-story-id]")];
  const familyGroups = [...document.querySelectorAll("[data-family-group]")];
  const metricFilters = [
    ...document.querySelectorAll("[data-metric-scope], [data-metric-readiness]")
  ];
  const metricFamilyPicker = document.querySelector(
    "[data-metric-family-picker]"
  );
  const storyBrowser = document.querySelector("#story-families");
  const resultCount = document.querySelector("[data-result-count]");
  const emptyResults = document.querySelector("[data-empty-results]");
  const resetButtons = [...document.querySelectorAll("[data-reset-filters]")];
  const expandAll = document.querySelector("[data-expand-all]");
  const collapseAll = document.querySelector("[data-collapse-all]");
  const validScopes = new Set(["all", "current", "planned"]);
  const validReadiness = new Set(
    [...readiness.options].map((option) => option.value)
  );
  const validFamilies = new Set(
    [...family.options].map((option) => option.value)
  );
  const parameters = new URLSearchParams(window.location.search);

  const state = {
    query: parameters.get("q")?.trim() ?? "",
    scope: validScopes.has(parameters.get("scope"))
      ? parameters.get("scope")
      : "all",
    readiness: validReadiness.has(parameters.get("readiness"))
      ? parameters.get("readiness")
      : "all",
    family: validFamilies.has(parameters.get("family"))
      ? parameters.get("family")
      : "all"
  };

  search.value = state.query;
  readiness.value = state.readiness;
  family.value = state.family;

  function hasActiveFilters() {
    return (
      state.query !== "" ||
      state.scope !== "all" ||
      state.readiness !== "all" ||
      state.family !== "all"
    );
  }

  function updateUrl() {
    const next = new URLSearchParams();
    if (state.query) next.set("q", state.query);
    if (state.scope !== "all") next.set("scope", state.scope);
    if (state.readiness !== "all") next.set("readiness", state.readiness);
    if (state.family !== "all") next.set("family", state.family);
    const query = next.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }

  function replaceFragment(fragment = "") {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${fragment}`
    );
  }

  function cardMatches(card) {
    const matchesQuery =
      !state.query ||
      card.textContent.toLowerCase().includes(state.query.toLowerCase());
    const matchesScope =
      state.scope === "all" || card.dataset.lifecycle === state.scope;
    const matchesReadiness =
      state.readiness === "all" || card.dataset.readiness === state.readiness;
    const matchesFamily =
      state.family === "all" || card.dataset.family === state.family;
    return matchesQuery && matchesScope && matchesReadiness && matchesFamily;
  }

  function updateBulkActions() {
    if (hasActiveFilters()) {
      expandAll.hidden = true;
      collapseAll.hidden = true;
      return;
    }

    const visibleGroups = familyGroups.filter((group) => !group.hidden);
    const openGroups = visibleGroups.filter((group) => group.open);
    expandAll.hidden = openGroups.length === visibleGroups.length;
    collapseAll.hidden = openGroups.length === 0;
  }

  function updateMetricStates() {
    const hasNarrowingTextOrFamily =
      state.query !== "" || state.family !== "all";
    metricFilters.forEach((metric) => {
      const scope = metric.dataset.metricScope;
      const metricReadiness = metric.dataset.metricReadiness;
      const isActive =
        !hasNarrowingTextOrFamily &&
        (scope
          ? state.scope === scope && state.readiness === "all"
          : state.scope === "all" && state.readiness === metricReadiness);
      if (isActive) metric.setAttribute("aria-current", "true");
      else metric.removeAttribute("aria-current");
    });
  }

  function applyFilters({ updateAddress = true } = {}) {
    if (state.scope === "planned" && state.readiness !== "all") {
      state.readiness = "all";
      readiness.value = "all";
    }
    readiness.disabled = state.scope === "planned";

    scopeButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scope === state.scope)
      );
    });

    let visibleStories = 0;
    storyCards.forEach((card) => {
      const visible = cardMatches(card);
      card.hidden = !visible;
      if (visible) visibleStories += 1;
    });

    familyGroups.forEach((group) => {
      const visibleInFamily = [
        ...group.querySelectorAll("[data-story-id]")
      ].filter((card) => !card.hidden).length;
      group.hidden = visibleInFamily === 0;
      group.querySelector("[data-family-visible]").textContent =
        String(visibleInFamily);
      if (visibleInFamily > 0 && hasActiveFilters()) group.open = true;
    });

    const totalLabel = visibleStories === 1 ? "story" : "stories";
    resultCount.textContent = hasActiveFilters()
      ? `Showing ${visibleStories} matching ${totalLabel}.`
      : `Showing all ${visibleStories} ${totalLabel}.`;
    emptyResults.hidden = visibleStories !== 0;
    resetButtons.forEach((button) => {
      button.hidden = !hasActiveFilters();
    });
    const focusIsInsideFilter = filterPanel.contains(document.activeElement);
    filterPanel.open =
      hasActiveFilters() || (filterPanel.open && focusIsInsideFilter);
    filterSummary.textContent = hasActiveFilters()
      ? "Filters active"
      : "Search, lifecycle, readiness, or family";
    updateBulkActions();
    updateMetricStates();

    if (updateAddress) updateUrl();
  }

  function resetFilters() {
    state.query = "";
    state.scope = "all";
    state.readiness = "all";
    state.family = "all";
    search.value = "";
    readiness.value = "all";
    family.value = "all";
    applyFilters();
    familyGroups.forEach((group) => {
      group.open = false;
    });
    storyCards.forEach((story) => {
      story.open = false;
    });
    updateBulkActions();
    filterPanel.open = false;
    filterPanel.querySelector("summary").focus();
  }

  scopeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.scope = button.dataset.scope;
      applyFilters();
    });
  });

  search.addEventListener("input", () => {
    state.query = search.value.trim();
    applyFilters();
  });

  readiness.addEventListener("change", () => {
    state.readiness = readiness.value;
    applyFilters();
  });

  family.addEventListener("change", () => {
    state.family = family.value;
    applyFilters();
  });

  resetButtons.forEach((button) =>
    button.addEventListener("click", resetFilters)
  );
  expandAll.addEventListener("click", () => {
    familyGroups
      .filter((group) => !group.hidden)
      .forEach((group) => {
        group.open = true;
      });
    updateBulkActions();
  });
  collapseAll.addEventListener("click", () => {
    familyGroups
      .filter((group) => !group.hidden)
      .forEach((group) => {
        group.open = false;
      });
    updateBulkActions();
  });
  familyGroups.forEach((group) =>
    group.addEventListener("toggle", updateBulkActions)
  );
  metricFilters.forEach((metric) => {
    metric.addEventListener("click", (event) => {
      event.preventDefault();
      replaceFragment();
      state.query = "";
      state.family = "all";
      state.scope = metric.dataset.metricScope ?? "all";
      state.readiness = metric.dataset.metricReadiness ?? "all";
      search.value = "";
      family.value = "all";
      readiness.value = state.readiness;
      applyFilters();
      storyBrowser.scrollIntoView?.({ block: "start" });
    });
  });
  metricFamilyPicker.addEventListener("click", (event) => {
    event.preventDefault();
    replaceFragment("#story-families");
    filterPanel.open = true;
    family.focus();
    storyBrowser.scrollIntoView?.({ block: "start" });
  });

  window.addEventListener("popstate", () => window.location.reload());
  applyFilters();

  function revealLinkedStory(target) {
    const familyGroup = target.closest(".story-family");
    if (target.hidden || familyGroup?.hidden) {
      state.query = "";
      state.scope = "all";
      state.readiness = "all";
      state.family = "all";
      search.value = "";
      readiness.value = "all";
      family.value = "all";
      applyFilters();
      familyGroups.forEach((group) => {
        group.open = false;
      });
    }

    target.open = true;
    familyGroup?.setAttribute("open", "");

    const scrollToTarget = () =>
      target.scrollIntoView?.({ block: "center", inline: "nearest" });
    const scrollAfterLayout = () => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(scrollToTarget)
        );
      } else {
        scrollToTarget();
      }
    };

    scrollAfterLayout();
    if (document.readyState !== "complete") {
      window.addEventListener("load", scrollAfterLayout, { once: true });
    }
    document.fonts?.ready.then(scrollAfterLayout);
  }

  if (window.location.hash) {
    try {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      const target = document.getElementById(targetId);
      if (target?.matches("[data-story-id]")) revealLinkedStory(target);
      if (targetId === "story-families") filterPanel.open = true;
    } catch {
      // Malformed fragments do not change the complete, usable story list.
    }
  }
})();
