import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient
} from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  KeyRound,
  Laptop,
  ShieldCheck,
  UserRoundCheck
} from "lucide-react";
import {
  FlowChoiceGrid,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePeopleGateway } from "@/components/people/people-gateway";
import {
  PeopleStateBanner,
  formatPeopleDateTime
} from "@/components/people/people-status";
import { useDelayedFlag } from "@/components/people/use-delayed-flag";
import type {
  PeoplePendingRequestsPage,
  PeoplePendingRequest,
  RequestReviewDecision
} from "@/components/people/people-types";

export const PEOPLE_REQUESTS_QUERY_KEY = ["people", "requests"] as const;
const INITIAL_VISIBLE_REQUESTS = 20;
const MAX_PENDING_REQUEST_PAGES = 100;

type RequestReviewDraft = {
  decision: "accept" | "reject";
  recentAuthenticationConfirmed: boolean;
};

const EMPTY_REVIEW_DRAFT: RequestReviewDraft = {
  decision: "accept",
  recentAuthenticationConfirmed: false
};

function RequestKindIcon({ kind }: { kind: PeoplePendingRequest["kind"] }) {
  const Icon =
    kind === "pairing" ? UserRoundCheck : kind === "device" ? Laptop : KeyRound;
  return <Icon className="size-4" aria-hidden="true" />;
}

function requestDirectionLabel(request: PeoplePendingRequest) {
  if (request.direction === "incoming") {
    if (request.kind === "pairing" || request.kind === "device") {
      return "Awaiting your decision";
    }
    return `${request.personLabel} to you`;
  }
  if (request.direction === "outgoing") {
    if (request.kind === "pairing" || request.kind === "device") {
      return "Initiated by you";
    }
    return `You to ${request.personLabel}`;
  }
  return "Direction unavailable";
}

function sharedInformationLabel(projectionId: string) {
  const knownLabels: Record<string, string> = {
    "calendar.availability.v1": "Calendar availability",
    "goals.horizon_summary.v1": "Goal summaries",
    "health.cycling.aggregate.v1": "Cycling totals",
    "movement.aggregate.v1": "Movement totals",
    "person.profile.v1": "Profile details",
    "custom.selected_entities.v1": "Selected records"
  };
  if (knownLabels[projectionId]) {
    return knownLabels[projectionId];
  }
  const words = projectionId
    .replace(/\.v\d+$/, "")
    .split(".")
    .flatMap((part) => part.split("_"))
    .filter(Boolean);
  const label = words.join(" ");
  return label
    ? `${label[0]!.toUpperCase()}${label.slice(1)}`
    : "Shared information";
}

export function requestAcceptBlocker(
  request: PeoplePendingRequest,
  now = Date.now()
) {
  if (request.direction !== "incoming") {
    return "Forge cannot confirm who sent this request, so it can only be rejected.";
  }
  if (request.expiresAt) {
    const expiresAt = Date.parse(request.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      return "This request has expired. Refresh the inbox before deciding.";
    }
  }
  if (
    request.kind === "pairing" &&
    !request.identityFingerprint &&
    !request.verificationPhrase
  ) {
    return "The pairing request has no fingerprint or verification phrase to compare.";
  }
  if (request.kind === "device" && !request.identityFingerprint) {
    return "The device request has no identity fingerprint to review.";
  }
  if (request.kind === "device" && !request.requestedDeviceLabel) {
    return "The device request has no device label to review.";
  }
  return null;
}

