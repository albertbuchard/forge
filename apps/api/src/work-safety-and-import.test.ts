import assert from "node:assert/strict";
import test from "node:test";

import { getDatabase } from "./db.js";
import {
  createCampaign,
  createEngagement,
  createOpportunity,
  injectJson,
  userProvenance,
  withWorkTestServer,
  type WorkTestServer
} from "./work-test-support.js";

async function issueWorkAgent(input: {
  app: WorkTestServer;
  cookie: string;
  label: string;
  scopes: string[];
}) {
  const result = await injectJson<{
    token: {
      token: string;
      tokenSummary: { id: string; agentId: string };
    };
  }>(input.app, input.cookie, {
    method: "POST",
    url: "/api/v1/settings/tokens",
    expectedStatus: 201,
    payload: {
      label: `${input.label} token`,
      agentLabel: input.label,
      agentType: "assistant",
      trustLevel: "trusted",
      autonomyMode: "approval_required",
      approvalMode: "approval_by_default",
      scopes: input.scopes,
      scopePolicy: {
        userIds: ["user_operator"],
        projectIds: [],
        tagIds: []
      }
    }
  });
  return {
    agentId: result.token.tokenSummary.agentId,
    tokenId: result.token.tokenSummary.id,
    authorization: `Bearer ${result.token.token}`
  };
}

async function createReadyApplication(input: {
  app: WorkTestServer;
  cookie: string;
}) {
  const campaign = await createCampaign(input.app, input.cookie, {
    id: "campaign_application_safety"
  });
  const opportunity = await createOpportunity(input.app, input.cookie, {
    id: "opportunity_application_safety",
    idempotencyKey: "opportunity-application-safety"
  });
  const application = await injectJson<{
    application: Record<string, unknown>;
  }>(input.app, input.cookie, {
    method: "POST",
    url: "/api/v1/work/applications",
    expectedStatus: 201,
    payload: {
      id: "application_safety",
      opportunityId: opportunity.opportunity.id,
      primaryCampaignId: campaign.id,
      status: "ready_to_submit",
      nextAction: "Review the exact transmission preview",
      provenance: userProvenance
    }
  });
  return {
    campaign,
    opportunity: opportunity.opportunity,
    application: application.application
  };
}

async function transitionApplication(input: {
  app: WorkTestServer;
  cookie: string;
  application: Record<string, unknown>;
  status: string;
}) {
  const result = await injectJson<{ application: Record<string, unknown> }>(
    input.app,
    input.cookie,
    {
      method: "POST",
      url: `/api/v1/work/applications/${input.application.id}/transitions`,
      payload: {
        expectedRevision: input.application.revision,
        newStatus: input.status,
        factualDescription: `Application moved to ${input.status}.`,
        provenance: userProvenance
      }
    }
  );
  return result.application;
}

