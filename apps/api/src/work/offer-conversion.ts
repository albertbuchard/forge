import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import { hasMaterialValue } from "./repository-write-helpers.js";
import {
  appendAuthorizedWorkLinks,
  fingerprint,
  getAuthorizedRoot,
  getOperationReceipt,
  nowIso,
  recordWorkActivity,
  rowToWorkRecord,
  storeOperationReceipt,
  type SqlRow
} from "./repository-helpers.js";
import {
  createWorkEngagement,
  transitionJobApplication
} from "./repository.js";
import {
  noticePeriodSchema,
  workBenefitSchema,
  workCompensationSchema,
  workLocationSchema,
  workScheduleSchema,
  type CreateWorkEngagementInput
} from "./types.js";
import {
  recordOfferRevision,
  recordSupportingRevision
} from "./supporting-revisions.js";

function requireCreatedEngagementId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      500,
      "work_offer_engagement_response_invalid",
      "The accepted offer created an unreadable Work Engagement response."
    );
  }
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.trim()) {
    throw new HttpError(
      500,
      "work_offer_engagement_id_missing",
      "The accepted offer did not produce a stable Work Engagement identifier."
    );
  }
  return id;
}

function plannedEngagementFromOffer(input: {
  access: WorkAccess;
  offerId: string;
  offer: Record<string, unknown>;
  application: Record<string, unknown>;
  opportunity: Record<string, unknown>;
  observedAt: string;
}): CreateWorkEngagementInput {
  const offerTerms =
    input.offer.terms &&
    typeof input.offer.terms === "object" &&
    !Array.isArray(input.offer.terms)
      ? (input.offer.terms as Record<string, unknown>)
      : {};
  const offerCompensation =
    input.offer.privateCompensation &&
    typeof input.offer.privateCompensation === "object" &&
    !Array.isArray(input.offer.privateCompensation)
      ? (input.offer.privateCompensation as Record<string, unknown>)
      : {};
  const offerBenefits = Array.isArray(offerCompensation.benefits)
    ? (offerCompensation.benefits as Record<string, unknown>[])
    : [];
  const { benefits: _offerBenefits, ...offerCompensationWithoutBenefits } =
    offerCompensation;
  const rawEmploymentType = String(
    offerTerms.employmentType ??
      input.opportunity.employmentType ??
      "employment"
  );
  const allowedTypes: CreateWorkEngagementInput["engagementType"][] = [
    "employment",
    "appointment",
    "contract",
    "freelance",
    "fractional",
    "shift",
    "self_employment",
    "advisory",
    "internship",
    "seasonal",
    "other"
  ];
  const engagementType = allowedTypes.includes(
    rawEmploymentType as CreateWorkEngagementInput["engagementType"]
  )
    ? (rawEmploymentType as CreateWorkEngagementInput["engagementType"])
    : "other";
  const noticeInteraction = noticePeriodSchema.parse(
    offerTerms.noticeInteraction &&
      typeof offerTerms.noticeInteraction === "object" &&
      !Array.isArray(offerTerms.noticeInteraction)
      ? offerTerms.noticeInteraction
      : {
          value: null,
          unit: null,
          negotiable: null,
          conditions: "",
          unknown: true
        }
  );
  const weeklyHours =
    offerTerms.weeklyHours &&
    typeof offerTerms.weeklyHours === "object" &&
    !Array.isArray(offerTerms.weeklyHours)
      ? (offerTerms.weeklyHours as Record<string, unknown>)
      : ((input.opportunity.weeklyHours as Record<string, unknown>) ?? {});
  const offeredWeeklyHours = [
    weeklyHours.value,
    weeklyHours.minimum === weeklyHours.maximum ? weeklyHours.minimum : null
  ].find((value) => typeof value === "number") as number | undefined;
  const location =
    offerTerms.location &&
    typeof offerTerms.location === "object" &&
    !Array.isArray(offerTerms.location)
      ? (offerTerms.location as Record<string, unknown>)
      : ((input.opportunity.location as Record<string, unknown>) ?? {});
  const offeredWorkModel = offerTerms.workModel ?? input.opportunity.workModel;
  const offerDuration =
    offerTerms.duration &&
    typeof offerTerms.duration === "object" &&
    !Array.isArray(offerTerms.duration)
      ? (offerTerms.duration as Record<string, unknown>)
      : {};
  return {
    organizationId:
      typeof input.opportunity.organizationId === "string"
        ? input.opportunity.organizationId
        : null,
    title: String(offerTerms.title || input.opportunity.title),
    roleFunction: String(input.opportunity.roleFamily ?? ""),
    description: String(input.opportunity.description ?? ""),
    status: "planned",
    priority: "normal",
    engagementType,
    startDate:
      typeof offerTerms.startDate === "string"
        ? offerTerms.startDate
        : typeof input.opportunity.startDate === "string"
          ? input.opportunity.startDate
          : null,
    expectedEndDate:
      typeof offerDuration.endDate === "string" ? offerDuration.endDate : null,
    actualEndDate: null,
    probationEndDate: null,
    renewalDate: null,
    contractDeadline: null,
    noticePeriod: noticeInteraction,
    earliestDepartureDate: null,
    workload: {
      contractedWeeklyHours: offeredWeeklyHours ?? null,
      actualWeeklyHours: null,
      fullTimeEquivalent: null,
      unknown: offeredWeeklyHours === undefined
    },
    schedule: workScheduleSchema.parse({}),
    location: workLocationSchema.parse(location),
    workModel: (["remote", "hybrid", "on_site", "variable", "unknown"].includes(
      String(offeredWorkModel)
    )
      ? offeredWorkModel
      : "unknown") as CreateWorkEngagementInput["workModel"],
    roleFacts: {
      seniority: String(input.opportunity.seniority ?? ""),
      roleFamily: String(input.opportunity.roleFamily ?? ""),
      teamName: "",
      managerRole: "",
      directReportCount: null,
      decisionAuthority: [],
      ownershipAreas: [],
      domains: [],
      technologies: Array.isArray(input.opportunity.technologies)
        ? input.opportunity.technologies.map(String)
        : [],
      skillsUsed: Array.isArray(input.opportunity.skills)
        ? input.opportunity.skills.map(String)
        : [],
      skillsDeveloping: [],
      clinicalExposure: "",
      customerExposure: "",
      researchFreedom: "",
      publicationRights: "",
      openSourceRights: "",
      deliverables: []
    },
    responsibilities: Array.isArray(input.opportunity.responsibilities)
      ? input.opportunity.responsibilities.map(String)
      : [],
    successCriteria: [],
    compensation: workCompensationSchema.parse(
      input.access.canCompensation
        ? hasMaterialValue(offerCompensationWithoutBenefits)
          ? offerCompensationWithoutBenefits
          : ((input.opportunity.compensation as Record<string, unknown>) ?? {})
        : {}
    ),
    benefits: workBenefitSchema
      .array()
      .parse(
        input.access.canCompensation
          ? hasMaterialValue(offerBenefits)
            ? offerBenefits
            : Array.isArray(input.opportunity.benefits)
              ? input.opportunity.benefits
              : []
          : []
      ),
    purpose: `Accepted offer from application ${String(input.application.id)}`,
    desiredOutcomes: [],
    risks: [],
    constraints: [],
    transitionIntentions: "",
    exitReason: "",
    exitOutcome: "",
    nextAction:
      "Review start date, notice period, schedule, and contract documents.",
    visibility: "private",
    scope: {
      projectIds: Array.isArray(input.application.scopeProjectIds)
        ? input.application.scopeProjectIds.map(String)
        : [],
      tagIds: Array.isArray(input.application.scopeTagIds)
        ? input.application.scopeTagIds.map(String)
        : []
    },
    provenance: {
      sourceKind: "system",
      sourceLabel: "Accepted Job Offer",
      sourceUrl: "",
      sourceArtifactId: "",
      observedAt: input.observedAt,
      actorId: input.access.actor.id,
      confidence: 1,
      evidence: [{ offerId: input.offerId }]
    }
  };
}

