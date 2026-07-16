import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PeopleRequestsInbox,
  requestAcceptBlocker
} from "@/components/people/people-requests-inbox";
import {
  createSyntheticPeopleGateway,
  SYNTHETIC_PENDING_REQUESTS
} from "@/components/people/people-fixtures";
import { renderPeopleUi } from "@/components/people/people-test-utils";

vi.mock("framer-motion", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const motionElement = (tag: "div" | "span") =>
    React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const {
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        ...elementProps
      } = props;
      return React.createElement(tag, { ...elementProps, ref });
    });
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useReducedMotion: () => false,
    motion: {
      div: motionElement("div"),
      span: motionElement("span")
    }
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PeopleRequestsInbox", () => {
  it("rejects ambiguous, expired, and unverifiable requests before review", () => {
    const pairing = SYNTHETIC_PENDING_REQUESTS[0]!;
    const device = SYNTHETIC_PENDING_REQUESTS[1]!;
    expect(requestAcceptBlocker({ ...pairing, direction: "unknown" })).toMatch(
      /cannot confirm who sent/i
    );
    expect(
      requestAcceptBlocker(
        { ...pairing, expiresAt: "2026-07-15T10:00:00.000Z" },
        Date.parse("2026-07-15T10:00:01.000Z")
      )
    ).toMatch(/expired/i);
    expect(
      requestAcceptBlocker({ ...device, identityFingerprint: null })
    ).toMatch(/no identity fingerprint/i);
  });

  it("requires exact human review before accepting a pending request", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    renderPeopleUi(
      <PeopleRequestsInbox
        open
        onOpenChange={vi.fn()}
        onOpenPerson={vi.fn()}
      />,
      { gateway }
    );

    expect(
      await screen.findByRole("list", { name: "Pending People requests" })
    ).toBeInTheDocument();
    expect(
      gateway
        .inspect()
        .calls.filter((call) => call.operation === "reviewRequest")
    ).toHaveLength(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);
    expect(
      await screen.findByRole("heading", {
        name: "Verify a new Forge relationship"
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText("8D4A 72B1 3F90 6CE2")).toBeInTheDocument();
    expect(screen.getByText("No information requested")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /recently authenticated/i })
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept request" }));

    await waitFor(() => {
      expect(
        gateway
          .inspect()
          .calls.filter((call) => call.operation === "reviewRequest")
      ).toHaveLength(1);
    });
    expect(gateway.inspect().pendingRequests).toHaveLength(2);
  });

  it("pairs requested data IDs with plain labels and forbids hidden widening", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    gateway.listPendingRequests = vi.fn().mockResolvedValue({
      requests: [SYNTHETIC_PENDING_REQUESTS[1]!],
      nextCursor: null,
      partial: false
    });
    renderPeopleUi(
      <PeopleRequestsInbox
        open
        onOpenChange={vi.fn()}
        onOpenPerson={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getByText("Requested information")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Calendar availability · Exact ID: calendar.availability.v1"
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      screen.getByText(
        /Accepting cannot add any person, device, or information/i
      )
    ).toBeInTheDocument();
  });

  it("offers rejection only when the request direction cannot be trusted", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    gateway.listPendingRequests = vi.fn().mockResolvedValue({
      requests: [
        {
          ...SYNTHETIC_PENDING_REQUESTS[0]!,
          id: "request_ambiguous",
          direction: "unknown"
        }
      ],
      nextCursor: null,
      partial: false
    });
    renderPeopleUi(
      <PeopleRequestsInbox
        open
        onOpenChange={vi.fn()}
        onOpenPerson={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(screen.getByText("Direction unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText("Acceptance is unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      screen.queryByRole("button", { name: /Accept this request/i })
    ).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /Reject request/i })
    ).toHaveLength(2);
  });

  it("bounds a large request inbox and reveals it progressively", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    gateway.listPendingRequests = vi.fn().mockResolvedValue({
      requests: Array.from({ length: 45 }, (_, index) => ({
        ...SYNTHETIC_PENDING_REQUESTS[0]!,
        id: `request_${index + 1}`,
        title: `Request ${index + 1}`
      })),
      nextCursor: null,
      partial: false
    });
    renderPeopleUi(
      <PeopleRequestsInbox
        open
        onOpenChange={vi.fn()}
        onOpenPerson={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("list", { name: "Pending People requests" });
    expect(screen.getAllByRole("button", { name: "Review" })).toHaveLength(20);
    expect(screen.getByText(/Showing 20 of 45 requests/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("button", { name: "Review" })).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("button", { name: "Review" })).toHaveLength(45);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("shows a truthful partial count and can decide a request loaded from page two", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    const firstRequest = {
      ...SYNTHETIC_PENDING_REQUESTS[0]!,
      id: "request_first_page",
      title: "First page request"
    };
    const secondRequest = {
      ...SYNTHETIC_PENDING_REQUESTS[0]!,
      id: "request_second_page",
      title: "Second page request",
      direction: "unknown" as const
    };
    let resolveSecondPage!: (value: {
      requests: typeof SYNTHETIC_PENDING_REQUESTS;
      nextCursor: null;
      partial: false;
    }) => void;
    const secondPage = new Promise<{
      requests: typeof SYNTHETIC_PENDING_REQUESTS;
      nextCursor: null;
      partial: false;
    }>((resolve) => {
      resolveSecondPage = resolve;
    });
    gateway.listPendingRequests = vi.fn(({ cursor }) =>
      cursor
        ? secondPage
        : Promise.resolve({
            requests: [firstRequest],
            nextCursor: "requests_page_2",
            partial: true
          })
    );
    gateway.reviewRequest = vi.fn().mockResolvedValue(undefined);
    renderPeopleUi(
      <PeopleRequestsInbox
        open
        onOpenChange={vi.fn()}
        onOpenPerson={vi.fn()}
      />,
      { gateway }
    );

    expect(
      await screen.findByRole("list", { name: "Pending People requests" })
    ).toBeInTheDocument();
    expect(await screen.findByText("1+")).toBeInTheDocument();
    expect(
      screen.getByText(/1 pending requests loaded; loading more/i)
    ).toBeInTheDocument();
    await act(async () => {
      resolveSecondPage({
        requests: [secondRequest],
        nextCursor: null,
        partial: false
      });
    });

    const secondRow = (await screen.findByText("Second page request")).closest(
      "li"
    );
    expect(secondRow).not.toBeNull();
    fireEvent.click(within(secondRow!).getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));

    await waitFor(() => {
      expect(gateway.reviewRequest).toHaveBeenCalledWith({
        requestId: secondRequest.id,
        decision: "reject",
        recentAuthenticationConfirmed: false
      });
    });
    expect(gateway.listPendingRequests).toHaveBeenCalledWith({
      cursor: "requests_page_2",
      limit: 100
    });
  });
});
