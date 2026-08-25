import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  FileText,
  ListChecks,
  Plus,
  ShieldAlert,
  Sparkles
} from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  EvidenceList,
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import {
  ApplicationArtifactDialog,
  ApplicationEventDialog,
  ApplicationQuestionDialog,
  ApplicationWorkspaceDialog,
  InterviewDialog,
  OfferDialog,
  TransmissionPreviewDialog,
  VerifiedSubmissionDialog
} from "@/components/work/work-operational-dialogs";
import { transitionJobApplication } from "@/lib/work-api";
import type {
  JobApplication,
  JobOpportunity,
  OpportunityCampaign,
  WorkRecord
} from "@/lib/work-api";
import {
  RelationshipEditor,
  EventTimeline,
  FactsGrid,
  record
} from "./work-detail-shared";
import { APPLICATION_TRANSITIONS } from "./work-application-transitions";

export function ApplicationWorkspaceDetail({
  application,
  opportunity,
  campaign,
  profiles,
  documentSets,
  responses,
  userIds,
  onRefresh
}: {
  application: JobApplication;
  opportunity?: JobOpportunity;
  campaign?: OpportunityCampaign;
  profiles: WorkRecord[];
  documentSets: WorkRecord[];
  responses: WorkRecord[];
  userIds: string[];
  onRefresh: () => Promise<void>;
}) {
  const available = APPLICATION_TRANSITIONS[application.status] ?? [];
  const [newStatus, setNewStatus] = useState(available[0] ?? "");
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState(application.nextAction ?? "");
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<
    WorkRecord | undefined
  >();
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState<
    WorkRecord | undefined
  >();
  const [offerOpen, setOfferOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<WorkRecord | undefined>();
  const [transmissionOpen, setTransmissionOpen] = useState(false);
  const [verifiedOpen, setVerifiedOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => {
    setNewStatus((APPLICATION_TRANSITIONS[application.status] ?? [])[0] ?? "");
    setNextAction(application.nextAction ?? "");
    setOutcome("");
  }, [application]);
  const transition = useMutation({
    mutationFn: () =>
      transitionJobApplication(userIds, application.id, {
        expectedRevision: Number(application.revision),
        newStatus,
        factualDescription: description,
        outcome,
        nextAction,
        dueAt: null,
        sourceArtifactId: null,
        confidence: 1,
        provenance: {
          sourceKind: "user",
          sourceLabel: "Forge Work application timeline"
        }
      }),
    onSuccess: async () => {
      setDescription("");
      setOutcome("");
      await onRefresh();
    }
  });
  const criteriaVersions =
    (campaign?.criteriaVersions as WorkRecord[] | undefined) ?? [];
  const criteriaVersionId = String(
    campaign?.currentCriteria?.id ?? criteriaVersions[0]?.id ?? ""
  );
  const authorizedPreviews = (application.transmissionPreviews ?? []).filter(
    (preview) => preview.status === "authorized"
  );
  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="job_application"
        title={
          opportunity ? `Application · ${opportunity.title}` : "Job application"
        }
        description={`${opportunity?.employerName || "Employer unknown"}${campaign ? ` · ${campaign.title}` : ""}`}
        badge={<WorkStatusBadge status={application.status} />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setActivityOpen(true)}>
              <ListChecks className="size-4" />
              Record activity
            </Button>
            <Button variant="secondary" onClick={() => setWorkspaceOpen(true)}>
              Edit workspace
            </Button>
            <Button
              variant="secondary"
              onClick={() => setTransmissionOpen(true)}
              disabled={application.status !== "ready_to_submit"}
            >
              <ShieldAlert className="size-4" />
              Transmission preview
            </Button>
            <Button
              onClick={() => setVerifiedOpen(true)}
              disabled={!authorizedPreviews.length}
            >
              Verify submission
            </Button>
          </div>
        }
      />
      <div className="grid gap-5 px-4 sm:px-6">
        <Link
          to="/work?tab=applications"
          className="inline-flex items-center gap-2 text-sm text-[var(--primary)]"
        >
          <ArrowLeft className="size-4" />
          Back to Applications
        </Link>
        <FactsGrid
          facts={[
            { label: "Status", value: application.status },
            { label: "Priority", value: application.priority },
            {
              label: "Criteria basis",
              value: application.criteriaVersionId || "Not recorded"
            },
            { label: "Started", value: formatDate(application.startedAt) },
            {
              label: "Submitted",
              value: formatDate(application.submittedAt, "Not submitted")
            },
            {
              label: "Acknowledged",
              value: formatDate(application.acknowledgedAt, "Not acknowledged")
            },
            {
              label: "Last contact",
              value: formatDate(application.lastContactAt, "Not set")
            },
            {
              label: "Next follow-up",
              value: formatDate(application.nextFollowUpAt, "Not set")
            },
            {
              label: "Expected response",
              value: formatDate(application.expectedResponseAt, "Not set")
            },
            {
              label: "Decision deadline",
              value: formatDate(application.decisionDeadline, "Not set")
            },
            { label: "Referral", value: application.referralState },
            { label: "Outcome", value: application.outcome || "Open" },
            {
              label: "Future reapplication",
              value: formatDate(application.reapplicationDate, "Not set")
            },
            {
              label: "Confirmation receipt",
              value: application.confirmationReceipt || "Not recorded"
            },
            {
              label: "Tracking identifier",
              value: application.trackingIdentifier || "Not recorded"
            }
          ]}
        />
        {application.reapplicationOfApplicationId ? (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                  Reviewed reapplication
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-strong)]">
                  {readable(
                    application.reapplicationReason,
                    "A reviewed reason was not projected for this credential."
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                  Reviewed {formatDate(application.reapplicationReviewedAt)}
                </p>
              </div>
              <Link
                to={`/work/applications/${application.reapplicationOfApplicationId}`}
                className="text-sm font-medium text-[var(--primary)]"
              >
                Open prior application
              </Link>
            </div>
          </Card>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
          <div className="grid gap-5">
            <EventTimeline
              events={application.events}
              empty="The application workspace was created, but no later status evidence is recorded."
            />
            {application.employerReason ||
            application.inferredExplanation ||
            application.lessons ? (
              <Card className="grid gap-5">
                <EvidenceList
                  title="Employer-provided reason"
                  items={
                    application.employerReason
                      ? [application.employerReason]
                      : []
                  }
                  empty="No employer reason was supplied."
                />
                <EvidenceList
                  title="Possible explanation"
                  items={
                    application.inferredExplanation
                      ? [application.inferredExplanation]
                      : []
                  }
                  empty="No inference is recorded."
                />
                <EvidenceList
                  title="Lessons"
                  items={application.lessons ? [application.lessons] : []}
                  empty="No lessons recorded yet."
                />
              </Card>
            ) : null}
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    Exact application materials
                  </h2>
                  <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    Each immutable use pins an Artifact version and checksum;
                    preparation is not submission.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setArtifactOpen(true)}
                >
                  <Plus className="size-3.5" />
                  Link material
                </Button>
              </div>
              {application.artifactUses?.length ? (
                <div className="mt-3 grid gap-2">
                  {application.artifactUses.map((use) => (
                    <div
                      key={use.id}
                      className="flex items-center justify-between gap-3 rounded-[16px] bg-[var(--ui-surface-2)] p-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                          Artifact {String(use.artifactId)}
                        </span>
                        <span className="block truncate text-xs text-[var(--ui-ink-soft)]">
                          {readable(use.useKind)} ·{" "}
                          {readable(use.approvalState)} · SHA-256{" "}
                          {String(use.contentSha256 ?? "").slice(0, 12)}
                        </span>
                      </span>
                      <FileText className="size-4 shrink-0 text-[var(--ui-ink-faint)]" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                  No curriculum vitae, cover letter, answer set, portfolio, or
                  receipt has been pinned yet.
                </p>
              )}
            </Card>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    Application questions and answers
                  </h2>
                  <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    Exact employer wording with application-specific reviewed
                    answers.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSelectedQuestion(undefined);
                    setQuestionOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  Question
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {application.questions?.map((question) => (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => {
                      setSelectedQuestion(question);
                      setQuestionOpen(true);
                    }}
                    className="rounded-[16px] bg-[var(--ui-surface-2)] p-3 text-left"
                  >
                    <div className="line-clamp-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                      {String(question.exactQuestion)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {readable(question.normalizedCategory)} ·{" "}
                      {readable(question.reviewState)}
                    </div>
                  </button>
                ))}
                {!application.questions?.length ? (
                  <p className="text-sm text-[var(--ui-ink-soft)]">
                    No application question has been recorded.
                  </p>
                ) : null}
              </div>
            </Card>
            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CalendarCheck2 className="size-4 text-[var(--primary)]" />
                    <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                      Interviews
                    </h2>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedInterview(undefined);
                      setInterviewOpen(true);
                    }}
                  >
                    <Plus className="size-3.5" />
                    Add
                  </Button>
                </div>
                {application.interviews?.length ? (
                  <div className="mt-3 grid gap-2">
                    {application.interviews.map((interview) => (
                      <div
                        key={interview.id}
                        className="rounded-[16px] bg-[var(--ui-surface-2)] p-3"
                      >
                        <Link
                          to={`/work/interviews/${interview.id}`}
                          className="block"
                        >
                          <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                            {readable(interview.stage, "Interview")}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                            {formatDate(interview.scheduledStartAt)} ·{" "}
                            {readable(interview.format)}
                          </div>
                        </Link>
                        <Button
                          className="mt-2"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedInterview(interview);
                            setInterviewOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                    No interview scheduled.
                  </p>
                )}
              </Card>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-[var(--primary)]" />
                    <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                      Offers
                    </h2>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedOffer(undefined);
                      setOfferOpen(true);
                    }}
                  >
                    <Plus className="size-3.5" />
                    Add
                  </Button>
                </div>
                {application.offers?.length ? (
                  <div className="mt-3 grid gap-2">
                    {application.offers.map((offer) => (
                      <div
                        key={offer.id}
                        className="rounded-[16px] bg-[var(--ui-surface-2)] p-3"
                      >
                        <Link to={`/work/offers/${offer.id}`} className="block">
                          <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                            {String(record(offer.terms).title ?? "Job offer")}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                            {readable(offer.status)} · expires{" "}
                            {formatDate(offer.expiresAt)}
                          </div>
                        </Link>
                        <Button
                          className="mt-2"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedOffer(offer);
                            setOfferOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                    No offer recorded.
                  </p>
                )}
              </Card>
            </div>
            <Card>
              <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                Transmission evidence
              </h2>
              <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                Preview, approval, external action, and direct evidence remain
                distinct.
              </p>
              <div className="mt-3 grid gap-2">
                {application.transmissionPreviews?.map((preview) => (
                  <div
                    key={preview.id}
                    className="rounded-[16px] bg-[var(--ui-surface-2)] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <WorkStatusBadge status={preview.status} />
                      <span className="text-xs text-[var(--ui-ink-faint)]">
                        {formatDate(preview.createdAt)}
                      </span>
                    </div>
                    <div className="mt-2 break-all font-mono text-[11px] text-[var(--ui-ink-soft)]">
                      {String(preview.previewDigest)}
                    </div>
                  </div>
                ))}
                {!application.transmissionPreviews?.length ? (
                  <p className="text-sm text-[var(--ui-ink-soft)]">
                    No transmission preview exists.
                  </p>
                ) : null}
              </div>
            </Card>
          </div>
          <div className="grid content-start gap-5">
            <Card>
              <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                Move the application forward
              </h2>
              {application.status === "ready_to_submit" ? (
                <div className="mt-3 rounded-[16px] border border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle))] bg-[color-mix(in_srgb,var(--warning)_7%,var(--ui-surface-1))] p-3 text-sm text-[var(--ui-ink-medium)]">
                  <ShieldAlert className="mb-2 size-5 text-[var(--warning)]" />
                  Forge will not infer submission from a prepared package. Build
                  an exact preview, obtain central approval, perform the
                  authorized external action, then record direct evidence.
                </div>
              ) : null}
              {available.length ? (
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                    New stage
                    <select
                      value={newStatus}
                      onChange={(event) => setNewStatus(event.target.value)}
                      className="min-h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                    >
                      {available.map((status) => (
                        <option key={status} value={status}>
                          {readable(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                    What fact supports this change?
                    <Textarea
                      rows={4}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                    Outcome or result
                    <Textarea
                      rows={3}
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                    Next action
                    <Textarea
                      rows={3}
                      value={nextAction}
                      onChange={(event) => setNextAction(event.target.value)}
                    />
                  </label>
                  <Button
                    disabled={!newStatus || !description.trim()}
                    pending={transition.isPending}
                    onClick={() => transition.mutate()}
                  >
                    <CheckCircle2 className="size-4" />
                    Record status event
                  </Button>
                  {transition.error ? (
                    <p className="text-sm text-[var(--danger)]">
                      {transition.error.message}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                  This application has no ordinary next transition.
                </p>
              )}
            </Card>
            <Card>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                Current next action
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-strong)]">
                {application.nextAction || "No next action recorded."}
              </p>
              {application.blocker ? (
                <div className="mt-4 rounded-[16px] border border-[color-mix(in_srgb,var(--danger)_25%,var(--ui-border-subtle))] p-3 text-sm text-[var(--danger)]">
                  <CircleAlert className="mb-2 size-4" />
                  {application.blocker}
                </div>
              ) : null}
            </Card>
            <RelationshipEditor
              links={application.links}
              entityType="job_application"
              entityId={application.id}
              revision={Number(application.revision)}
              userIds={userIds}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </div>
      <ApplicationArtifactDialog
        open={artifactOpen}
        onOpenChange={setArtifactOpen}
        userIds={userIds}
        applicationId={application.id}
        onSaved={onRefresh}
      />
      <ApplicationEventDialog
        open={activityOpen}
        onOpenChange={setActivityOpen}
        userIds={userIds}
        application={application}
        onSaved={onRefresh}
      />
      <ApplicationQuestionDialog
        open={questionOpen}
        onOpenChange={setQuestionOpen}
        userIds={userIds}
        applicationId={application.id}
        question={selectedQuestion}
        responses={responses}
        onSaved={onRefresh}
      />
      <InterviewDialog
        open={interviewOpen}
        onOpenChange={setInterviewOpen}
        userIds={userIds}
        applicationId={application.id}
        interview={selectedInterview}
        onSaved={onRefresh}
      />
      <OfferDialog
        open={offerOpen}
        onOpenChange={setOfferOpen}
        userIds={userIds}
        applicationId={application.id}
        offer={selectedOffer}
        criteriaVersionId={criteriaVersionId}
        onSaved={onRefresh}
      />
      <TransmissionPreviewDialog
        open={transmissionOpen}
        onOpenChange={setTransmissionOpen}
        userIds={userIds}
        application={application}
        onSaved={onRefresh}
      />
      <VerifiedSubmissionDialog
        open={verifiedOpen}
        onOpenChange={setVerifiedOpen}
        userIds={userIds}
        application={application}
        onSaved={onRefresh}
      />
      <ApplicationWorkspaceDialog
        open={workspaceOpen}
        onOpenChange={setWorkspaceOpen}
        userIds={userIds}
        application={application}
        profiles={profiles}
        documentSets={documentSets}
        onSaved={onRefresh}
      />
    </div>
  );
}