function linkAcceptedEngagement(input: {
  access: WorkAccess;
  engagementId: string;
  opportunityId: string;
  applicationId: string;
  offerId: string;
}) {
  for (const link of [
    {
      sourceEntityType: "work_engagement",
      sourceEntityId: input.engagementId,
      targetEntityType: "job_opportunity",
      targetEntityId: input.opportunityId,
      relationship: "originated_from_accepted_opportunity"
    },
    {
      sourceEntityType: "job_offer",
      sourceEntityId: input.offerId,
      targetEntityType: "work_engagement",
      targetEntityId: input.engagementId,
      relationship: "created_planned_engagement"
    },
    {
      sourceEntityType: "job_application",
      sourceEntityId: input.applicationId,
      targetEntityType: "work_engagement",
      targetEntityId: input.engagementId,
      relationship: "resulted_in_engagement"
    }
  ]) {
    appendAuthorizedWorkLinks({
      sourceEntityType: link.sourceEntityType,
      sourceEntityId: link.sourceEntityId,
      access: input.access,
      links: [
        {
          targetEntityType: link.targetEntityType,
          targetEntityId: link.targetEntityId,
          relationship: link.relationship,
          anchorKey: "accepted_offer"
        }
      ]
    });
  }
}

export function acceptOfferAsPlannedEngagement(input: {
  access: WorkAccess;
  offerId: string;
  expectedOfferRevision: number;
  idempotencyKey: string;
}) {
  const offer = getDatabase()
    .prepare("SELECT * FROM job_offers WHERE id = ?")
    .get(input.offerId) as SqlRow | undefined;
  if (!offer)
    throw new HttpError(
      404,
      "work_offer_not_found",
      "The Job Offer was not found."
    );
  getAuthorizedRoot(
    "job_application",
    String(offer.application_id),
    input.access
  );
  const requestFingerprint = fingerprint(input);
  const replay = getOperationReceipt({
    ownerUserId: input.access.mutationOwnerUserId,
    operationKind: "offer_acceptance",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    access: input.access
  });
  if (replay)
    return {
      replayed: true,
      ...((replay.response as Record<string, unknown>) ?? {})
    };
  return runInTransaction(() => {
    const currentOffer = getDatabase()
      .prepare("SELECT * FROM job_offers WHERE id = ?")
      .get(input.offerId) as SqlRow;
    if (Number(currentOffer.revision) !== input.expectedOfferRevision) {
      throw new HttpError(
        409,
        "work_revision_conflict",
        "The offer changed before it could be accepted."
      );
    }
    if (
      currentOffer.planned_engagement_id ||
      currentOffer.status === "accepted"
    ) {
      throw new HttpError(
        409,
        "work_offer_already_accepted",
        "This offer is already connected to a planned Work Engagement."
      );
    }
    if (
      !["received", "negotiating", "revised"].includes(
        String(currentOffer.status)
      )
    ) {
      throw new HttpError(
        409,
        "work_offer_acceptance_invalid",
        "Only a received or actively negotiated offer can be accepted."
      );
    }
    const privateCompensation =
      typeof currentOffer.private_compensation_json === "string"
        ? (JSON.parse(currentOffer.private_compensation_json) as unknown)
        : currentOffer.private_compensation_json;
    if (
      hasMaterialValue(privateCompensation) &&
      !input.access.canCompensation
    ) {
      throw new HttpError(
        403,
        "work_compensation_scope_required",
        "Accepting this offer requires authority to review its compensation terms."
      );
    }
    const currentApplication = getAuthorizedRoot(
      "job_application",
      String(currentOffer.application_id),
      input.access
    );
    if (currentApplication.status !== "offer") {
      throw new HttpError(
        409,
        "work_offer_application_stage_invalid",
        "The application must be in its offer stage before accepting the offer."
      );
    }
    const opportunity = getAuthorizedRoot(
      "job_opportunity",
      String(currentApplication.opportunityId),
      input.access
    );
    const now = nowIso();
    const createdEngagement = createWorkEngagement(
      input.access,
      plannedEngagementFromOffer({
        access: input.access,
        offerId: input.offerId,
        offer: rowToWorkRecord(currentOffer, input.access),
        application: currentApplication,
        opportunity,
        observedAt: now
      })
    );
    const engagementId = requireCreatedEngagementId(createdEngagement);
    const offerUpdate = getDatabase()
      .prepare(
        "UPDATE job_offers SET status = 'accepted', planned_engagement_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?"
      )
      .run(engagementId, now, input.offerId, input.expectedOfferRevision);
    if (Number(offerUpdate.changes) !== 1)
      throw new HttpError(
        409,
        "work_revision_conflict",
        "The offer changed before it could be accepted."
      );
    const acceptedOffer = getDatabase()
      .prepare("SELECT * FROM job_offers WHERE id = ?")
      .get(input.offerId) as SqlRow;
    recordSupportingRevision({
      kind: "offer",
      row: acceptedOffer,
      access: input.access,
      createdAt: now
    });
    recordOfferRevision(acceptedOffer, input.access, now);
    const acceptedApplication = transitionJobApplication({
      access: input.access,
      id: String(currentApplication.id),
      expectedRevision: Number(currentApplication.revision),
      newStatus: "accepted",
      factualDescription:
        "The offer was accepted and a planned Work Engagement was created.",
      outcome: "accepted",
      nextAction: "Review the planned engagement and transition dates.",
      dueAt: null,
      sourceArtifactId: null,
      confidence: 1,
      verifiedOfferAcceptance: true,
      provenance: { sourceKind: "system", offerId: input.offerId }
    });
    linkAcceptedEngagement({
      access: input.access,
      engagementId,
      opportunityId: String(opportunity.id),
      applicationId: String(currentApplication.id),
      offerId: input.offerId
    });
    const response = {
      engagement: getAuthorizedRoot(
        "work_engagement",
        engagementId,
        input.access
      ),
      offer: rowToWorkRecord(acceptedOffer, input.access),
      application: acceptedApplication
    };
    storeOperationReceipt({
      ownerUserId: input.access.mutationOwnerUserId,
      operationKind: "offer_acceptance",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      response,
      createdRecords: [{ table: "work_engagements", id: engagementId }]
    });
    recordWorkActivity({
      entityType: "work_engagement",
      entityId: engagementId,
      eventType: "work_engagement_planned_from_offer",
      title: `Planned engagement created: ${String(opportunity.title)}`,
      actor: input.access.actor
    });
    return { replayed: false, ...response };
  });
}