test("Work agent scopes redact compensation and prevent fabricated user reports", async () => {
  await withWorkTestServer("agent-boundaries", async ({ app, cookie }) => {
    const engagement = await createEngagement(app, cookie, {
      id: "engagement_private_compensation"
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

    const agent = await issueWorkAgent({
      app,
      cookie,
      label: "Bounded Work reader",
      scopes: ["work.read", "work.write"]
    });
    const list = await injectJson<{
      items: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "GET",
      url: "/api/v1/work/engagements",
      authorization: agent.authorization
    });
    assert.equal(list.items[0]?.id, engagement.id);
    assert.equal("compensation" in (list.items[0] ?? {}), false);

    const fabricated = await app.inject({
      method: "POST",
      url: "/api/v1/work/check-ins",
      headers: { authorization: agent.authorization },
      payload: {
        engagementId: engagement.id,
        timezone: "Europe/Zurich",
        sourceKind: "user_entered",
        confirmationState: "confirmed",
        observations: [
          {
            metricDefinitionId: satisfaction.id,
            numericValue: 5,
            missingState: "observed"
          }
        ],
        provenance: { sourceKind: "agent", actorId: agent.agentId },
        idempotencyKey: "agent-cannot-fabricate-user-report"
      }
    });
    assert.equal(fabricated.statusCode, 409, fabricated.body);
    assert.match(fabricated.body, /cannot label.*user-entered/i);

    const suggested = await injectJson<{
      observations: Array<Record<string, unknown>>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/check-ins",
      expectedStatus: 201,
      authorization: agent.authorization,
      payload: {
        engagementId: engagement.id,
        timezone: "Europe/Zurich",
        sourceKind: "agent_suggested",
        confirmationState: "suggested",
        observations: [
          {
            metricDefinitionId: satisfaction.id,
            numericValue: 4,
            missingState: "observed",
            note: "Suggestion awaiting user review"
          }
        ],
        provenance: { sourceKind: "agent", actorId: agent.agentId },
        idempotencyKey: "agent-preserves-suggestion-state"
      }
    });
    assert.equal(suggested.observations[0]?.confirmationState, "suggested");

    const trends = await injectJson<{ series: unknown[] }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/metrics/trends?engagementIds=${engagement.id}&windowDays=90`,
      authorization: agent.authorization
    });
    assert.deepEqual(trends.series, []);
  });
});

test("Application submission requires exact approval, sender binding, and direct completion evidence", async () => {
  await withWorkTestServer("verified-transmission", async ({ app, cookie }) => {
    const { application } = await createReadyApplication({ app, cookie });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/work/applications",
      headers: { cookie },
      payload: {
        opportunityId: "opportunity_application_safety",
        primaryCampaignId: "campaign_application_safety",
        status: "planned",
        provenance: userProvenance
      }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.match(duplicate.body, /duplicate|already has/i);

    const directSubmit = await app.inject({
      method: "POST",
      url: `/api/v1/work/applications/${application.id}/transitions`,
      headers: { cookie },
      payload: {
        expectedRevision: application.revision,
        newStatus: "submitted",
        factualDescription: "A package was only prepared.",
        provenance: userProvenance
      }
    });
    assert.equal(directSubmit.statusCode, 409, directSubmit.body);
    assert.match(directSubmit.body, /direct evidence|verified/i);

    const sender = await issueWorkAgent({
      app,
      cookie,
      label: "Application sender",
      scopes: [
        "work.read",
        "work.write",
        "work.transmit",
        "work.compensation.read"
      ]
    });
    const otherSender = await issueWorkAgent({
      app,
      cookie,
      label: "Different application sender",
      scopes: ["work.read", "work.write", "work.transmit"]
    });

    const secretPreview = await app.inject({
      method: "POST",
      url: "/api/v1/work/transmissions/previews",
      headers: { authorization: sender.authorization },
      payload: {
        applicationId: application.id,
        destination: {
          name: "Example ATS",
          url: "https://example.test/apply",
          channel: "web_portal"
        },
        fields: { password: "never-store-this" },
        answers: [],
        artifactVersions: [],
        representations: {},
        unresolvedGates: [],
        idempotencyKey: "secret-preview-rejected"
      }
    });
    assert.equal(secretPreview.statusCode, 400, secretPreview.body);
    assert.match(secretPreview.body, /secret|credential|password/i);

    const preview = await injectJson<{
      preview: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/transmissions/previews",
      expectedStatus: 201,
      authorization: sender.authorization,
      payload: {
        applicationId: application.id,
        destination: {
          name: "Example ATS",
          url: "https://example.test/apply",
          channel: "web_portal"
        },
        fields: {
          candidateName: "Test Candidate",
          opportunityId: "opportunity_application_safety"
        },
        answers: [],
        artifactVersions: [],
        representations: {
          workAuthorization: "Confirmed for this application"
        },
        unresolvedGates: [],
        idempotencyKey: "exact-preview-1"
      }
    });
    assert.equal(preview.preview.status, "draft");
    assert.match(String(preview.preview.previewDigest), /^[a-f0-9]{64}$/u);

    const approvalRequest = await injectJson<{
      approvalRequest: { id: string; status: string };
      preview: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/transmissions/previews/${preview.preview.id}/request-approval`,
      expectedStatus: 202,
      authorization: sender.authorization,
      payload: { idempotencyKey: "request-exact-preview-approval-1" }
    });
    assert.equal(approvalRequest.approvalRequest.status, "pending");
    assert.equal(approvalRequest.preview.status, "approval_pending");

    const approved = await injectJson<{
      approvalRequest: { status: string };
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/approval-requests/${approvalRequest.approvalRequest.id}/approve`,
      payload: { note: "Destination and exact payload reviewed." }
    });
    assert.equal(approved.approvalRequest.status, "executed");

    const authorization = getDatabase()
      .prepare(
        `SELECT authorization_identity, preview_digest, status
         FROM application_transmission_previews WHERE id = ?`
      )
      .get(preview.preview.id) as {
      authorization_identity: string;
      preview_digest: string;
      status: string;
    };
    assert.equal(authorization.status, "authorized");

    const wrongPrincipal = await app.inject({
      method: "POST",
      url: "/api/v1/work/transmissions/verified-submissions",
      headers: { authorization: otherSender.authorization },
      payload: {
        authorizationIdentity: authorization.authorization_identity,
        previewDigest: authorization.preview_digest,
        confirmationReceipt: "ATS receipt TEST-100",
        trackingIdentifier: "TEST-100",
        factualDescription: "The ATS displayed a submission receipt.",
        idempotencyKey: "wrong-principal-cannot-complete"
      }
    });
    assert.equal(wrongPrincipal.statusCode, 403, wrongPrincipal.body);
    assert.match(wrongPrincipal.body, /exact authorized|principal/i);

    const submitted = await injectJson<{
      replayed: boolean;
      application: Record<string, unknown>;
      preview: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/transmissions/verified-submissions",
      authorization: sender.authorization,
      payload: {
        authorizationIdentity: authorization.authorization_identity,
        previewDigest: authorization.preview_digest,
        confirmationReceipt: "ATS receipt TEST-100",
        trackingIdentifier: "TEST-100",
        factualDescription: "The ATS displayed a submission receipt.",
        idempotencyKey: "verified-submission-test-100"
      }
    });
    assert.equal(submitted.replayed, false);
    assert.equal(submitted.application.status, "submitted");
    assert.equal(submitted.application.trackingIdentifier, "TEST-100");
    assert.equal(submitted.preview.status, "consumed");

    const replay = await injectJson<{ replayed: boolean }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/transmissions/verified-submissions",
      authorization: sender.authorization,
      payload: {
        authorizationIdentity: authorization.authorization_identity,
        previewDigest: authorization.preview_digest,
        confirmationReceipt: "ATS receipt TEST-100",
        trackingIdentifier: "TEST-100",
        factualDescription: "The ATS displayed a submission receipt.",
        idempotencyKey: "verified-submission-test-100"
      }
    });
    assert.equal(replay.replayed, true);
  });
});

test("Accepting a recorded offer creates one planned Work Engagement and keeps bidirectional evidence", async () => {
  await withWorkTestServer("accepted-offer", async ({ app, cookie }) => {
    const { application } = await createReadyApplication({ app, cookie });
    const sender = await issueWorkAgent({
      app,
      cookie,
      label: "Offer path sender",
      scopes: [
        "work.read",
        "work.write",
        "work.transmit",
        "work.compensation.read"
      ]
    });
    const preview = await injectJson<{ preview: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: "/api/v1/work/transmissions/previews",
        expectedStatus: 201,
        authorization: sender.authorization,
        payload: {
          applicationId: application.id,
          destination: {
            name: "Example ATS",
            url: "https://example.test/apply",
            channel: "web_portal"
          },
          fields: { candidateName: "Test Candidate" },
          answers: [],
          artifactVersions: [],
          representations: {},
          unresolvedGates: [],
          idempotencyKey: "offer-path-preview"
        }
      }
    );
    const approval = await injectJson<{
      approvalRequest: { id: string };
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/transmissions/previews/${preview.preview.id}/request-approval`,
      expectedStatus: 202,
      authorization: sender.authorization,
      payload: { idempotencyKey: "offer-path-approval" }
    });
    await injectJson(app, cookie, {
      method: "POST",
      url: `/api/v1/approval-requests/${approval.approvalRequest.id}/approve`,
      payload: { note: "Reviewed." }
    });
    const authorized = getDatabase()
      .prepare(
        "SELECT authorization_identity, preview_digest FROM application_transmission_previews WHERE id = ?"
      )
      .get(preview.preview.id) as {
      authorization_identity: string;
      preview_digest: string;
    };
    const submitted = await injectJson<{
      application: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/transmissions/verified-submissions",
      authorization: sender.authorization,
      payload: {
        authorizationIdentity: authorized.authorization_identity,
        previewDigest: authorized.preview_digest,
        confirmationReceipt: "Receipt OFFER-PATH",
        factualDescription: "Submission receipt observed.",
        idempotencyKey: "offer-path-submission"
      }
    });

    let current = await transitionApplication({
      app,
      cookie,
      application: submitted.application,
      status: "screening"
    });
    current = await transitionApplication({
      app,
      cookie,
      application: current,
      status: "interviewing"
    });
    current = await transitionApplication({
      app,
      cookie,
      application: current,
      status: "offer"
    });

    const createdOffer = await injectJson<{ record: Record<string, unknown> }>(
      app,
      cookie,
      {
        method: "POST",
        url: `/api/v1/work/supporting/offer?parentId=${current.id}`,
        expectedStatus: 201,
        payload: {
          data: {
            status: "received",
            terms: {
              title: "Senior machine-learning research engineer",
              workModel: "hybrid",
              employmentType: "employment",
              startDate: "2026-10-01",
              weeklyHours: { value: 40, unknown: false }
            },
            privateCompensation: {
              base: {
                amount: 145000,
                currency: "CHF",
                basis: "gross",
                period: "year",
                negotiable: true,
                unknown: false
              }
            },
            criteriaVersionId: current.criteriaVersionId,
            provenance: userProvenance
          }
        }
      }
    );
    const accepted = await injectJson<{
      replayed: boolean;
      engagement: Record<string, unknown>;
      offer: Record<string, unknown>;
      application: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/offers/${createdOffer.record.id}/accept`,
      payload: {
        expectedRevision: createdOffer.record.revision,
        idempotencyKey: "accept-recorded-offer"
      }
    });
    assert.equal(accepted.replayed, false);
    assert.equal(accepted.engagement.status, "planned");
    assert.equal(
      accepted.engagement.title,
      "Senior machine-learning research engineer"
    );
    assert.equal(accepted.application.status, "accepted");
    assert.equal(accepted.offer.status, "accepted");
    assert.equal(accepted.offer.plannedEngagementId, accepted.engagement.id);

    const links = await injectJson<{ links: Array<Record<string, unknown>> }>(
      app,
      cookie,
      {
        method: "GET",
        url: `/api/v1/work/relationships/work_engagement/${accepted.engagement.id}`
      }
    );
    assert.ok(
      links.links.some(
        (link) =>
          link.sourceEntityType === "job_application" &&
          link.sourceEntityId === current.id &&
          link.targetEntityType === "work_engagement" &&
          link.targetEntityId === accepted.engagement.id
      )
    );

    const replay = await injectJson<{ replayed: boolean }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/offers/${createdOffer.record.id}/accept`,
      payload: {
        expectedRevision: createdOffer.record.revision,
        idempotencyKey: "accept-recorded-offer"
      }
    });
    assert.equal(replay.replayed, true);
  });
});

