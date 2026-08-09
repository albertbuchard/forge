import {
  act,
  fireEvent,
  render,
  renderHook,
  screen
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIERARCHY_OPEN_STATE_STORAGE_KEY,
  HierarchyOpenLink,
  HierarchyToggleButton,
  parseHierarchyOpenState,
  serializeHierarchyOpenState,
  useHierarchyOpenStatePersistence,
  type HierarchyOpenState,
  type HierarchyToggleNode
} from "./project-management-hierarchy-page";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("project hierarchy readiness", () => {
  it("accepts only a bounded boolean open-state map and falls back safely", () => {
    expect(parseHierarchyOpenState(null)).toEqual({});
    expect(parseHierarchyOpenState("not-json")).toEqual({});
    expect(parseHierarchyOpenState("[]")).toEqual({});
    expect(
      parseHierarchyOpenState(
        JSON.stringify({
          "goal:one": false,
          "project:two": true,
          ignored: "open"
        })
      )
    ).toEqual({
      "goal:one": false,
      "project:two": true
    });
    expect(
      parseHierarchyOpenState(
        `${JSON.stringify({ "goal:one": false })}${" ".repeat(256_000)}`
      )
    ).toEqual({});

    const oversizedState = Object.fromEntries(
      Array.from({ length: 5_002 }, (_, index) => [`node:${index}`, true])
    ) as HierarchyOpenState;
    expect(
      Object.keys(
        parseHierarchyOpenState(serializeHierarchyOpenState(oversizedState))
      )
    ).toHaveLength(5_000);

    const longIdentifierState = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [
        `node:${index}:${"x".repeat(240)}`,
        index % 2 === 0
      ])
    ) as HierarchyOpenState;
    const serializedLongState =
      serializeHierarchyOpenState(longIdentifierState);
    expect(serializedLongState.length).toBeLessThanOrEqual(256_000);
    expect(parseHierarchyOpenState(serializedLongState)).toEqual(
      JSON.parse(serializedLongState)
    );
  });

  it("keeps hierarchy controls reachable on phone-sized layouts", () => {
    const toggle = vi.fn();
    const node: HierarchyToggleNode = {
      data: { label: "Release checklist" },
      isLeaf: false,
      isOpen: false,
      toggle
    };

    render(
      <MemoryRouter>
        <HierarchyToggleButton node={node} />
        <HierarchyOpenLink
          href="/tasks/task_release"
          label="Release checklist"
          mobile
        />
        <HierarchyOpenLink
          href="/tasks/task_release"
          label="Release checklist"
        />
      </MemoryRouter>
    );

    const toggleButton = screen.getByRole("button", {
      name: "Expand Release checklist"
    });
    expect(toggleButton.className).toContain("size-11");
    fireEvent.click(toggleButton);
    expect(toggle).toHaveBeenCalledTimes(1);

    const openLinks = screen.getAllByRole("link", {
      name: "Open Release checklist"
    });
    expect(openLinks).toHaveLength(2);
    expect(openLinks[0]).toHaveAttribute("href", "/tasks/task_release");
    expect(openLinks[0]?.className).toContain("min-h-11");
    expect(openLinks[0]?.className).toContain("min-w-11");
    expect(openLinks[0]?.className).toContain("lg:hidden");
    expect(openLinks[1]?.className).toContain("hidden lg:inline-flex");
  });

  it("restores, coalesces, and flushes the latest tree state exactly once", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      HIERARCHY_OPEN_STATE_STORAGE_KEY,
      JSON.stringify({ "goal:stored": false })
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const treeRef: {
      current: { openState: HierarchyOpenState } | null;
    } = {
      current: { openState: { "goal:stored": false } }
    };
    const { result, unmount } = renderHook(() =>
      useHierarchyOpenStatePersistence(treeRef)
    );

    expect(result.current.initialOpenState).toEqual({
      "goal:stored": false
    });

    treeRef.current = { openState: { "goal:stored": true } };
    act(() => result.current.scheduleOpenStatePersistence());
    treeRef.current = {
      openState: { "goal:stored": true, "project:latest": false }
    };
    act(() => result.current.scheduleOpenStatePersistence());
    expect(setItem).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(50));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(parseHierarchyOpenState(String(setItem.mock.calls[0]?.[1]))).toEqual(
      { "goal:stored": true, "project:latest": false }
    );

    treeRef.current = { openState: { "goal:stored": false } };
    act(() => result.current.scheduleOpenStatePersistence());
    unmount();
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(parseHierarchyOpenState(String(setItem.mock.calls[1]?.[1]))).toEqual(
      { "goal:stored": false }
    );
    act(() => vi.advanceTimersByTime(100));
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it("keeps the hierarchy usable when browser storage throws", () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage read unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage write unavailable");
    });
    const treeRef = {
      current: { openState: { "goal:available": true } }
    };
    const { result, unmount } = renderHook(() =>
      useHierarchyOpenStatePersistence(treeRef)
    );

    expect(result.current.initialOpenState).toEqual({});
    act(() => result.current.scheduleOpenStatePersistence());
    expect(() => act(() => vi.advanceTimersByTime(50))).not.toThrow();
    unmount();
  });
});
