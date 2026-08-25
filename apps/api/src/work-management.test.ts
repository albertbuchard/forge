import assert from "node:assert/strict";
import test from "node:test";

import { getDatabase } from "./db.js";
import { activityEntityTypeValues } from "./types.js";
import {
  createCampaign,
  createEngagement,
  createOpportunity,
  initialCriteria,
  injectJson,
  userProvenance,
  withWorkTestServer
} from "./work-test-support.js";

test("Work remains a permanent context and preserves concurrent engagement history", async () => {
  await withWorkTestServer("permanent-context", async ({ app, cookie }) => {
    const initial = await injectJson<{
      settings: Array<Record<string, unknown>>;
      engagements: Array<Record<string, unknown>>;
      campaigns: Array<Record<string, unknown>>;
      summary: Record<string, number>;
    }>(app, cookie, { method: "GET", url: "/api/v1/work/context" });
    assert.equal(initial.settings[0]?.lookingForOpportunities, false);
    assert.equal(initial.summary.currentEngagements, 0);
    assert.deepEqual(initial.engagements, []);

    const hospital = await createEngagement(app, cookie, {
      id: "engagement_hospital",
      title: "Hospital appointment",
      roleFunction: "Clinical research",
      engagementType: "appointment",
      priority: "high"
    });
    const freelance = await createEngagement(app, cookie, {
      id: "engagement_freelance",
      title: "Freelance builder",
      roleFunction: "Product engineering",
      engagementType: "freelance",
      workload: {
        contractedWeeklyHours: 8,
        actualWeeklyHours: 6,
        fullTimeEquivalent: 0.2,
        unknown: false
      },
      compensation: {
        hourlyRate: {
          amount: 140,
          currency: "CHF",
          basis: "gross",
          period: "hour",
          negotiable: true,
          unknown: false
        }
      }
    });

    const context = await injectJson<{
      engagements: Array<Record<string, unknown>>;
      summary: Record<string, number>;
    }>(app, cookie, { method: "GET", url: "/api/v1/work/context" });
    assert.equal(context.summary.currentEngagements, 2);
    assert.deepEqual(
      new Set(context.engagements.map((entry) => entry.id)),
      new Set([hospital.id, freelance.id])
    );

    const archived = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: `/api/v1/work/work_engagement/${hospital.id}/archive`,
        payload: { expectedRevision: hospital.revision }
      }
    );
    assert.ok(archived.record.deletedAt);
    assert.equal(archived.record.status, "archived");

    const archivedList = await injectJson<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>(app, cookie, {
      method: "GET",
      url: "/api/v1/work/engagements?archived=only"
    });
    assert.equal(archivedList.total, 1);
    assert.equal(archivedList.items[0]?.id, hospital.id);

    const restored = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: `/api/v1/work/work_engagement/${hospital.id}/restore`,
        payload: { expectedRevision: archived.record.revision }
      }
    );
    assert.equal(restored.record.deletedAt, null);
    assert.equal(restored.record.status, "current");

    const detail = await injectJson<{
      engagement: { history: Array<Record<string, unknown>> };
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/engagements/${hospital.id}?archived=include`
    });
    const eventTypes = detail.engagement.history.map(
      (entry) => entry.eventType
    );
    assert.ok(eventTypes.includes("work_engagement_archived"));
    assert.ok(eventTypes.includes("work_engagement_restored"));
  });
});

test("Work check-ins preserve confirmation truth, idempotency, and longitudinal trends", async () => {
  await withWorkTestServer("check-ins", async ({ app, cookie }) => {
    const engagement = await createEngagement(app, cookie, {
      id: "engagement_metrics"
    });
    const definitions = await injectJson<{
      definitions: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "GET",
      url: "/api/v1/work/metrics/definitions"
    });
    const satisfaction = definitions.definitions.find(
      (definition) => definition.canonicalKey === "overall_satisfaction"
    );
    assert.ok(satisfaction);

    const basePayload = {
      engagementId: engagement.id,
      timezone: "Europe/Zurich",
      observedAt: "2026-08-01T08:00:00.000+02:00",
      note: "First confirmed check-in",
      sourceKind: "user_entered",
      confirmationState: "confirmed",
      observations: [
        {
          metricDefinitionId: satisfaction.id,
          numericValue: 3,
          missingState: "observed",
          note: "A stable but improvable week"
        }
      ],
      provenance: userProvenance,
      idempotencyKey: "check-in-satisfaction-1"
    };
    const first = await injectJson<{
      replayed: boolean;
      checkIn: Record<string, unknown>;
      observations: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/check-ins",
      expectedStatus: 201,
      payload: basePayload
    });
    assert.equal(first.replayed, false);
    assert.equal(first.observations[0]?.confirmationState, "confirmed");

    const replay = await injectJson<{ replayed: boolean }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/check-ins",
      payload: basePayload
    });
    assert.equal(replay.replayed, true);

    await injectJson(app, cookie, {
      method: "POST",
      url: "/api/v1/work/check-ins",
      expectedStatus: 201,
      payload: {
        ...basePayload,
        observedAt: "2026-08-20T08:00:00.000+02:00",
        note: "Second confirmed check-in",
        observations: [
          {
            metricDefinitionId: satisfaction.id,
            numericValue: 5,
            missingState: "observed"
          }
        ],
        idempotencyKey: "check-in-satisfaction-2"
      }
    });

    const rejectedSuggestion = await app.inject({
      method: "POST",
      url: "/api/v1/work/check-ins",
      headers: { cookie },
      payload: {
        ...basePayload,
        sourceKind: "agent_suggested",
        confirmationState: "confirmed",
        userConfirmation: null,
        idempotencyKey: "check-in-invalid-agent-confirmation"
      }
    });
    assert.equal(rejectedSuggestion.statusCode, 400, rejectedSuggestion.body);
    assert.match(rejectedSuggestion.body, /user-confirmation/i);

    const trends = await injectJson<{
      series: Array<Record<string, unknown>>;
      comparisons: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/metrics/trends?engagementIds=${engagement.id}&metricKeys=overall_satisfaction&windowDays=730`
    });
    assert.equal(trends.series.length, 1);
    const points = trends.series[0]?.points as Array<Record<string, unknown>>;
    assert.deepEqual(
      points.map((point) => point.numericValue),
      [3, 5]
    );
    assert.equal(
      (trends.series[0]?.meaningfulChange as Record<string, unknown>)
        ?.direction,
      "increased"
    );
  });
});

