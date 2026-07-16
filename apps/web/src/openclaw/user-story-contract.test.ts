import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer } from "../../../../apps/api/src/app";
import { ROUTE_VIEW_IDS } from "../routes/route-view-catalog";

const contractPath = [
  path.resolve(process.cwd(), "docs/reference/user-stories-and-use-cases.md"),
  path.resolve(
    process.cwd(),
    "../../docs/reference/user-stories-and-use-cases.md"
  )
].find((candidate) => existsSync(candidate));

if (!contractPath) {
  throw new Error("Cannot locate the Forge user-story product contract");
}

type OnboardingContract = {
  entityCatalog: Array<{ entityType: string }>;
  entityRouteModel: {
    specializedCrudEntities: Record<
      string,
      {
        methodRoutes?: Record<string, { method: string; path: string }>;
      }
    >;
    specializedDomainSurfaces: Record<
      string,
      { methodRoutes: Record<string, string> }
    >;
  };
};

function readSection(
  document: string,
  startHeading: string,
  endHeading: string
) {
  const start = document.indexOf(startHeading);
  const end = document.indexOf(endHeading, start + startHeading.length);
  expect(start, `${startHeading} should exist`).toBeGreaterThanOrEqual(0);
  expect(
    end,
    `${endHeading} should exist after ${startHeading}`
  ).toBeGreaterThan(start);
  return document.slice(start, end);
}

async function loadOnboarding(): Promise<OnboardingContract> {
  const dataRoot = mkdtempSync(
    path.join(os.tmpdir(), "forge-user-story-contract-")
  );
  const app = await buildServer({ dataRoot, taskRunWatchdog: false });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding"
    });
    expect(response.statusCode).toBe(200);
    return response.json().onboarding as OnboardingContract;
  } finally {
    await app.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

describe("Forge user-story product contract", () => {
  it("covers every current web route without stale route markers", () => {
    const document = readFileSync(contractPath, "utf8");
    const routeSection = readSection(
      document,
      "## Route Coverage Index",
      "## Entity And API Coverage Index"
    );
    const documentedRouteIds = [
      ...routeSection.matchAll(/`([a-z0-9-]+)`/g)
    ].map((match) => match[1]);

    expect(new Set(documentedRouteIds)).toEqual(new Set(ROUTE_VIEW_IDS));
    expect(documentedRouteIds).toHaveLength(ROUTE_VIEW_IDS.length);
  });

  it("covers every live onboarding entity and exact dedicated route template", async () => {
    const document = readFileSync(contractPath, "utf8");
    const entitySection = readSection(
      document,
      "## Entity And API Coverage Index",
      "## Adapter And Native Coverage"
    );
    const onboarding = await loadOnboarding();

    for (const { entityType } of onboarding.entityCatalog) {
      expect(
        entitySection,
        `${entityType} should be present in the entity/API index`
      ).toContain(`\`${entityType}\``);
    }

    const domainTemplates = Object.values(
      onboarding.entityRouteModel.specializedDomainSurfaces
    ).flatMap((surface) => Object.values(surface.methodRoutes));
    const crudTemplates = Object.values(
      onboarding.entityRouteModel.specializedCrudEntities
    ).flatMap((entity) =>
      Object.values(entity.methodRoutes ?? {}).map(
        ({ method, path: routePath }) => `${method.toUpperCase()} ${routePath}`
      )
    );

    for (const template of new Set([...domainTemplates, ...crudTemplates])) {
      expect(
        entitySection,
        `${template} should be documented from live onboarding`
      ).toContain(`\`${template}\``);
    }
  });

  it("keeps the inventory actionable, cross-surface, and feature-retaining", () => {
    const document = readFileSync(contractPath, "utf8");
    const storyIds = [...document.matchAll(/^\| ([A-Z]+-\d+)\s+\|/gm)].map(
      (match) => match[1]
    );

    expect(new Set(storyIds).size).toBe(storyIds.length);
    expect(storyIds.length).toBeGreaterThanOrEqual(120);
    for (const prefix of [
      "SYS",
      "HOME",
      "PLAN",
      "CAL",
      "KNOW",
      "ART",
      "PEOPLE",
      "PREF",
      "PSY",
      "HEALTH",
      "NUTR",
      "MOVE",
      "LF",
      "FLOW",
      "AGENT",
      "OPS",
      "GAME",
      "IOS",
      "WATCH"
    ]) {
      expect(
        storyIds.some((storyId) => storyId.startsWith(`${prefix}-`)),
        `${prefix} should have at least one user story`
      ).toBe(true);
    }

    for (const requiredText of [
      "## Quality Gates",
      "## Known Improvement Opportunities",
      "## Improvement Ledger",
      "## Logic Audit Questions",
      "Performance work must optimize rendering, queries, caching, or virtualization instead of making the product sparser.",
      "OpenClaw",
      "Hermes",
      "Codex MCP",
      "Claude Code MCP",
      "Forge Memory",
      "iPhone",
      "watchOS",
      "Now, Work, Habits, Goals, Today, Health, Movement, Psyche, Inbox, Sync"
    ]) {
      expect(document).toContain(requiredText);
    }
  });
});
