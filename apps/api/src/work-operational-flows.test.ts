import assert from "node:assert/strict";
import test from "node:test";

import { getDatabase } from "./db.js";
import {
  createCampaign,
  createEngagement,
  createOpportunity,
  injectJson,
  userProvenance,
  withWorkTestServer
} from "./work-test-support.js";

test("typed Work relationships are bidirectional, revisioned, and collision-free", async () => {
  await withWorkTestServer("typed-relationships", async ({ app, cookie }) => {
    const engagement = await createEngagement(app, cookie, {
      id: "engagement_relationship_source",
      status: "transitioning"
    });
    const campaign = await createCampaign(app, cookie, {
      id: "campaign_relationship_target",
      sourceEngagementId: engagement.id
    });

    const replaced = await injectJson<{
      links: Array<Record<string, unknown>>;
      related: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "PUT",
      url: `/api/v1/work/relationships/work_engagement/${engagement.id}`,
      payload: {
        expectedRevision: engagement.revision,
        links: [
          {
            targetEntityType: "opportunity_campaign",
            targetEntityId: campaign.id,
            relationship: "motivates",
            anchorKey: "transition-search"
          }
        ]
      }
    });
    assert.equal(replaced.links.length, 1);
    assert.equal(replaced.links[0]?.sourceEntityType, "work_engagement");
    assert.equal(replaced.links[0]?.targetEntityType, "opportunity_campaign");
    assert.deepEqual(replaced.related, [
      {
        entityType: "opportunity_campaign",
        entityId: campaign.id,
        relationship: "motivates",
        anchorKey: "transition-search",
        direction: "outbound",
        title: "Machine-learning research roles",
        detail: "active"
      }
    ]);

    const campaignLinks = await injectJson<{
      links: Array<Record<string, unknown>>;
      related: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/relationships/opportunity_campaign/${campaign.id}`
    });
    assert.ok(
      campaignLinks.links.some(
        (link) =>
          link.sourceEntityType === "work_engagement" &&
          link.sourceEntityId === engagement.id &&
          link.relationship === "motivates"
      )
    );
    assert.deepEqual(campaignLinks.related, [
      {
        entityType: "work_engagement",
        entityId: engagement.id,
        relationship: "motivates",
        anchorKey: "transition-search",
        direction: "inbound",
        title: "Research appointment",
        detail: "Research and engineering"
      }
    ]);

    const replayedReplacement = await injectJson<{
      links: Array<Record<string, unknown>>;
      related: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "PUT",
      url: `/api/v1/work/relationships/work_engagement/${engagement.id}`,
      payload: {
        expectedRevision: Number(engagement.revision) + 1,
        links: [
          {
            targetEntityType: "opportunity_campaign",
            targetEntityId: campaign.id,
            relationship: "motivates",
            anchorKey: "transition-search"
          },
          {
            targetEntityType: "opportunity_campaign",
            targetEntityId: campaign.id,
            relationship: "motivates",
            anchorKey: "transition-search"
          }
        ]
      }
    });
    assert.equal(replayedReplacement.links.length, 1);
    assert.equal(replayedReplacement.related.length, 1);
    assert.equal(
      replayedReplacement.related[0]?.title,
      "Machine-learning research roles"
    );

    const forbidden = await app.inject({
      method: "PUT",
      url: `/api/v1/work/relationships/work_engagement/${engagement.id}`,
      headers: { cookie },
      payload: {
        expectedRevision: Number(engagement.revision) + 2,
        links: [
          {
            targetEntityType: "work_engagement",
            targetEntityId: engagement.id,
            relationship: "self_reference"
          }
        ]
      }
    });
    assert.equal(forbidden.statusCode, 400, forbidden.body);
    assert.match(forbidden.body, /itself|self/i);
  });
});

test("campaign targets, sources, policies, and search runs preserve exact criteria and evidence", async () => {
  await withWorkTestServer("search-operations", async ({ app, cookie }) => {
    const organization = await injectJson<{
      organization: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/organizations",
      expectedStatus: 201,
      payload: {
        id: "organization_search_target",
        name: "Research Target",
        domain: "Machine learning",
        status: "target",
        provenance: userProvenance
      }
    });
    const campaign = await createCampaign(app, cookie, {
      id: "campaign_search_operations"
    });
    const campaignDetail = await injectJson<{
      campaign: Record<string, unknown>;
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/campaigns/${campaign.id}`
    });
    const criteria = campaignDetail.campaign.currentCriteria as Record<
      string,
      unknown
    >;
    assert.equal(criteria.version, 1);

    const roleTarget = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: `/api/v1/work/supporting/roleTarget?parentId=${campaign.id}`,
        expectedStatus: 201,
        payload: {
          data: {
            titleFamily: "Machine-learning research engineer",
            aliases: ["Research engineer", "Applied scientist"],
            seniority: "Senior",
            responsibilities: ["Build research systems"],
            requiredQualifications: ["Evidence of research engineering"],
            desiredQualifications: ["Publication record"],
            transferableEvidence: ["Production machine-learning projects"],
            knownGaps: ["No evidence about the target team's domain"],
            evidenceActions: ["Review recent team publications"],
            searchTerms: ["machine learning research engineer"],
            queryFragments: ["senior AND research engineer"],
            priority: 90
          }
        }
      }
    );
    const organizationTarget = await injectJson<{
      record: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/supporting/organizationTarget?parentId=${campaign.id}`,
      expectedStatus: 201,
      payload: {
        data: {
          organizationId: organization.organization.id,
          targetTier: "priority",
          rationale: "Strong research environment.",
          status: "active",
          nextAction: "Map warm introduction paths"
        }
      }
    });
    assert.equal(
      organizationTarget.record.organizationId,
      organization.organization.id
    );

    const source = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: `/api/v1/work/supporting/searchSource?parentId=${campaign.id}`,
        expectedStatus: 201,
        payload: {
          data: {
            name: "Research Target careers",
            sourceType: "organization_careers",
            canonicalUrl: "https://example.test/careers",
            reliability: 0.9,
            costConstraints: {
              billingModel: "free",
              maximumPerRun: 0,
              currency: "CHF"
            },
            rateConstraints: {
              maximumRequests: 10,
              windowSeconds: 3600
            },
            enabled: true,
            provenance: {
              sourceKind: "external_source",
              sourceLabel: "Research Target careers"
            }
          }
        }
      }
    );
    await injectJson(app, cookie, {
      method: "POST",
      url: `/api/v1/work/supporting/savedQuery?parentId=${campaign.id}`,
      expectedStatus: 201,
      payload: {
        data: {
          sourceId: source.record.id,
          criteriaVersionId: criteria.id,
          title: "Remote senior research roles",
          queryText: "senior machine learning research engineer",
          geography: { allowed: ["Switzerland", "Remote"] },
          filters: { workModel: ["remote", "hybrid"] },
          cadence: "daily",
          freshnessHours: 24,
          enabled: true
        }
      }
    });
    await injectJson(app, cookie, {
      method: "POST",
      url: `/api/v1/work/supporting/automationPolicy?parentId=${campaign.id}`,
      expectedStatus: 201,
      payload: {
        data: {
          criteriaVersionId: criteria.id,
          researchAuthority: "allowed",
          preparationAuthority: "review_required",
          uploadAuthority: "review_required",
          submissionAuthority: "review_required",
          reviewRequiredClasses: ["Any role with legal declarations"],
          automaticEligibility: {
            enabled: false,
            minimumScore: 85,
            minimumConfidence: 0.8,
            requireHardGatePass: true,
            requireNoUnresolvedFacts: true,
            allowedRoleClasses: [],
            excludedEmployerClasses: []
          },
          compensationGates: [
            {
              kind: "minimum_base",
              operator: "greater_than_or_equal",
              amount: 120000,
              currency: "CHF",
              period: "year"
            }
          ],
          legalAnswerGates: [
            {
              category: "work_authorization",
              requirement: "user_confirmation_required"
            }
          ],
          maximumApplications: 12,
          duplicatePrevention: true
        }
      }
    });

    const opportunity = await createOpportunity(app, cookie, {
      id: "opportunity_search_run",
      organizationId: organization.organization.id,
      idempotencyKey: "opportunity-search-run"
    });
    const runPayload = {
      campaignId: campaign.id,
      criteriaVersionId: criteria.id,
      data: {
        agent: {
          kind: "agent",
          id: "agent_search_test",
          label: "Search test agent",
          source: "agent"
        },
        status: "partial",
        sources: [
          {
            sourceId: source.record.id,
            url: "https://example.test/careers"
          }
        ],
        queries: ["senior machine learning research engineer"],
        counts: {
          found: 2,
          new: 1,
          changed: 0,
          duplicate: 0,
          stale: 0,
          closed: 0,
          failed: 1
        },
        failures: [
          {
            source: "Secondary source",
            factualError: "Timed out after the bounded source request"
          }
        ],
        cost: { amount: 0, currency: "CHF", billingUnit: "run" },
        evidence: [
          {
            sourceUrl: "https://example.test/careers",
            observedAt: "2026-08-25T09:00:00.000Z"
          }
        ]
      },
      items: [
        {
          opportunityId: opportunity.opportunity.id,
          resultKind: "new",
          evidence: { sourceIdentifier: "research-engineer-1" }
        },
        {
          opportunityId: null,
          resultKind: "failed",
          evidence: { source: "Secondary source" }
        }
      ],
      idempotencyKey: "search-run-operations-1"
    };
    const recorded = await injectJson<{
      replayed: boolean;
      run: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/search-runs",
      expectedStatus: 201,
      payload: runPayload
    });
    assert.equal(recorded.replayed, false);
    assert.equal(recorded.run.criteriaVersionId, criteria.id);
    assert.deepEqual(recorded.run.counts, runPayload.data.counts);
    assert.equal(recorded.items.length, 2);

    const replay = await injectJson<{ replayed: boolean }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/search-runs",
      payload: runPayload
    });
    assert.equal(replay.replayed, true);

    const detail = await injectJson<{
      run: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
      page: { total: number };
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/search-runs/${recorded.run.id}?limit=1&offset=0`
    });
    assert.equal(detail.page.total, 2);
    assert.equal(detail.items.length, 1);

    const updatedRoleTarget = await injectJson<{
      record: Record<string, unknown>;
    }>(app, cookie, {
      method: "PATCH",
      url: `/api/v1/work/supporting/roleTarget/${roleTarget.record.id}`,
      payload: {
        expectedRevision: roleTarget.record.revision,
        data: {
          priority: 95,
          knownGaps: [],
          evidenceActions: ["Read the target team's current publications"]
        }
      }
    });
    assert.equal(updatedRoleTarget.record.revision, 2);
    assert.equal(
      (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM work_supporting_revisions WHERE record_id = ?"
          )
          .get(String(roleTarget.record.id)) as { count: number }
      ).count,
      2
    );
  });
});

