import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NoteFilterInput,
  type NoteFilterEntityOption
} from "./note-filter-input";

describe("NoteFilterInput", () => {
  afterEach(cleanup);

  it("searches the canonical catalog beyond the shell snapshot and selects a result", async () => {
    const onSelectedEntityValuesChange = vi.fn();
    const onSearchEntityOptions = vi.fn().mockResolvedValue([
      {
        value: "life_event:event_1",
        label: "Flight to Paris",
        entityType: "life_event",
        entityId: "event_1",
        description: "Travel"
      }
    ]);

    render(
      <NoteFilterInput
        entityOptions={[]}
        selectedEntityValues={[]}
        onSelectedEntityValuesChange={onSelectedEntityValuesChange}
        selectedTextTerms={[]}
        onSelectedTextTermsChange={vi.fn()}
        onSearchEntityOptions={onSearchEntityOptions}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("Filter by linked entity or add free text"),
      { target: { value: "Paris" } }
    );

    await waitFor(() =>
      expect(onSearchEntityOptions).toHaveBeenCalledWith("Paris")
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /Flight to Paris/ })
    );
    expect(onSelectedEntityValuesChange).toHaveBeenCalledWith([
      "life_event:event_1"
    ]);
  });

  it("wires stable combobox relationships and supports keyboard selection", () => {
    const onSelectedEntityValuesChange = vi.fn();
    render(
      <NoteFilterInput
        entityOptions={[
          {
            value: "goal:goal_1",
            label: "First goal",
            entityType: "goal",
            entityId: "goal_1"
          },
          {
            value: "project:project_1",
            label: "Second project",
            entityType: "project",
            entityId: "project_1"
          }
        ]}
        selectedEntityValues={[]}
        onSelectedEntityValuesChange={onSelectedEntityValuesChange}
        selectedTextTerms={[]}
        onSelectedTextTermsChange={vi.fn()}
        placeholder="Find a note link"
      />
    );

    const input = screen.getByRole("combobox", { name: "Find a note link" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");

    fireEvent.focus(input);

    const listbox = screen.getByRole("listbox", {
      name: "Find a note link results"
    });
    const options = within(listbox).getAllByRole("option");
    const listboxId = listbox.id;
    expect(listboxId).not.toBe("");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listboxId);
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1]?.id);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");

    fireEvent.focus(input);
    expect(screen.getByRole("listbox").id).toBe(listboxId);
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectedEntityValuesChange).toHaveBeenCalledWith([
      "project:project_1"
    ]);
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("announces remote loading and empty results through the combobox status", async () => {
    let resolveSearch:
      | ((options: NoteFilterEntityOption[]) => void)
      | undefined;
    const onSearchEntityOptions = vi.fn(
      () =>
        new Promise<NoteFilterEntityOption[]>((resolve) => {
          resolveSearch = resolve;
        })
    );
    render(
      <NoteFilterInput
        entityOptions={[]}
        selectedEntityValues={[]}
        onSelectedEntityValuesChange={vi.fn()}
        selectedTextTerms={[]}
        onSelectedTextTermsChange={vi.fn()}
        onSearchEntityOptions={onSearchEntityOptions}
      />
    );

    const input = screen.getByRole("combobox");
    expect(input).not.toHaveAttribute("aria-describedby");
    fireEvent.change(input, { target: { value: "missing" } });

    const loadingStatus = await screen.findByRole("status");
    expect(loadingStatus).toHaveTextContent("Searching linked records");
    expect(input).toHaveAttribute("aria-describedby", loadingStatus.id);
    await waitFor(() =>
      expect(onSearchEntityOptions).toHaveBeenCalledWith("missing")
    );

    await act(async () => {
      resolveSearch?.([]);
      await Promise.resolve();
    });

    const emptyStatus = await screen.findByRole("status");
    expect(emptyStatus).toHaveTextContent("No matching linked records found");
    expect(input).toHaveAttribute("aria-describedby", emptyStatus.id);
  });

  it("keeps free-text filtering available when remote entity search fails", async () => {
    render(
      <NoteFilterInput
        entityOptions={[]}
        selectedEntityValues={[]}
        onSelectedEntityValuesChange={vi.fn()}
        selectedTextTerms={[]}
        onSelectedTextTermsChange={vi.fn()}
        onSearchEntityOptions={vi
          .fn()
          .mockRejectedValue(new Error("Search access denied"))}
      />
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "private" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Search access denied");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(
      screen.getByRole("button", { name: /Add free text/i })
    ).toBeEnabled();
  });
});