test("Private Work import previews, applies, and rolls back without subjective metric invention", async () => {
  await withWorkTestServer("private-import", async ({ app, cookie }) => {
    const manifest = {
      schemaVersion: 1,
      source: {
        label: "Authoritative private Work export",
        digest: "a".repeat(64),
        observedAt: "2026-08-25T09:00:00.000+02:00"
      },
      ownerUserId: "user_operator",
      lookingForOpportunities: true,
      organizations: [
        {
          id: "import_org",
          name: "Imported Research Organization",
          provenance: { sourceKind: "import", sourceLabel: "Private export" }
        }
      ],
      engagements: [
        {
          id: "import_engagement",
          organizationId: "import_org",
          title: "Imported current appointment",
          status: "current",
          engagementType: "appointment",
          provenance: { sourceKind: "import", sourceLabel: "Private export" }
        }
      ],
      campaigns: [
        {
          id: "import_campaign",
          sourceEngagementId: "import_engagement",
          title: "Imported transition search",
          status: "active",
          searchIntent: "full_time_employment",
          provenance: { sourceKind: "import", sourceLabel: "Private export" }
        }
      ],
      criteriaVersions: [],
      roleTargets: [],
      organizationTargets: [],
      opportunities: [],
      applications: [],
      applicationEvents: [],
      links: [],
      artifactReferences: []
    };

    const preview = await injectJson<{
      readyToApply: boolean;
      previewDigest: string;
      subjectiveMetricObservations: number;
      counts: Record<string, number>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/imports/preview",
      payload: manifest
    });
    assert.equal(preview.readyToApply, true);
    assert.equal(preview.subjectiveMetricObservations, 0);
    assert.match(preview.previewDigest, /^[a-f0-9]{64}$/u);

    const applied = await injectJson<{
      replayed: boolean;
      receiptId: string;
      references: Record<string, string>;
      subjectiveMetricObservations: number;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/imports/apply",
      payload: {
        manifest,
        expectedPreviewDigest: preview.previewDigest,
        idempotencyKey: "apply-private-work-import"
      }
    });
    assert.equal(applied.replayed, false);
    assert.equal(applied.subjectiveMetricObservations, 0);
    assert.equal(applied.references.import_org, "import_org");
    assert.equal(applied.references.import_engagement, "import_engagement");
    assert.equal(applied.references.import_campaign, "import_campaign");
    assert.equal(
      (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM work_metric_observations WHERE engagement_id = ?"
          )
          .get("import_engagement") as { count: number }
      ).count,
      0
    );

    const context = await injectJson<{
      settings: Array<Record<string, unknown>>;
      engagements: Array<Record<string, unknown>>;
      campaigns: Array<Record<string, unknown>>;
    }>(app, cookie, { method: "GET", url: "/api/v1/work/context" });
    assert.equal(context.settings[0]?.lookingForOpportunities, true);
    assert.ok(
      context.engagements.some(
        (engagement) => engagement.id === "import_engagement"
      )
    );
    assert.ok(
      context.campaigns.some((campaign) => campaign.id === "import_campaign")
    );

    const rollbackPreview = await injectJson<{
      canRollback: boolean;
      rollbackPreviewDigest: string;
      conflicts: unknown[];
    }>(app, cookie, {
      method: "GET",
      url: `/api/v1/work/imports/${applied.receiptId}/rollback-preview`
    });
    assert.equal(rollbackPreview.canRollback, true);
    assert.deepEqual(rollbackPreview.conflicts, []);

    const rollback = await injectJson<{
      replayed: boolean;
      removed: unknown[];
      softDeleted: unknown[];
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/imports/${applied.receiptId}/rollback`,
      payload: {
        expectedRollbackPreviewDigest: rollbackPreview.rollbackPreviewDigest,
        idempotencyKey: "rollback-private-work-import"
      }
    });
    assert.equal(rollback.replayed, false);
    assert.ok(rollback.softDeleted.length >= 2);

    const after = await injectJson<{
      engagements: Array<Record<string, unknown>>;
      campaigns: Array<Record<string, unknown>>;
    }>(app, cookie, { method: "GET", url: "/api/v1/work/context" });
    assert.ok(
      !after.engagements.some((entry) => entry.id === "import_engagement")
    );
    assert.ok(!after.campaigns.some((entry) => entry.id === "import_campaign"));

    const prohibited = structuredClone(manifest);
    prohibited.source.digest = "b".repeat(64);
    prohibited.organizations[0]!.provenance = {
      sourceKind: "import",
      sourceLabel: "Private export",
      evidence: [{ authorization: `Bearer ${"x".repeat(32)}` }]
    };
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/work/imports/preview",
      headers: { cookie },
      payload: prohibited
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.match(rejected.body, /credential-like|prohibited/i);
  });
});