test("application workspaces connect reviewed reusable answers and interview preparation without implying submission", async () => {
  await withWorkTestServer("application-support", async ({ app, cookie }) => {
    const campaign = await createCampaign(app, cookie, {
      id: "campaign_application_support"
    });
    const opportunity = await createOpportunity(app, cookie, {
      id: "opportunity_application_support",
      idempotencyKey: "opportunity-application-support"
    });
    const created = await injectJson<{ application: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: "/api/v1/work/applications",
        expectedStatus: 201,
        payload: {
          id: "application_support",
          opportunityId: opportunity.opportunity.id,
          primaryCampaignId: campaign.id,
          status: "preparing",
          nextAction: "Review application answers",
          provenance: userProvenance
        }
      }
    );
    const response = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: "/api/v1/work/supporting/reusableResponse",
        expectedStatus: 201,
        payload: {
          data: {
            exactQuestion: "Why are you interested in this kind of work?",
            normalizedCategory: "motivation_general",
            answer:
              "I want to build rigorous systems with visible real-world value.",
            limit: { kind: "words", maximum: 100 },
            language: "en",
            evidenceLinks: [],
            sensitivity: "normal",
            reviewState: "approved",
            usageHistory: [],
            scopeProjectIds: [],
            scopeTagIds: [],
            provenance: userProvenance
          }
        }
      }
    );
    const question = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: `/api/v1/work/supporting/applicationQuestion?parentId=${created.application.id}`,
        expectedStatus: 201,
        payload: {
          data: {
            exactQuestion: "Why do you want to join Example Research?",
            normalizedCategory: "motivation_company",
            limit: { kind: "words", maximum: 100 },
            language: "en",
            sensitivity: "normal",
            reusableResponseId: response.record.id,
            approvedAnswer: "",
            evidenceLinks: [],
            reviewState: "draft",
            useHistory: []
          }
        }
      }
    );
    assert.equal(question.record.reusableResponseId, response.record.id);
    assert.equal(question.record.reviewState, "draft");

    const interview = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: `/api/v1/work/supporting/interview?parentId=${created.application.id}`,
        expectedStatus: 201,
        payload: {
          data: {
            stage: "technical_interview",
            scheduledStartAt: "2026-09-10T10:00:00.000+02:00",
            scheduledEndAt: "2026-09-10T11:00:00.000+02:00",
            timezone: "Europe/Zurich",
            format: "video",
            privateLocationOrLink: "Stored privately for the operator",
            participantLinks: [],
            focusAreas: ["Research design", "Systems engineering"],
            questionBank: [
              {
                question:
                  "How would you validate a new model under distribution shift?",
                status: "planned",
                notes:
                  "Connect the answer to evidence, uncertainty, and monitoring."
              }
            ],
            notes: "Do not invent unsupported claims.",
            nextAction: "Prepare evidence-backed examples"
          }
        }
      }
    );
    assert.equal(interview.record.applicationId, created.application.id);
    assert.equal(interview.record.stage, "technical_interview");

    const globalInterviews = await injectJson<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>(app, cookie, {
      method: "GET",
      url: "/api/v1/work/supporting/interview?limit=50"
    });
    assert.equal(globalInterviews.total, 1);
    assert.ok(
      globalInterviews.items.some((entry) => entry.id === interview.record.id)
    );

    const detail = await injectJson<{
      application: Record<string, unknown>;
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/applications/${created.application.id}`
    });
    assert.equal(detail.application.status, "preparing");
    assert.equal(detail.application.submittedAt, null);
    assert.equal(detail.application.confirmationReceipt, "");
    assert.ok(
      (detail.application.questions as Array<Record<string, unknown>>).some(
        (entry) => entry.id === question.record.id
      )
    );
    assert.ok(
      (detail.application.interviews as Array<Record<string, unknown>>).some(
        (entry) => entry.id === interview.record.id
      )
    );

    const relationships = await injectJson<{
      related: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/relationships/job_application/${created.application.id}`
    });
    assert.equal(
      relationships.related.find(
        (entry) => entry.entityId === interview.record.id
      )?.title,
      "Technical interview",
      "Connections must show a human interview name instead of its technical identifier."
    );
  });
});