test("Opportunity Campaigns keep versioned criteria, deduplicated roles, and campaign-specific evaluation history", async () => {
  await withWorkTestServer("campaign-pipeline", async ({ app, cookie }) => {
    const sourceEngagement = await createEngagement(app, cookie, {
      id: "engagement_transition_source",
      status: "transitioning"
    });
    const primary = await createCampaign(app, cookie, {
      id: "campaign_research",
      sourceEngagementId: sourceEngagement.id
    });
    const secondary = await createCampaign(app, cookie, {
      id: "campaign_hospitality",
      title: "Part-time hospitality shifts",
      searchIntent: "shift_work",
      initialCriteria: initialCriteria({
        key: "weekly_hours",
        section: "workload",
        field: "weeklyHours.maximum",
        kind: "number",
        operator: "lte",
        value: 12,
        rationale: "This campaign must fit around the primary appointment."
      })
    });
    assert.notEqual(primary.id, secondary.id);

    const primaryDetail = await injectJson<{
      campaign: Record<string, unknown>;
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/campaigns/${primary.id}`
    });
    const firstCriteria = primaryDetail.campaign.currentCriteria as Record<
      string,
      unknown
    >;
    assert.equal(firstCriteria.version, 1);

    const revised = await injectJson<{
      criteriaVersion: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/campaigns/${primary.id}/criteria`,
      expectedStatus: 201,
      payload: {
        criteria: initialCriteria({ weight: 80 }),
        rationale: "Remote-first remains hard, with revised ranking weight.",
        provenance: userProvenance
      }
    });
    assert.equal(revised.criteriaVersion.version, 2);

    const discovered = await createOpportunity(app, cookie);
    assert.equal(discovered.deduplicated, false);
    const replay = await injectJson<{
      replayed: boolean;
      deduplicated: boolean;
      opportunity: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/opportunities/upsert",
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
        idempotencyKey: "opportunity-example-1"
      }
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.opportunity.id, discovered.opportunity.id);

    const evaluationPayload = {
      criteriaVersionId: revised.criteriaVersion.id,
      evaluator: {
        kind: "human_user",
        id: "user_operator",
        label: "Operator",
        source: "ui"
      },
      overallScore: 84,
      confidence: 0.9,
      hardGateResult: "pass",
      criterionScores: [
        {
          criterionKey: "location_remote",
          result: "pass",
          score: 100,
          weightedContribution: 80,
          confidence: 0.95,
          explanation: "The sourced role is explicitly remote."
        }
      ],
      recommendation: "Shortlist and prepare application materials.",
      provenance: userProvenance
    };
    const evaluationOne = await injectJson<{
      evaluation: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/campaigns/${primary.id}/opportunities/${discovered.opportunity.id}/evaluations`,
      expectedStatus: 201,
      payload: evaluationPayload
    });
    const evaluationTwo = await injectJson<{
      evaluation: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/campaigns/${primary.id}/opportunities/${discovered.opportunity.id}/evaluations`,
      expectedStatus: 201,
      payload: {
        ...evaluationPayload,
        overallScore: 76,
        hardGateResult: "needs_review",
        humanOverride: {
          value: "needs_review",
          reason: "The office-day policy still needs confirmation.",
          actorId: "user_operator"
        }
      }
    });
    assert.equal(evaluationOne.evaluation.evaluationVersion, 1);
    assert.equal(evaluationTwo.evaluation.evaluationVersion, 2);

    const storedEvaluations = getDatabase()
      .prepare(
        `SELECT evaluation_version, criteria_version_id, hard_gate_result
         FROM campaign_opportunity_evaluations
         WHERE campaign_id = ? AND opportunity_id = ?
         ORDER BY evaluation_version`
      )
      .all(String(primary.id), String(discovered.opportunity.id)) as Array<{
      evaluation_version: number;
      criteria_version_id: string;
      hard_gate_result: string;
    }>;
    assert.deepEqual(
      storedEvaluations.map((entry) => entry.evaluation_version),
      [1, 2]
    );
    assert.ok(
      storedEvaluations.every(
        (entry) => entry.criteria_version_id === revised.criteriaVersion.id
      )
    );

    const settingsOn = await injectJson<{ settings: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "PATCH",
        url: "/api/v1/work/settings/opportunity-search",
        payload: { lookingForOpportunities: true, expectedRevision: 0 }
      }
    );
    assert.equal(settingsOn.settings.lookingForOpportunities, true);
    const settingsOff = await injectJson<{ settings: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "PATCH",
        url: "/api/v1/work/settings/opportunity-search",
        payload: {
          lookingForOpportunities: false,
          expectedRevision: settingsOn.settings.revision
        }
      }
    );
    assert.equal(settingsOff.settings.lookingForOpportunities, false);

    const campaigns = await injectJson<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>(app, cookie, { method: "GET", url: "/api/v1/work/campaigns" });
    assert.equal(campaigns.total, 2);
    assert.deepEqual(
      new Set(campaigns.items.map((campaign) => campaign.id)),
      new Set([primary.id, secondary.id])
    );
  });
});

