import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";

const OPTIONS: EntityLinkOption[] = Array.from({ length: 12 }, (_, index) => ({
  value: `option_${index + 1}`,
  label: `Forge option ${index + 1}`,
  description: `Description ${index + 1}`,
  searchText: `forge option ${index + 1}`
}));

describe("EntityLinkMultiSelect", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders its dropdown in a viewport layer instead of inside overflow-hidden parents", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );

    render(
      <div data-testid="clip-shell" className="overflow-hidden rounded-[24px]">
        <EntityLinkMultiSelect
          options={OPTIONS}
          selectedValues={[]}
          onChange={() => undefined}
          placeholder="Filter by goal, project, or tag"
        />
      </div>
    );

    fireEvent.focus(
      screen.getByPlaceholderText("Filter by goal, project, or tag")
    );
    fireEvent.change(
      screen.getByPlaceholderText("Filter by goal, project, or tag"),
      {
        target: { value: "Forge" }
      }
    );

    const clipShell = screen.getByTestId("clip-shell");
    const listbox = screen.getByRole("listbox");
    expect(within(clipShell).queryByRole("listbox")).toBeNull();
    expect(listbox).toBeInTheDocument();
    expect(listbox.parentElement).toHaveClass(
      "pointer-events-auto",
      "overflow-y-auto"
    );
    expect(listbox.parentElement?.style.position).toBe("fixed");
  });

  it("wires stable combobox relationships and supports keyboard navigation", () => {
    const onParentKeyDown = vi.fn();

    function Example() {
      const [selectedValues, setSelectedValues] = useState<string[]>([]);

      return (
        <div onKeyDown={onParentKeyDown}>
          <EntityLinkMultiSelect
            options={OPTIONS}
            selectedValues={selectedValues}
            onChange={setSelectedValues}
            placeholder="Keyboard entity search"
          />
        </div>
      );
    }

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );

    render(<Example />);

    const input = screen.getByRole("combobox", {
      name: "Keyboard entity search"
    });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");

    fireEvent.focus(input);

    const listbox = screen.getByRole("listbox", {
      name: "Keyboard entity search results"
    });
    const options = within(listbox).getAllByRole("option");
    const listboxId = listbox.id;
    expect(listboxId).not.toBe("");
    expect(input).toHaveAttribute("aria-controls", listboxId);
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1]?.id);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onParentKeyDown).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "Escape" })
    );

    fireEvent.focus(input);
    expect(screen.getByRole("listbox").id).toBe(listboxId);
    fireEvent.keyDown(input, { key: "Home" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Forge option 2")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("selects exactly once after a real pointer sequence and keeps the multiselect open", () => {
    function Example() {
      const [selectedValues, setSelectedValues] = useState<string[]>([]);

      return (
        <EntityLinkMultiSelect
          options={OPTIONS}
          selectedValues={selectedValues}
          onChange={setSelectedValues}
          placeholder="Search options"
        />
      );
    }

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );

    render(<Example />);

    const input = screen.getByPlaceholderText("Search options");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "option 11" } });
    const option = screen.getByRole("option", { name: /forge option 11/i });
    fireEvent.pointerDown(option);
    expect(
      screen.queryByRole("button", { name: "Remove Forge option 11" })
    ).toBeNull();
    fireEvent.click(option);

    expect(
      screen.getByRole("button", { name: "Remove Forge option 11" })
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("exposes a scrollable result set and scrolls the active keyboard option into view", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );

    render(
      <EntityLinkMultiSelect
        options={OPTIONS}
        selectedValues={[]}
        onChange={() => undefined}
        placeholder="Scrollable entity search"
      />
    );

    const input = screen.getByRole("combobox", {
      name: "Scrollable entity search"
    });
    fireEvent.focus(input);

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(OPTIONS.length);

    scrollIntoView.mockClear();
    fireEvent.keyDown(input, { key: "End" });

    expect(input).toHaveAttribute(
      "aria-activedescendant",
      options[OPTIONS.length - 1]?.id
    );
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })
    );
  });

  it("searches remote Forge entities and merges the results", async () => {
    const onSearch = vi.fn().mockResolvedValue([
      {
        value: "artifact:artifact_1",
        label: "Breakfast brief",
        description: "Artifact"
      }
    ] satisfies EntityLinkOption[]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );
    render(
      <EntityLinkMultiSelect
        options={[]}
        selectedValues={[]}
        onChange={() => undefined}
        onSearch={onSearch}
        placeholder="Search every entity"
      />
    );
    const input = screen.getByPlaceholderText("Search every entity");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "breakfast" } });
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("breakfast"));
    expect(
      await screen.findByRole("option", { name: /breakfast brief/i })
    ).toBeInTheDocument();
  });

  it("announces remote loading and empty results through the combobox status", async () => {
    let resolveSearch: ((options: EntityLinkOption[]) => void) | undefined;
    const onSearch = vi.fn(
      () =>
        new Promise<EntityLinkOption[]>((resolve) => {
          resolveSearch = resolve;
        })
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );
    render(
      <EntityLinkMultiSelect
        options={[]}
        selectedValues={[]}
        onChange={() => undefined}
        onSearch={onSearch}
        placeholder="Remote entity search"
        emptyMessage="No remote entities found."
      />
    );

    const input = screen.getByRole("combobox", {
      name: "Remote entity search"
    });
    expect(input).not.toHaveAttribute("aria-describedby");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "missing" } });

    const loadingStatus = await screen.findByRole("status");
    expect(loadingStatus).toHaveTextContent("Searching Forge records");
    expect(input).toHaveAttribute("aria-describedby", loadingStatus.id);
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("missing"));

    await act(async () => {
      resolveSearch?.([]);
      await Promise.resolve();
    });

    const emptyStatus = await screen.findByRole("status");
    expect(emptyStatus).toHaveTextContent("No remote entities found.");
    expect(input).toHaveAttribute("aria-describedby", emptyStatus.id);
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  });

  it("announces remote search errors without also announcing an empty result", async () => {
    const onSearch = vi
      .fn()
      .mockRejectedValue(new Error("Entity search failed"));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );
    render(
      <EntityLinkMultiSelect
        options={[]}
        selectedValues={[]}
        onChange={() => undefined}
        onSearch={onSearch}
        placeholder="Failing entity search"
        emptyMessage="No entities available."
      />
    );

    const input = screen.getByRole("combobox", {
      name: "Failing entity search"
    });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "broken" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Entity search failed");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(
      screen.queryByText("No entities available.")
    ).not.toBeInTheDocument();
  });
});
