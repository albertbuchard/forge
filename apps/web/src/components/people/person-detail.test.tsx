import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonDetail } from "@/components/people/person-detail";
import {
  buildSyntheticPeople,
  buildSyntheticPersonContext,
  createSyntheticPeopleGateway
} from "@/components/people/people-fixtures";
import { renderPeopleUi } from "@/components/people/people-test-utils";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PersonDetail", () => {
  it("separates saved details, shared information, sharing, devices, and security history", async () => {
    const gateway = createSyntheticPeopleGateway({ state: "live", count: 12 });
    renderPeopleUi(<PersonDetail personId="person_000001" onBack={vi.fn()} />, {
      gateway,
      route: "/people/person_000001"
    });

    expect(
      await screen.findByRole("heading", { name: "Ari Alden" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What you remember" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Shared by this person" })
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Source: Ari Alden's Forge/).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("30-minute free/busy blocks")).toBeInTheDocument();
    expect(screen.getByText("Profile Wiki page")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Sharing" }));
    expect(
      screen.getByRole("heading", { name: "Shared with this person" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Shared by this person" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You share · sharing version 3/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Shared with you · sharing version 2/)
    ).toBeInTheDocument();
    expect(screen.getByText("Calendar availability")).toBeInTheDocument();
    expect(
      screen.getByText("Exact ID: calendar.availability.v1")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Connection & history" }));
    expect(
      screen.getByRole("heading", { name: "Connection and devices" })
    ).toBeInTheDocument();
    expect(screen.getByText("Home Forge")).toBeInTheDocument();
    expect(screen.getByText("New laptop")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Security history" })
    ).toBeInTheDocument();
    expect(screen.getByText("Event: projection.received")).toBeInTheDocument();
  });

  it("keeps desktop heading levels valid and explains unavailable sections", async () => {
    const baseGateway = createSyntheticPeopleGateway({ count: 4 });
    const detailContext = buildSyntheticPersonContext(
      buildSyntheticPeople(1)[0]
    );
    detailContext.partial = true;
    detailContext.coverage = {
      ...detailContext.coverage,
      wikiProfile: "metadata_only",
      peerDevices: "unavailable",
      grants: "unavailable",
      upcomingTogether: "unavailable",
      audit: "unavailable"
    };
    detailContext.wikiProfile = {
      pageId: "wiki_profile_ari",
      title: null,
      spaceLabel: null,
      excerpt: null,
      href: null,
      associatedAt: "2026-07-14T12:00:00.000Z",
      completeness: "metadata_only"
    };
    detailContext.peer = detailContext.peer
      ? { ...detailContext.peer, devices: [] }
      : null;
    detailContext.outgoingShares = [];
    detailContext.incomingShares = [];
    detailContext.upcomingTogether = [];
    detailContext.audit = [];
    const gateway = {
      ...baseGateway,
      capabilities: {
        ...baseGateway.capabilities,
        wikiAssociation: false
      },
      getPersonContext: vi.fn().mockResolvedValue(detailContext)
    };

    renderPeopleUi(<PersonDetail personId="person_000001" headingLevel={2} />, {
      gateway,
      route: "/people/person_000001"
    });

    expect(
      await screen.findByRole("heading", { name: "Ari Alden", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What you remember", level: 3 })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiki" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(
      screen.getByText(/Wiki page ID: wiki_profile_ari/)
    ).toBeInTheDocument();
    expect(screen.getByText("Page cannot be opened")).toBeInTheDocument();
    expect(
      screen.getByText(/could not load upcoming plans shared with you/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Sharing" }));
    expect(
      screen.getByText("Sharing details could not be loaded")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Forge could not load what you share with Ari Alden.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Connection & history" }));
    expect(
      screen.getByText("Device list could not be loaded")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Security history is unavailable/i)
    ).toBeInTheDocument();
  });

  it("labels stale remote values as cached rather than current", async () => {
    const gateway = createSyntheticPeopleGateway({ state: "stale", count: 4 });
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    expect(
      await screen.findByText(/using incomplete cached data/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Cached value, not current.")).toHaveLength(2);
    expect(
      screen.getAllByText(/Source: Ari Alden's Forge/).length
    ).toBeGreaterThan(0);
  });

  it("shows an unset importance score as not recorded", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const detailContext = buildSyntheticPersonContext(
      buildSyntheticPeople(1)[0]
    );
    detailContext.person.importance = "normal";
    detailContext.person.importanceScore = null;
    gateway.getPersonContext = vi.fn().mockResolvedValue(detailContext);

    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    await screen.findByRole("heading", { name: "Ari Alden" });
    const importanceField = screen.getByText("Importance").closest("div");
    expect(importanceField).toHaveTextContent("Not recorded");
    expect(importanceField).not.toHaveTextContent("normal");
  });

  it("announces detail loading and exposes a retryable error", async () => {
    const slowGateway = createSyntheticPeopleGateway({
      count: 4,
      latencyMs: 30
    });
    const view = renderPeopleUi(
      <PersonDetail personId="person_000001" onBack={vi.fn()} />,
      {
        gateway: slowGateway,
        route: "/people/person_000001"
      }
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading person details"
    );
    expect(
      await screen.findByRole("heading", { name: "Ari Alden" })
    ).toBeInTheDocument();

    view.unmount();
    const errorGateway = createSyntheticPeopleGateway({
      state: "error",
      count: 4
    });
    renderPeopleUi(<PersonDetail personId="person_000001" onBack={vi.fn()} />, {
      gateway: errorGateway,
      route: "/people/person_000001"
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Person details could not be loaded"
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to People" })
    ).toBeInTheDocument();
  });

  it("retains successful detail data when refresh fails and marks it stale", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const detailContext = buildSyntheticPersonContext(
      buildSyntheticPeople(1)[0]
    );
    detailContext.partial = true;
    detailContext.connection = {
      availability: "degraded",
      label: "Using incomplete cached data",
      checkedAt: "2026-07-15T12:00:00.000Z",
      cachedAt: "2026-07-15T11:00:00.000Z"
    };
    gateway.getPersonContext = vi
      .fn()
      .mockResolvedValueOnce(detailContext)
      .mockRejectedValueOnce(new Error("Forge is offline"));
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    expect(
      await screen.findByRole("heading", { name: "Ari Alden" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(
      await screen.findByText("Showing saved details")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ari Alden" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What you remember" })
    ).toBeInTheDocument();
  });

  it("enables Wiki and pairing after runtime capability discovery completes", async () => {
    const baseGateway = createSyntheticPeopleGateway({ count: 4 });
    const capabilities = {
      wikiAssociation: false,
      pairingInvitation: false,
      pairingAcceptance: false
    };
    const detailContext = buildSyntheticPersonContext(
      buildSyntheticPeople(1)[0]
    );
    detailContext.peer = null;
    const gateway = {
      ...baseGateway,
      capabilities,
      getPersonContext: vi.fn(async () => {
        capabilities.wikiAssociation = true;
        capabilities.pairingInvitation = true;
        capabilities.pairingAcceptance = true;
        return detailContext;
      })
    };
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    await screen.findByRole("heading", { name: "Ari Alden" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Wiki" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Pair" })).toBeEnabled();
    });
  });

  it("uses automatic keyboard tab activation with roving focus", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    const overviewTab = await screen.findByRole("tab", { name: "Overview" });
    const sharingTab = screen.getByRole("tab", { name: "Sharing" });
    const connectionTab = screen.getByRole("tab", {
      name: "Connection & history"
    });
    expect(overviewTab).toHaveAttribute("aria-selected", "true");
    expect(overviewTab).toHaveAttribute("tabindex", "0");
    expect(sharingTab).toHaveAttribute("tabindex", "-1");

    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });
    expect(sharingTab).toHaveFocus();
    expect(sharingTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Sharing" })
    ).toBeInTheDocument();

    fireEvent.keyDown(sharingTab, { key: "End" });
    expect(connectionTab).toHaveFocus();
    expect(connectionTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Connection & history" })
    ).toBeInTheDocument();
  });

  it("keeps every detail tab within a three-column phone layout", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    const connectionTab = await screen.findByRole("tab", {
      name: "Connection & history"
    });
    const tabList = screen.getByRole("tablist", {
      name: "Person detail views"
    });

    expect(tabList).toHaveClass("grid-cols-3");
    expect(connectionTab).toHaveClass("min-w-0");
    expect(connectionTab).toHaveTextContent("Connection");
  });

  it("explains partial saved details with a compact natural-language list", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const detailContext = buildSyntheticPersonContext(
      buildSyntheticPeople(1)[0]
    );
    detailContext.partial = true;
    detailContext.connection = {
      availability: "unknown",
      label:
        "Saved details remain available. Forge could not load upcoming events or audit history.",
      checkedAt: "2026-07-15T12:00:00.000Z",
      cachedAt: null
    };
    gateway.getPersonContext = vi.fn().mockResolvedValue(detailContext);
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    expect(
      await screen.findByText(
        /Saved details remain available\. Forge could not load upcoming events or audit history\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Local context loaded/i)).not.toBeInTheDocument();
  });

  it("links only active entity records and exposes unavailable records as disabled", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const detailContext = buildSyntheticPersonContext(
      buildSyntheticPeople(1)[0]
    );
    detailContext.linkedRecords.push({
      id: "link_deleted_note",
      entityType: "note",
      entityId: "note_deleted",
      title: "Archived planning note",
      direction: "incoming",
      anchorKey: null,
      relationship: "reference",
      href: "/notes/note_deleted",
      state: "deleted"
    });
    gateway.getPersonContext = vi.fn().mockResolvedValue(detailContext);

    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    expect(
      await screen.findByRole("link", { name: /Community garden proposal/i })
    ).toHaveAttribute("href", "/projects/project_synthetic_garden");
    const unavailableRow = screen
      .getByText("Archived planning note")
      .closest("[aria-disabled='true']");
    expect(unavailableRow).not.toBeNull();
    expect(unavailableRow?.closest("a")).toBeNull();
    expect(screen.getByText("deleted")).toBeInTheDocument();
  });

  it("opens paired connection status instead of starting another invitation", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway,
      route: "/people/person_000001"
    });

    const connectionAction = await screen.findByRole("button", {
      name: "Connection"
    });
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeEnabled();
    fireEvent.click(connectionAction);

    expect(
      screen.getByRole("tabpanel", { name: "Connection & history" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: /Pair with/i })
    ).not.toBeInTheDocument();
  });

  it("hides withdrawn payloads and explains revoked and conflict states", async () => {
    const revokedGateway = createSyntheticPeopleGateway({
      state: "revoked",
      count: 4
    });
    const view = renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway: revokedGateway,
      route: "/people/person_000001"
    });

    expect(
      await screen.findByText(
        /information already viewed or copied outside Forge cannot be made unseen/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "The shared value is hidden because access was withdrawn."
      )
    ).toHaveLength(2);
    expect(
      screen.queryByText("Free before 10:00 and after 16:30")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();

    view.unmount();
    const conflictGateway = createSyntheticPeopleGateway({
      state: "conflict",
      count: 4
    });
    renderPeopleUi(<PersonDetail personId="person_000001" />, {
      gateway: conflictGateway,
      route: "/people/person_000001"
    });

    expect(await screen.findByText("Sharing conflict")).toBeInTheDocument();
    expect(
      screen.getByText(/will not merge or reactivate either automatically/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });
});
