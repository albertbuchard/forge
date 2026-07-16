import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleCollection } from "@/components/people/people-collection";
import {
  buildSyntheticPeople,
  createSyntheticPeopleGateway
} from "@/components/people/people-fixtures";
import { renderPeopleUi } from "@/components/people/people-test-utils";
import type { PeopleCollectionPage } from "@/components/people/people-types";

vi.mock("@tanstack/react-virtual", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useVirtualizer: (options: {
      count: number;
      getScrollElement: () => HTMLElement | null;
      getItemKey: (index: number) => string | number;
      estimateSize: () => number;
      initialOffset?: number;
    }) => {
      const visibleCount = 12;
      const [startIndex, setStartIndex] = React.useState(() =>
        Math.max(
          0,
          Math.floor((options.initialOffset ?? 0) / options.estimateSize())
        )
      );
      React.useEffect(() => {
        const element = options.getScrollElement();
        if (!element) {
          return;
        }
        const update = () => {
          const requested = Math.floor(
            element.scrollTop / options.estimateSize()
          );
          setStartIndex(
            Math.max(0, Math.min(requested, options.count - visibleCount))
          );
        };
        element.addEventListener("scroll", update);
        return () => element.removeEventListener("scroll", update);
      }, [options]);
      const boundedStart = Math.max(
        0,
        Math.min(startIndex, options.count - visibleCount)
      );
      const end = Math.min(options.count, boundedStart + visibleCount);
      return {
        getTotalSize: () => options.count * options.estimateSize(),
        getVirtualItems: () =>
          Array.from(
            { length: Math.max(0, end - boundedStart) },
            (_, offset) => {
              const index = boundedStart + offset;
              return {
                index,
                key: options.getItemKey(index),
                start: index * options.estimateSize(),
                size: options.estimateSize()
              };
            }
          ),
        measureElement: () => undefined,
        scrollToOffset: (offset: number) => {
          const next = Math.max(
            0,
            Math.min(
              Math.floor(offset / options.estimateSize()),
              options.count - visibleCount
            )
          );
          const element = options.getScrollElement();
          if (element) {
            element.scrollTop = next * options.estimateSize();
          }
          setStartIndex(next);
        },
        scrollToIndex: (index: number) => {
          const next = Math.max(
            0,
            Math.min(index, options.count - visibleCount)
          );
          const element = options.getScrollElement();
          if (element) {
            element.scrollTop = next * options.estimateSize();
          }
          setStartIndex(next);
        }
      };
    }
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PeopleCollection", () => {
  it("keeps the 10,000-person virtual-list benchmark bounded, semantic, and stable", async () => {
    const gateway = createSyntheticPeopleGateway({ state: "large" });
    const onSelectPerson = vi.fn();
    const initialRenderStartedAt = performance.now();
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={onSelectPerson}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    const list = await screen.findByRole("list", { name: "People results" });
    const initialRenderDurationMs = performance.now() - initialRenderStartedAt;
    expect(list).toHaveAttribute("aria-busy", "false");
    expect(initialRenderDurationMs).toBeLessThan(1_500);
    expect(screen.getByText("10,000 people, 100 loaded")).toBeInTheDocument();
    const initialItems = screen.getAllByRole("listitem");
    expect(initialItems.length).toBeGreaterThan(5);
    expect(initialItems.length).toBeLessThanOrEqual(12);
    const firstRow = initialItems[0];
    const firstId = firstRow.getAttribute("data-person-id");
    expect(firstId).toBeTruthy();
    expect(firstRow).toHaveAttribute("data-virtual-key", firstId!);
    expect(firstRow).toHaveAttribute("aria-posinset", "1");
    expect(firstRow).toHaveAttribute("aria-setsize", "10000");

    const scrollSurface = screen.getByTestId("people-virtual-scroll");
    fireEvent.scroll(scrollSurface, { target: { scrollTop: 96 * 90 } });

    await waitFor(() => {
      expect(
        gateway
          .inspect()
          .calls.filter((call) => call.operation === "listPeople").length
      ).toBeGreaterThanOrEqual(2);
    });

    fireEvent.scroll(scrollSurface, { target: { scrollTop: 96 * 110 } });
    await waitFor(() => {
      expect(
        document.querySelector('[role="listitem"][data-index="110"]')
      ).not.toBeNull();
    });
    const activeDescendant = scrollSurface.getAttribute(
      "aria-activedescendant"
    );
    expect(activeDescendant).toBeTruthy();
    expect(document.getElementById(activeDescendant!)).not.toBeNull();

    fireEvent.scroll(scrollSurface, { target: { scrollTop: 0 } });
    await waitFor(() => {
      const restoredFirst = document.querySelector(
        '[role="listitem"][data-index="0"]'
      );
      expect(restoredFirst).toHaveAttribute("data-person-id", firstId);
      expect(restoredFirst).toHaveAttribute("data-virtual-key", firstId);
    });

    fireEvent.keyDown(scrollSurface, { key: "End" });
    fireEvent.keyDown(scrollSurface, { key: "Enter" });
    expect(onSelectPerson).toHaveBeenCalledTimes(1);
    expect(onSelectPerson.mock.calls[0][0]).toMatch(/^person_/);
  });

  it("omits local list sentinels while preserving known connection and freshness states", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 2 });
    const people = buildSyntheticPeople(2);
    people[0] = {
      ...people[0]!,
      shortDescription: null,
      connectionState: "unknown",
      freshnessState: "unavailable",
      freshnessLabel: "Not included in the list response",
      sourceLabel: "Local Person record"
    };
    people[1] = {
      ...people[1]!,
      connectionState: "paired",
      freshnessState: "live",
      freshnessLabel: "Live now"
    };
    gateway.listPeople = vi.fn(async () => ({
      people,
      total: people.length,
      nextCursor: null,
      partial: false,
      connection: {
        availability: "online" as const,
        label: "Live Forge API",
        checkedAt: "2026-07-15T12:00:00.000Z",
        cachedAt: null
      }
    }));

    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("list", { name: "People results" });
    expect(screen.queryByText("Local Person record")).not.toBeInTheDocument();
    expect(screen.queryByText("Status unavailable")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Not included in the list response")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Paired")).toBeInTheDocument();
    expect(screen.getByText("Live now")).toBeInTheDocument();
  });

  it("searches and filters, then recovers from a filtered empty state", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 24 });
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("list", { name: "People results" });
    fireEvent.change(screen.getByLabelText("Search People"), {
      target: { value: "no-such-person" }
    });

    expect(
      await screen.findByText("No one matches this search and these filters.")
    ).toBeInTheDocument();
    await waitFor(() => {
      const listCalls = gateway
        .inspect()
        .calls.filter((call) => call.operation === "listPeople");
      expect(listCalls.at(-1)?.input).toEqual(
        expect.objectContaining({ query: "no-such-person" })
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Clear search and filters" })
    );
    expect(
      await screen.findByRole("list", { name: "People results" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "family" }
    });
    await waitFor(() => {
      const listCalls = gateway
        .inspect()
        .calls.filter((call) => call.operation === "listPeople");
      expect(listCalls.at(-1)?.input).toEqual(
        expect.objectContaining({ relationship: "family" })
      );
    });
    expect(screen.getByLabelText("Filters active")).toBeInTheDocument();
  });

  it("resets a new search to the top and restores the prior result offset", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 48 });
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("list", { name: "People results" });
    const scrollSurface = screen.getByTestId("people-virtual-scroll");
    fireEvent.scroll(scrollSurface, { target: { scrollTop: 96 * 8 } });
    await waitFor(() => {
      expect(
        document.querySelector('[role="listitem"][data-index="8"]')
      ).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText("Search People"), {
      target: { value: "Ari" }
    });
    await waitFor(() => {
      const listCalls = gateway
        .inspect()
        .calls.filter((call) => call.operation === "listPeople");
      expect(listCalls.at(-1)?.input).toEqual(
        expect.objectContaining({ query: "Ari" })
      );
      expect(scrollSurface.scrollTop).toBe(0);
    });

    fireEvent.change(screen.getByLabelText("Search People"), {
      target: { value: "" }
    });
    await waitFor(() => {
      const listCalls = gateway
        .inspect()
        .calls.filter((call) => call.operation === "listPeople");
      expect(listCalls.at(-1)?.input).toEqual(
        expect.objectContaining({ query: "" })
      );
      expect(scrollSurface.scrollTop).toBe(96 * 8);
    });
  });

  it("deduplicates overlapping cursor pages by stable Person id", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 101 });
    const people = buildSyntheticPeople(101);
    const listPeople = vi.fn(async (input: { cursor?: string }) => ({
      people:
        input.cursor === "page_2"
          ? [people[99]!, people[100]!]
          : people.slice(0, 100),
      total: 102,
      nextCursor: input.cursor === "page_2" ? null : "page_2",
      partial: false,
      connection: {
        availability: "online" as const,
        label: "Live Forge API",
        checkedAt: "2026-07-15T12:00:00.000Z",
        cachedAt: null
      }
    }));
    gateway.listPeople = listPeople;
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("list", { name: "People results" });
    fireEvent.scroll(screen.getByTestId("people-virtual-scroll"), {
      target: { scrollTop: 96 * 90 }
    });

    await waitFor(() => expect(listPeople).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("102 people, 101 loaded")
    ).toBeInTheDocument();
  });

  it("preserves scroll offset and selection when a cursor page appends", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 101 });
    const people = buildSyntheticPeople(101);
    let resolveSecondPage!: (page: PeopleCollectionPage) => void;
    const secondPage = new Promise<PeopleCollectionPage>((resolve) => {
      resolveSecondPage = resolve;
    });
    gateway.listPeople = vi.fn((input) =>
      input.cursor
        ? secondPage
        : Promise.resolve({
            people: people.slice(0, 100),
            total: 101,
            nextCursor: "page_2",
            partial: false,
            connection: {
              availability: "online" as const,
              label: "Live Forge API",
              checkedAt: "2026-07-15T12:00:00.000Z",
              cachedAt: null
            }
          })
    );
    const selectedPersonId = people[90]!.id;
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={selectedPersonId}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("list", { name: "People results" });
    const scrollSurface = screen.getByTestId("people-virtual-scroll");
    fireEvent.scroll(scrollSurface, { target: { scrollTop: 96 * 90 } });
    await waitFor(() => expect(gateway.listPeople).toHaveBeenCalledTimes(2));
    const offsetBeforeAppend = scrollSurface.scrollTop;
    resolveSecondPage({
      people: [people[100]!],
      total: 101,
      nextCursor: null,
      partial: false,
      connection: {
        availability: "online",
        label: "Live Forge API",
        checkedAt: "2026-07-15T12:00:00.000Z",
        cachedAt: null
      }
    });

    expect(await screen.findByText("101 people")).toBeInTheDocument();
    expect(scrollSurface.scrollTop).toBe(offsetBeforeAppend);
    expect(
      document.querySelector(`#people-result-${selectedPersonId}`)
    ).toHaveAttribute("aria-current", "page");
  });

  it("stops automatic paging after a failure and resumes only after deliberate retry", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 101 });
    const people = buildSyntheticPeople(101);
    const listPeople = vi
      .fn()
      .mockResolvedValueOnce({
        people: people.slice(0, 100),
        total: 101,
        nextCursor: "page_2",
        partial: false,
        connection: {
          availability: "online" as const,
          label: "Live Forge API",
          checkedAt: "2026-07-15T12:00:00.000Z",
          cachedAt: null
        }
      })
      .mockRejectedValueOnce(new Error("Rate limited"))
      .mockResolvedValueOnce({
        people: [people[100]!],
        total: 101,
        nextCursor: null,
        partial: false,
        connection: {
          availability: "online" as const,
          label: "Live Forge API",
          checkedAt: "2026-07-15T12:01:00.000Z",
          cachedAt: null
        }
      });
    gateway.listPeople = listPeople;

    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("list", { name: "People results" });
    fireEvent.scroll(screen.getByTestId("people-virtual-scroll"), {
      target: { scrollTop: 96 * 90 }
    });

    expect(
      await screen.findByText("We couldn't load more people")
    ).toBeInTheDocument();
    expect(screen.getByText("101 people, 100 loaded")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listPeople).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Retry loading more" }));
    expect(await screen.findByText("101 people")).toBeInTheDocument();
    expect(listPeople).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByText("We couldn't load more people")
    ).not.toBeInTheDocument();
  });

  it("retains a successful collection when refresh fails and marks it stale", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    const people = buildSyntheticPeople(8);
    gateway.listPeople = vi
      .fn()
      .mockResolvedValueOnce({
        people,
        total: 8,
        nextCursor: null,
        partial: false,
        connection: {
          availability: "online" as const,
          label: "Live Forge API",
          checkedAt: "2026-07-15T12:00:00.000Z",
          cachedAt: null
        }
      })
      .mockRejectedValueOnce(new Error("Forge is offline"));
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    expect(
      await screen.findByRole("list", { name: "People results" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh People" }));

    expect(
      await screen.findByText("Showing the people already loaded")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "People results" })
    ).toBeInTheDocument();
    expect(screen.getByText(people[0]!.displayName)).toBeInTheDocument();
  });

  it("announces the initial loading state", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 8, latencyMs: 30 });
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    expect(screen.getByLabelText("Loading people")).toBeInTheDocument();
    expect(
      await screen.findByRole("list", { name: "People results" })
    ).toBeInTheDocument();
  });

  it("shows cached People with an explicit offline state", async () => {
    const gateway = createSyntheticPeopleGateway({
      state: "offline",
      count: 8
    });
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway }
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /offline.*cached local data/i
    );
    expect(
      await screen.findByRole("list", { name: "People results" })
    ).toBeInTheDocument();
  });

  it("renders useful empty and retryable error states", async () => {
    const emptyGateway = createSyntheticPeopleGateway({ state: "empty" });
    const view = renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway: emptyGateway }
    );

    expect(
      await screen.findByText("You haven't added anyone yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add first person" })
    ).toBeInTheDocument();

    view.unmount();
    const errorGateway = createSyntheticPeopleGateway({ state: "error" });
    renderPeopleUi(
      <PeopleCollection
        selectedPersonId={null}
        onSelectPerson={vi.fn()}
        onAddPerson={vi.fn()}
      />,
      { gateway: errorGateway }
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "People could not be loaded"
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
