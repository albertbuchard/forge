import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InjectOptions } from "light-my-request";
import type { z } from "zod";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { campaignCriterionSchema } from "./work/types.js";

export type WorkTestServer = Awaited<ReturnType<typeof buildServer>>;

export async function withWorkTestServer(
  name: string,
  run: (input: {
    app: WorkTestServer;
    cookie: string;
    dataRoot: string;
  }) => Promise<void>
) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), `forge-work-${name}-`));
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false,
    taskRunWatchdog: false
  });
  if (process.env.FORGE_WORK_TEST_DEBUG_ERRORS === "1") {
    app.addHook("onError", async (_request, _reply, error) => {
      console.error(error);
    });
  }
  try {
    await run({
      app,
      cookie: issueTestOperatorSessionCookie(app),
      dataRoot
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

export async function injectJson<T>(
  app: WorkTestServer,
  cookie: string,
  input: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    url: string;
    payload?: unknown;
    expectedStatus?: number;
    authorization?: string;
  }
) {
  const request: InjectOptions = {
    method: input.method,
    url: input.url,
    headers: input.authorization
      ? { authorization: input.authorization }
      : { cookie },
    ...(input.payload === undefined
      ? {}
      : { payload: input.payload as InjectOptions["payload"] })
  };
  const response = await app.inject(request);
  assert.equal(
    response.statusCode,
    input.expectedStatus ?? 200,
    `${input.method} ${input.url}: ${response.body}`
  );
  return response.json() as T;
}

export const userProvenance = {
  sourceKind: "user" as const,
  sourceLabel: "Work integration test"
};

type CampaignCriterionInput = z.input<typeof campaignCriterionSchema>;

export const baseCriterion: CampaignCriterionInput = {
  key: "location_remote",
  section: "geography" as const,
  field: "workModel",
  kind: "set" as const,
  importance: "hard" as const,
  weight: 100,
  operator: "in" as const,
  value: ["remote", "hybrid"],
  flexibility: "low" as const,
  rationale: "The campaign is intentionally remote-first.",
  disqualificationRule: "Reject roles that require full-time on-site work."
};

export function initialCriteria(
  overrides: Partial<CampaignCriterionInput> = {}
) {
  return {
    schemaVersion: 1 as const,
    criteria: [{ ...baseCriterion, ...overrides }],
    rankingWeights: { geography: 100 },
    dealBreakers: ["Full-time on-site work"],
    acceptableTradeoffs: [],
    uncertaintyTolerance: "medium" as const,
    minimumExcitement: 3,
    includeKeywords: [],
    excludeKeywords: [],
    requiredSources: [],
    minimumConfidence: 0.7
  };
}

export async function createEngagement(
  app: WorkTestServer,
  cookie: string,
  input: Record<string, unknown> = {}
) {
  const result = await injectJson<{ engagement: Record<string, unknown> }>(
    app,
    cookie,
    {
      method: "POST",
      url: "/api/v1/work/engagements",
      expectedStatus: 201,
      payload: {
        title: "Research appointment",
        roleFunction: "Research and engineering",
        status: "current",
        engagementType: "appointment",
        workModel: "hybrid",
        workload: {
          contractedWeeklyHours: 32,
          actualWeeklyHours: 36,
          fullTimeEquivalent: 0.8,
          unknown: false
        },
        noticePeriod: {
          value: 3,
          unit: "months",
          negotiable: true,
          conditions: "Subject to handover",
          unknown: false
        },
        compensation: {
          base: {
            amount: 120000,
            currency: "CHF",
            basis: "gross",
            period: "year",
            negotiable: false,
            unknown: false
          }
        },
        nextAction: "Review the next quarterly objective",
        provenance: userProvenance,
        ...input
      }
    }
  );
  return result.engagement;
}

export async function createCampaign(
  app: WorkTestServer,
  cookie: string,
  input: Record<string, unknown> = {}
) {
  const result = await injectJson<{ campaign: Record<string, unknown> }>(
    app,
    cookie,
    {
      method: "POST",
      url: "/api/v1/work/campaigns",
      expectedStatus: 201,
      payload: {
        title: "Machine-learning research roles",
        status: "active",
        searchIntent: "full_time_employment",
        currentStage: "discovering",
        health: "healthy",
        nextAction: "Review new roles",
        initialCriteria: initialCriteria(),
        provenance: userProvenance,
        ...input
      }
    }
  );
  return result.campaign;
}

export async function createOpportunity(
  app: WorkTestServer,
  cookie: string,
  input: Record<string, unknown> = {}
) {
  const result = await injectJson<{
    opportunity: Record<string, unknown>;
    replayed: boolean;
    deduplicated: boolean;
  }>(app, cookie, {
    method: "POST",
    url: "/api/v1/work/opportunities/upsert",
    expectedStatus: 201,
    payload: {
      canonicalUrl: "https://example.test/jobs/research-engineer",
      sourceName: "Example careers",
      sourceIdentifier: "research-engineer-1",
      title: "Senior machine-learning research engineer",
      employerName: "Example Research",
      roleFamily: "Machine learning research",
      seniority: "Senior",
      description: "Build and evaluate research systems.",
      workModel: "remote",
      employmentType: "full_time_employment",
      availabilityStatus: "live",
      confidence: 0.95,
      unknowns: ["Exact team size"],
      nextAction: "Evaluate against the active campaign",
      provenance: {
        sourceKind: "external_source",
        sourceLabel: "Example careers",
        sourceUrl: "https://example.test/jobs/research-engineer"
      },
      idempotencyKey: "opportunity-example-1",
      ...input
    }
  });
  return result;
}