export function PeopleRequestsInbox({
  open,
  onOpenChange,
  onOpenPerson
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPerson: (personId: string) => void;
}) {
  const gateway = usePeopleGateway();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] =
    useState<PeoplePendingRequest | null>(null);
  const [draft, setDraft] = useState<RequestReviewDraft>(EMPTY_REVIEW_DRAFT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [visibleRequestCount, setVisibleRequestCount] = useState(
    INITIAL_VISIBLE_REQUESTS
  );

  const requestsQuery = useInfiniteQuery<PeoplePendingRequestsPage>({
    queryKey: PEOPLE_REQUESTS_QUERY_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      gateway.listPendingRequests({
        cursor: typeof pageParam === "string" ? pageParam : undefined,
        limit: 100
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    placeholderData: (previousData) => previousData
  });
  const requests = useMemo(() => {
    const unique = new Map<string, PeoplePendingRequest>();
    for (const request of requestsQuery.data?.pages.flatMap(
      (page) => page.requests
    ) ?? []) {
      unique.set(request.id, request);
    }
    return [...unique.values()];
  }, [requestsQuery.data?.pages]);
  const {
    error: requestsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = requestsQuery;
  const slowRequestLoad = useDelayedFlag(requestsQuery.isLoading);
  const pendingPageCount = requestsQuery.data?.pages.length ?? 0;
  const traversalCapped =
    pendingPageCount >= MAX_PENDING_REQUEST_PAGES && Boolean(hasNextPage);
  const selectedAcceptBlocker = selectedRequest
    ? requestAcceptBlocker(selectedRequest)
    : null;

  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      !requestsError &&
      !traversalCapped
    ) {
      void fetchNextPage();
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    requestsError,
    traversalCapped
  ]);

  const reviewMutation = useMutation({
    mutationFn: (input: RequestReviewDecision) => gateway.reviewRequest(input),
    onSuccess: async () => {
      setSelectedRequest(null);
      setDraft(EMPTY_REVIEW_DRAFT);
      setSubmitError(null);
      await queryClient.invalidateQueries({
        queryKey: PEOPLE_REQUESTS_QUERY_KEY
      });
      await queryClient.invalidateQueries({
        queryKey: ["people", "collection"]
      });
      await queryClient.invalidateQueries({
        queryKey: ["people", "context"]
      });
    }
  });

  const steps = useMemo<Array<QuestionFlowStep<RequestReviewDraft>>>(() => {
    if (!selectedRequest) {
      return [];
    }
    return [
      {
        id: "request",
        title: selectedRequest.title,
        description: selectedRequest.summary,
        render: () => (
          <dl className="grid gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm">
            <div>
              <dt className="text-[var(--ui-ink-muted)]">Person</dt>
              <dd className="mt-1 font-medium text-[var(--ui-ink-strong)]">
                {selectedRequest.personLabel}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--ui-ink-muted)]">Direction</dt>
              <dd className="mt-1 font-medium text-[var(--ui-ink-strong)]">
                {requestDirectionLabel(selectedRequest)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--ui-ink-muted)]">Received</dt>
              <dd className="mt-1 text-[var(--ui-ink-medium)]">
                {formatPeopleDateTime(selectedRequest.receivedAt)}
              </dd>
            </div>
            {selectedRequest.expiresAt ? (
              <div>
                <dt className="text-[var(--ui-ink-muted)]">Expires</dt>
                <dd className="mt-1 text-[var(--ui-ink-medium)]">
                  {formatPeopleDateTime(selectedRequest.expiresAt)}
                </dd>
              </div>
            ) : null}
          </dl>
        )
      },
      {
        id: "scope",
        title: "Review the exact request",
        description:
          "Nothing is accepted automatically. Confirm the identity, device, requested information, and fields shown here.",
        render: () => (
          <div className="grid gap-4 text-sm">
            {selectedRequest.identityFingerprint ? (
              <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-[var(--ui-ink-muted)]">
                  Identity fingerprint
                </div>
                <div className="mt-2 break-all font-mono text-[var(--ui-ink-strong)]">
                  {selectedRequest.identityFingerprint}
                </div>
              </div>
            ) : null}
            {selectedRequest.verificationPhrase ? (
              <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-[var(--ui-ink-muted)]">
                  Verification phrase
                </div>
                <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
                  {selectedRequest.verificationPhrase}
                </div>
              </div>
            ) : null}
            {selectedRequest.requestedDeviceLabel ? (
              <div>
                <div className="text-[var(--ui-ink-muted)]">Device</div>
                <div className="mt-1 text-[var(--ui-ink-strong)]">
                  {selectedRequest.requestedDeviceLabel}
                </div>
              </div>
            ) : null}
            <div>
              <div className="text-[var(--ui-ink-muted)]">
                Requested information
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedRequest.requestedProjections.length > 0 ? (
                  selectedRequest.requestedProjections.map((projection) => (
                    <Badge key={projection} size="sm" wrap>
                      {sharedInformationLabel(projection)} · Exact ID:{" "}
                      {projection}
                    </Badge>
                  ))
                ) : (
                  <Badge size="sm" tone="meta">
                    No information requested
                  </Badge>
                )}
              </div>
            </div>
            <div>
              <div className="text-[var(--ui-ink-muted)]">Requested fields</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedRequest.requestedFields.length > 0 ? (
                  selectedRequest.requestedFields.map((field) => (
                    <Badge key={field} size="sm" wrap>
                      {field}
                    </Badge>
                  ))
                ) : (
                  <Badge size="sm" tone="meta">
                    None
                  </Badge>
                )}
              </div>
            </div>
            <p className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] p-3 leading-6 text-[var(--ui-ink-medium)]">
              {selectedRequest.consequence}
            </p>
            {selectedAcceptBlocker ? (
              <PeopleStateBanner
                state="warning"
                title="Acceptance is unavailable"
              >
                {selectedAcceptBlocker} You can reject this request without
                activating it.
              </PeopleStateBanner>
            ) : null}
          </div>
        )
      },
      {
        id: "decision",
        title: "Choose your decision",
        description:
          "Accept only the request shown, or reject it. Accepting cannot add any person, device, or information beyond what you reviewed.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowChoiceGrid
              value={value.decision}
              onChange={(decision) =>
                setValue({ decision: decision as "accept" | "reject" })
              }
              options={[
                ...(selectedAcceptBlocker
                  ? []
                  : [
                      {
                        value: "accept",
                        label: "Accept this request",
                        description: selectedRequest.consequence
                      }
                    ]),
                {
                  value: "reject",
                  label: "Reject request",
                  description: "Nothing will be connected or shared."
                }
              ]}
            />
            {value.decision === "accept" ? (
              <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm text-[var(--ui-ink-medium)]">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={value.recentAuthenticationConfirmed}
                  onChange={(event) =>
                    setValue({
                      recentAuthenticationConfirmed: event.target.checked
                    })
                  }
                />
                <span>
                  I am present, recently authenticated, and reviewed this exact
                  request.
                </span>
              </label>
            ) : null}
          </div>
        )
      }
    ];
  }, [selectedAcceptBlocker, selectedRequest]);

  return (
    <section
      aria-labelledby="people-requests-heading"
      className="border-b border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
    >
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-ring)]"
        aria-expanded={open}
        aria-controls="people-requests-content"
        onClick={() => onOpenChange(!open)}
      >
        <ShieldCheck
          className="size-4 text-[var(--primary)]"
          aria-hidden="true"
        />
        <span
          id="people-requests-heading"
          className="min-w-0 flex-1 text-sm font-semibold text-[var(--ui-ink-strong)]"
        >
          Pending requests
        </span>
        <Badge
          size="xs"
          tone={requests.length > 0 && !requestsQuery.error ? "signal" : "meta"}
          className={
            requestsQuery.error
              ? "border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] text-[var(--danger)]"
              : undefined
          }
        >
          {requestsQuery.isLoading
            ? "..."
            : requestsQuery.error && requests.length === 0
              ? "Unavailable"
              : requestsQuery.isFetchingNextPage || traversalCapped
                ? `${requests.length}+`
                : requests.length}
        </Badge>
        {open ? (
          <ChevronUp className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div
          id="people-requests-content"
          className="border-t border-[var(--ui-border-subtle)] px-4 py-3"
        >
          {requestsQuery.isLoading ? (
            <div role="status" className="text-sm text-[var(--ui-ink-muted)]">
              <p>
                {slowRequestLoad
                  ? "Pending requests are taking longer than expected to load."
                  : "Loading pending requests..."}
              </p>
              {slowRequestLoad ? (
                <p className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                  No request will be accepted while this list is unavailable.
                </p>
              ) : null}
            </div>
          ) : requestsQuery.error && requests.length === 0 ? (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-[var(--danger)]">
                Pending requests could not be loaded.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() => void requestsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : requests.length === 0 ? (
            <p role="status" className="text-sm text-[var(--ui-ink-muted)]">
              No pairing, device, or sharing requests need review.
            </p>
          ) : (
            <>
              {requestsQuery.error ? (
                <PeopleStateBanner
                  state="warning"
                  title="Showing saved pending requests"
                >
                  Forge could not refresh this inbox. Previously loaded requests
                  remain visible and may be stale.
                </PeopleStateBanner>
              ) : null}
              {requestsQuery.isFetchingNextPage ? (
                <p
                  role="status"
                  className="mb-3 text-xs text-[var(--ui-ink-muted)]"
                >
                  {requests.length} pending requests loaded; loading more.
                </p>
              ) : null}
              {traversalCapped ? (
                <PeopleStateBanner
                  state="warning"
                  title="More requests are waiting"
                >
                  Forge loaded the first {requests.length.toLocaleString()}{" "}
                  requests. Additional requests are available but are not shown
                  here yet.
                </PeopleStateBanner>
              ) : null}
              <ul
                className="divide-y divide-[var(--ui-border-subtle)]"
                aria-label="Pending People requests"
              >
                {requests.slice(0, visibleRequestCount).map((request) => (
                  <li
                    key={request.id}
                    className="grid min-w-0 gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <RequestKindIcon kind={request.kind} />
                        <span className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                          {request.title}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-[var(--ui-ink-muted)]">
                        {request.summary}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-ink-faint)]">
                        <span>{request.personLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="size-3" aria-hidden="true" />
                          {formatPeopleDateTime(request.receivedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {request.personId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="min-h-11"
                          onClick={() => onOpenPerson(request.personId!)}
                        >
                          Open person
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="min-h-11"
                        onClick={() => {
                          setSelectedRequest(request);
                          setDraft({
                            decision: requestAcceptBlocker(request)
                              ? "reject"
                              : "accept",
                            recentAuthenticationConfirmed: false
                          });
                          setSubmitError(null);
                        }}
                      >
                        Review
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!requestsQuery.isLoading &&
          !requestsQuery.error &&
          requests.length > visibleRequestCount ? (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--ui-border-subtle)] pt-3">
              <p className="text-xs text-[var(--ui-ink-muted)]">
                Showing {visibleRequestCount} of {requests.length} requests
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() =>
                  setVisibleRequestCount((current) =>
                    Math.min(
                      requests.length,
                      current + INITIAL_VISIBLE_REQUESTS
                    )
                  )
                }
              >
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedRequest ? (
        <QuestionFlowDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setSelectedRequest(null);
              setDraft(EMPTY_REVIEW_DRAFT);
              setSubmitError(null);
            }
          }}
          eyebrow="People requests"
          title="Review pending request"
          description="Review the identity, device, and exact information requested before you decide."
          value={draft}
          onChange={setDraft}
          steps={steps}
          submitLabel={
            draft.decision === "accept" ? "Accept request" : "Reject request"
          }
          pending={reviewMutation.isPending}
          pendingLabel="Applying decision"
          error={
            submitError ??
            (reviewMutation.error instanceof Error
              ? reviewMutation.error.message
              : null)
          }
          resolveContinueBlocker={(stepId, value) =>
            stepId === "decision" && value.decision === "accept"
              ? (selectedAcceptBlocker ??
                (!value.recentAuthenticationConfirmed
                  ? "Confirm recent authentication before accepting."
                  : null))
              : null
          }
          onSubmit={async () => {
            if (draft.decision === "accept" && selectedAcceptBlocker) {
              setSubmitError(selectedAcceptBlocker);
              return;
            }
            if (
              draft.decision === "accept" &&
              !draft.recentAuthenticationConfirmed
            ) {
              setSubmitError("Confirm recent authentication before accepting.");
              return;
            }
            setSubmitError(null);
            try {
              await reviewMutation.mutateAsync({
                requestId: selectedRequest.id,
                decision: draft.decision,
                recentAuthenticationConfirmed:
                  draft.decision === "accept" &&
                  draft.recentAuthenticationConfirmed
              });
            } catch {
              // The mutation error is rendered in the shared guided flow.
            }
          }}
        />
      ) : null}
    </section>
  );
}
