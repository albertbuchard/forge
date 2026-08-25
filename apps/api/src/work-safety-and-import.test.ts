import assert from "node:assert/strict";
import test from "node:test";

import { getDatabase } from "./db.js";
import {
  createCampaign,
  createEngagement,
  createOpportunity,
  initialCriteria,
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
  userIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
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
        userIds: input.userIds ?? ["user_operator"],
        projectIds: input.projectIds ?? [],
        tagIds: input.tagIds ?? []
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

test("Project and tag restrictions are enforced by durable relationship links", async () => {
  await withWorkTestServer(
    "relationship-authority",
    async ({ app, cookie }) => {
      const project = getDatabase()
        .prepare(
          `SELECT project.id
         FROM projects project
         LEFT JOIN entity_owners owner
           ON owner.entity_type = 'project' AND owner.entity_id = project.id
         WHERE owner.user_id = 'user_operator' OR owner.user_id IS NULL
         ORDER BY CASE WHEN owner.user_id = 'user_operator' THEN 0 ELSE 1 END,
                  project.id ASC
         LIMIT 1`
        )
        .get() as { id: string } | undefined;
      const tag = getDatabase()
        .prepare(
          `SELECT tag.id
         FROM tags tag
         LEFT JOIN entity_owners owner
           ON owner.entity_type = 'tag' AND owner.entity_id = tag.id
         WHERE owner.user_id = 'user_operator' OR owner.user_id IS NULL
         ORDER BY CASE WHEN owner.user_id = 'user_operator' THEN 0 ELSE 1 END,
                  tag.id ASC
         LIMIT 1`
        )
        .get() as { id: string } | undefined;
      assert.ok(
        project,
        "The isolated Forge fixture must contain one usable Project."
      );
      assert.ok(tag, "The isolated Forge fixture must contain one usable tag.");

      const nonexistentScope = await app.inject({
        method: "POST",
        url: "/api/v1/work/organizations",
        headers: { cookie },
        payload: {
          id: "organization_missing_scope_target",
          name: "Organization with a missing Project",
          scope: {
            projectIds: ["project_that_does_not_exist"],
            tagIds: []
          },
          provenance: userProvenance
        }
      });
      assert.equal(nonexistentScope.statusCode, 404, nonexistentScope.body);
      assert.match(nonexistentScope.body, /Project.*does not exist/i);
      assert.equal(
        (
          getDatabase()
            .prepare(
              "SELECT COUNT(*) AS count FROM work_organizations WHERE id = ?"
            )
            .get("organization_missing_scope_target") as { count: number }
        ).count,
        0
      );

      const scopedAgent = await issueWorkAgent({
        app,
        cookie,
        label: "Relationship-scoped Work editor",
        scopes: ["work.read", "work.write"],
        projectIds: [project.id],
        tagIds: [tag.id]
      });
      const created = await injectJson<{
        organization: Record<string, unknown>;
      }>(app, cookie, {
        method: "POST",
        url: "/api/v1/work/organizations",
        expectedStatus: 201,
        authorization: scopedAgent.authorization,
        payload: {
          id: "organization_relationship_scoped",
          name: "Relationship-scoped organization",
          scope: { projectIds: [project.id], tagIds: [tag.id] },
          provenance: { sourceKind: "agent", actorId: scopedAgent.agentId }
        }
      });
      assert.equal(created.organization.revision, 1);
      const organizationId = String(created.organization.id);

      const storedScopeLinks = getDatabase()
        .prepare(
          `SELECT target_entity_type AS targetType,
                target_entity_id AS targetId,
                relationship,
                anchor_key AS anchorKey
         FROM entity_links
         WHERE source_entity_type = 'work_organization'
           AND source_entity_id = ?
           AND anchor_key = 'work_scope'
         ORDER BY target_entity_type, target_entity_id`
        )
        .all(organizationId) as Array<{
        targetType: string;
        targetId: string;
        relationship: string;
        anchorKey: string;
      }>;
      assert.deepEqual(
        storedScopeLinks.map((link) => ({ ...link })),
        [
          {
            targetType: "project",
            targetId: project.id,
            relationship: "project_context",
            anchorKey: "work_scope"
          },
          {
            targetType: "tag",
            targetId: tag.id,
            relationship: "tag_context",
            anchorKey: "work_scope"
          }
        ]
      );

      const visible = await injectJson<{
        items: Array<Record<string, unknown>>;
      }>(app, cookie, {
        method: "GET",
        url: "/api/v1/work/organizations",
        authorization: scopedAgent.authorization
      });
      assert.ok(visible.items.some((item) => item.id === organizationId));

      const outsideOpportunity = await createOpportunity(app, cookie, {
        id: "opportunity_outside_relationship_scope",
        canonicalUrl: "https://example.test/jobs/outside-relationship-scope",
        sourceIdentifier: "outside-relationship-scope",
        title: "Original inaccessible opportunity title",
        idempotencyKey: "outside-relationship-scope-operator"
      });
      const relabelAttempt = await app.inject({
        method: "POST",
        url: "/api/v1/work/opportunities/upsert",
        headers: { authorization: scopedAgent.authorization },
        payload: {
          canonicalUrl: "https://example.test/jobs/outside-relationship-scope",
          sourceName: "Example careers",
          sourceIdentifier: "outside-relationship-scope",
          title: "Unauthorized relabeled opportunity",
          employerName: "Example Research",
          scope: { projectIds: [project.id], tagIds: [tag.id] },
          provenance: { sourceKind: "agent", actorId: scopedAgent.agentId },
          idempotencyKey: "outside-relationship-scope-agent"
        }
      });
      assert.equal(relabelAttempt.statusCode, 404, relabelAttempt.body);
      assert.equal(
        (
          getDatabase()
            .prepare("SELECT title FROM job_opportunities WHERE id = ?")
            .get(String(outsideOpportunity.opportunity.id)) as { title: string }
        ).title,
        "Original inaccessible opportunity title"
      );

      const relationships = await injectJson<{
        links: Array<Record<string, unknown>>;
      }>(app, cookie, {
        method: "PUT",
        url: `/api/v1/work/relationships/work_organization/${organizationId}`,
        authorization: scopedAgent.authorization,
        payload: { expectedRevision: 1, links: [] }
      });
      assert.equal(
        relationships.links.filter((link) => link.anchorKey === "work_scope")
          .length,
        2,
        "The generic relationship editor must preserve authorization links."
      );

      getDatabase()
        .prepare(
          `DELETE FROM entity_links
         WHERE source_entity_type = 'work_organization'
           AND source_entity_id = ?
           AND anchor_key = 'work_scope'`
        )
        .run(organizationId);

      const inaccessible = await app.inject({
        method: "GET",
        url: `/api/v1/work/organizations/${organizationId}`,
        headers: { authorization: scopedAgent.authorization }
      });
      assert.equal(inaccessible.statusCode, 404, inaccessible.body);
      const hidden = await injectJson<{
        items: Array<Record<string, unknown>>;
      }>(app, cookie, {
        method: "GET",
        url: "/api/v1/work/organizations",
        authorization: scopedAgent.authorization
      });
      assert.equal(
        hidden.items.some((item) => item.id === organizationId),
        false,
        "Legacy JSON scope columns must not grant authority without a direct link."
      );
    }
  );
});

test("Idempotent application-event replays re-authorize and redact for the current caller", async () => {
  await withWorkTestServer("event-replay-privacy", async ({ app, cookie }) => {
    const campaign = await createCampaign(app, cookie, {
      id: "campaign_event_replay_privacy"
    });
    const opportunity = await createOpportunity(app, cookie, {
      id: "opportunity_event_replay_privacy",
      canonicalUrl: "https://example.test/jobs/event-replay-privacy",
      sourceIdentifier: "event-replay-privacy",
      idempotencyKey: "opportunity-event-replay-privacy"
    });
    const created = await injectJson<{
      application: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: "/api/v1/work/applications",
      expectedStatus: 201,
      payload: {
        id: "application_event_replay_privacy",
        opportunityId: opportunity.opportunity.id,
        primaryCampaignId: campaign.id,
        criteriaVersionId: campaign.currentCriteriaVersionId,
        applicationRoute: {
          name: "Private employer account",
          url: "https://example.test/apply/private",
          channel: "web_portal"
        },
        accountReference: "private-account-route",
        privateContacts: [
          {
            name: "Private Recruiter",
            email: "private-recruiter@example.test",
            confirmed: true
          }
        ],
        representations: {
          workAuthorization: "Confirmed privately for this application"
        },
        status: "preparing",
        nextAction: "Record the employer acknowledgement",
        provenance: userProvenance
      }
    });
    const eventPayload = {
      expectedRevision: created.application.revision,
      eventType: "acknowledgement",
      occurredAt: "2026-08-25T10:00:00.000+02:00",
      factualDescription:
        "The employer account displayed a direct acknowledgement.",
      nextAction: "Wait for the screening decision",
      provenance: userProvenance,
      idempotencyKey: "application-event-replay-privacy"
    };
    const captured = await injectJson<{
      replayed: boolean;
      application: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/applications/${created.application.id}/events`,
      expectedStatus: 201,
      payload: eventPayload
    });
    assert.equal(captured.replayed, false);
    assert.equal(
      captured.application.accountReference,
      "private-account-route"
    );

    const boundedWriter = await issueWorkAgent({
      app,
      cookie,
      label: "Application activity writer without transmission authority",
      scopes: ["work.write"]
    });
    const replay = await injectJson<{
      replayed: boolean;
      application: Record<string, unknown>;
      event: Record<string, unknown>;
    }>(app, cookie, {
      method: "POST",
      url: `/api/v1/work/applications/${created.application.id}/events`,
      authorization: boundedWriter.authorization,
      payload: eventPayload
    });
    assert.equal(replay.replayed, true);
    assert.equal("accountReference" in replay.application, false);
    assert.equal("applicationRoute" in replay.application, false);
    assert.equal("privateContacts" in replay.application, false);
    assert.equal("representations" in replay.application, false);
    assert.equal(replay.application.privateApplicationDetailsRedacted, true);
    assert.equal("factualDescription" in replay.event, false);

    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/work/applications/${created.application.id}/events`,
      headers: { authorization: boundedWriter.authorization },
      payload: {
        ...eventPayload,
        factualDescription:
          "A different event must not reuse the same idempotency key."
      }
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.match(conflict.body, /idempotency key.*different/i);
  });
});

test("A legacy application with unknown criteria provenance cannot be transmitted", async () => {
  await withWorkTestServer(
    "legacy-criteria-transmission",
    async ({ app, cookie }) => {
      const { application } = await createReadyApplication({ app, cookie });
      const sender = await issueWorkAgent({
        app,
        cookie,
        label: "Legacy application sender",
        scopes: ["work.read", "work.write", "work.transmit"]
      });
      getDatabase()
        .prepare(
          `UPDATE job_applications
           SET criteria_version_id = NULL,
               provenance_json = json_set(
                 provenance_json,
                 '$.compatibilityMigrations.workOpportunity139',
                 json_object(
                   'criteriaVersionState', 'unknown_legacy_schema',
                   'reason', 'test fixture for an earlier schema'
                 )
               ),
               revision = revision + 1
           WHERE id = ?`
        )
        .run(String(application.id));

      const preview = await app.inject({
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
          fields: { candidateName: "Test Candidate" },
          answers: [],
          artifactVersions: [],
          representations: {},
          unresolvedGates: [],
          idempotencyKey: "legacy-criteria-preview-rejected"
        }
      });
      assert.equal(preview.statusCode, 409, preview.body);
      assert.match(preview.body, /exact campaign criteria version/i);
    }
  );
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
        fields: { api_key: "never-store-this" },
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
      .get(String(preview.preview.id)) as {
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

    const crossPrincipalReplay = await app.inject({
      method: "POST",
      url: "/api/v1/work/transmissions/verified-submissions",
      headers: { authorization: otherSender.authorization },
      payload: {
        authorizationIdentity: authorization.authorization_identity,
        previewDigest: authorization.preview_digest,
        confirmationReceipt: "ATS receipt TEST-100",
        trackingIdentifier: "TEST-100",
        factualDescription: "The ATS displayed a submission receipt.",
        idempotencyKey: "verified-submission-test-100"
      }
    });
    assert.equal(
      crossPrincipalReplay.statusCode,
      403,
      crossPrincipalReplay.body
    );

    const project = getDatabase()
      .prepare("SELECT id FROM projects ORDER BY id ASC LIMIT 1")
      .get() as { id: string } | undefined;
    assert.ok(project);
    const restrictedSender = await issueWorkAgent({
      app,
      cookie,
      label: "Project-restricted application sender",
      scopes: ["work.transmit"],
      projectIds: [project.id]
    });
    const crossScopeReplay = await app.inject({
      method: "POST",
      url: "/api/v1/work/transmissions/verified-submissions",
      headers: { authorization: restrictedSender.authorization },
      payload: {
        authorizationIdentity: authorization.authorization_identity,
        previewDigest: authorization.preview_digest,
        confirmationReceipt: "ATS receipt TEST-100",
        trackingIdentifier: "TEST-100",
        factualDescription: "The ATS displayed a submission receipt.",
        idempotencyKey: "verified-submission-test-100"
      }
    });
    assert.equal(crossScopeReplay.statusCode, 404, crossScopeReplay.body);
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
      .get(String(preview.preview.id)) as {
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
          initialCriteria: initialCriteria(),
          provenance: { sourceKind: "import", sourceLabel: "Private export" }
        }
      ],
      criteriaVersions: [],
      roleTargets: [],
      organizationTargets: [],
      opportunities: [
        {
          id: "import_opportunity",
          organizationId: "import_org",
          canonicalUrl: "https://example.com/jobs/imported-research-role",
          sourceName: "Reviewed private export",
          sourceIdentifier: "imported-research-role",
          title: "Imported research role",
          employerName: "Imported Research Organization",
          availabilityStatus: "live",
          disposition: "applied",
          provenance: {
            sourceKind: "import",
            sourceLabel: "Private export",
            evidence: [{ kind: "reviewed_private_source", direct: true }]
          },
          idempotencyKey: "import-private-opportunity"
        }
      ],
      applications: [
        {
          id: "import_application",
          opportunityId: "import_opportunity",
          primaryCampaignId: "import_campaign",
          criteriaVersionId: null,
          applicationRoute: {
            name: "Direct employer form",
            url: "https://example.com/jobs/imported-research-role",
            channel: "web_portal"
          },
          accountReference: "imported-research-role",
          status: "submitted",
          nextAction: "Wait for a verified response",
          provenance: {
            sourceKind: "import",
            sourceLabel: "Private export",
            evidence: [{ kind: "submission_confirmation", direct: true }]
          }
        }
      ],
      applicationEvents: [
        {
          applicationRef: "import_application",
          eventType: "submitted",
          priorStatus: null,
          newStatus: "submitted",
          occurredAt: "2026-08-24T09:00:00.000+02:00",
          actor: {
            kind: "system",
            id: "private_import",
            label: "Reviewed private import",
            source: "system"
          },
          factualDescription:
            "The reviewed private source records a direct submission confirmation.",
          provenance: {
            sourceKind: "import",
            sourceLabel: "Private export",
            evidence: [{ kind: "submission_confirmation", direct: true }]
          }
        }
      ],
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
    assert.equal(applied.references.import_opportunity, "import_opportunity");
    assert.equal(applied.references.import_application, "import_application");
    const importedApplication = getDatabase()
      .prepare(
        "SELECT status, revision, submitted_at FROM job_applications WHERE id = ?"
      )
      .get("import_application") as {
      status: string;
      revision: number;
      submitted_at: string | null;
    };
    assert.equal(importedApplication.status, "submitted");
    assert.equal(importedApplication.revision, 3);
    assert.equal(
      importedApplication.submitted_at,
      "2026-08-24T09:00:00.000+02:00"
    );
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
    const prohibitedOrganization = prohibited.organizations[0] as unknown as {
      provenance: Record<string, unknown>;
    };
    prohibitedOrganization.provenance = {
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

test("Private Work imports reject protected applicant demographics and allow work authorization", async () => {
  await withWorkTestServer(
    "import-protected-demographics",
    async ({ app, cookie }) => {
      const campaign = await createCampaign(app, cookie, {
        id: "campaign_import_representation_safety"
      });
      const opportunity = await createOpportunity(app, cookie, {
        id: "opportunity_import_representation_safety",
        canonicalUrl: "https://example.test/jobs/import-representation-safety",
        sourceIdentifier: "import-representation-safety",
        idempotencyKey: "opportunity-import-representation-safety"
      });
      assert.equal(typeof campaign.currentCriteriaVersionId, "string");

      const buildManifest = (representations: Record<string, unknown>) => ({
        schemaVersion: 1,
        source: {
          label: "Reviewed private application export",
          digest: "d".repeat(64),
          observedAt: "2026-08-25T11:00:00.000+02:00"
        },
        ownerUserId: "user_operator",
        applications: [
          {
            id: "import_representation_safety_application",
            opportunityId: opportunity.opportunity.id,
            primaryCampaignId: campaign.id,
            criteriaVersionId: campaign.currentCriteriaVersionId,
            applicationRoute: {
              name: "Reviewed employer route",
              url: "https://example.test/apply/import-representation-safety",
              channel: "web_portal"
            },
            accountReference: "import-representation-safety-route",
            status: "planned",
            representations,
            provenance: {
              sourceKind: "import",
              sourceLabel: "Reviewed private application export"
            }
          }
        ]
      });

      const protectedRepresentations: Array<
        [label: string, value: Record<string, unknown>]
      > = [
        ["gender", { gender: "private" }],
        ["prefixed gender", { candidateGender: "private" }],
        ["sex", { profile: { sex: "private" } }],
        ["age", { age: 34 }],
        ["date of birth", { dateOfBirth: "1992-01-01" }],
        ["veteran status", { veteranStatus: "private" }],
        ["military status", { military_status: "private" }],
        ["pregnancy", { declarations: { pregnancy: "private" } }],
        ["family status", { familyStatus: "private" }],
        ["race", { race: "private" }],
        ["ethnicity", { ethnicity: "private" }],
        ["religion", { religion: "private" }],
        ["disability", { disabilityStatus: "private" }],
        ["sexual orientation", { sexualOrientation: "private" }],
        ["nationality", { nationality: "private" }],
        ["citizenship", { citizenship: "private" }],
        [
          "descriptor value",
          { answer: { field: "Veteran status", value: "private" } }
        ]
      ];

      for (const [label, representations] of protectedRepresentations) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/work/imports/preview",
          headers: { cookie },
          payload: buildManifest(representations)
        });
        assert.equal(response.statusCode, 400, `${label}: ${response.body}`);
        assert.match(
          response.body,
          /protected applicant demographic/i,
          `${label} must be rejected as protected applicant data.`
        );
      }

      const directApply = await app.inject({
        method: "POST",
        url: "/api/v1/work/imports/apply",
        headers: { cookie },
        payload: {
          manifest: buildManifest({
            declarations: { veteranStatus: "private" }
          }),
          expectedPreviewDigest: "0".repeat(64),
          idempotencyKey: "protected-representation-direct-apply"
        }
      });
      assert.equal(directApply.statusCode, 400, directApply.body);
      assert.match(directApply.body, /protected applicant demographic/i);

      const allowed = await injectJson<{
        readyToApply: boolean;
        subjectiveMetricObservations: number;
      }>(app, cookie, {
        method: "POST",
        url: "/api/v1/work/imports/preview",
        payload: buildManifest({
          workAuthorization: {
            status: "confirmed",
            sponsorshipRequired: false
          }
        })
      });
      assert.equal(allowed.readyToApply, true);
      assert.equal(allowed.subjectiveMetricObservations, 0);
    }
  );
});