test("Work activity remains valid in the global context and OpenAPI contract", async () => {
  await withWorkTestServer(
    "global-activity-contract",
    async ({ app, cookie }) => {
      const campaign = await createCampaign(app, cookie, {
        id: "campaign_global_activity"
      });
      const opportunity = await createOpportunity(app, cookie, {
        id: "opportunity_global_activity",
        idempotencyKey: "opportunity-global-activity"
      });
      const application = await injectJson<{
        application: Record<string, unknown>;
      }>(app, cookie, {
        method: "POST",
        url: "/api/v1/work/applications",
        expectedStatus: 201,
        payload: {
          id: "application_global_activity",
          opportunityId: opportunity.opportunity.id,
          primaryCampaignId: campaign.id,
          status: "preparing",
          nextAction: "Review the application workspace",
          provenance: userProvenance
        }
      });
      const profile = await injectJson<{ record: Record<string, unknown> }>(
        app,
        cookie,
        {
          method: "POST",
          url: "/api/v1/work/supporting/positioningProfile",
          expectedStatus: 201,
          payload: {
            data: {
              title: "Research positioning",
              provenance: userProvenance
            }
          }
        }
      );

      const storedTypes = getDatabase()
        .prepare(
          `SELECT entity_type
         FROM activity_events
         WHERE entity_id IN (?, ?)
         ORDER BY entity_type`
        )
        .all(
          String(application.application.id),
          String(profile.record.id)
        ) as Array<{
        entity_type: string;
      }>;
      assert.deepEqual(
        storedTypes.map((entry) => entry.entity_type),
        ["candidate_positioning_profile", "job_application"]
      );

      const contextResponse = await app.inject({
        method: "GET",
        url: "/api/v1/context",
        headers: { cookie }
      });
      assert.equal(contextResponse.statusCode, 200, contextResponse.body);
      const context = contextResponse.json() as {
        activity: Array<{ entityType: string; entityId: string }>;
      };
      assert.ok(
        context.activity.some(
          (entry) =>
            entry.entityType === "job_application" &&
            entry.entityId === application.application.id
        )
      );
      assert.ok(
        context.activity.some(
          (entry) =>
            entry.entityType === "candidate_positioning_profile" &&
            entry.entityId === profile.record.id
        )
      );

      const openApiResponse = await app.inject({
        method: "GET",
        url: "/api/v1/openapi.json",
        headers: { cookie }
      });
      assert.equal(openApiResponse.statusCode, 200, openApiResponse.body);
      const openApi = openApiResponse.json() as {
        components: {
          schemas: {
            ActivityEvent: {
              properties: { entityType: { enum: string[] } };
            };
          };
        };
      };
      assert.deepEqual(
        openApi.components.schemas.ActivityEvent.properties.entityType.enum,
        [...activityEntityTypeValues]
      );
    }
  );
});
