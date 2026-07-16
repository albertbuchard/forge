import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNoteEditorDraft,
  NoteEditorFlowDialog,
  resolveNoteDraftLinks
} from "./note-editor-flow-dialog";

const entityLinkMultiSelectPropsMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: (props: {
    onSearch?: (query: string) => Promise<unknown>;
  }) => {
    entityLinkMultiSelectPropsMock(props);
    return <div>Linked records</div>;
  }
}));

vi.mock("@/components/notes/note-tags-input", () => ({
  NoteTagsInput: () => <div>Tags</div>
}));

vi.mock("@/components/notes/note-markdown", () => ({
  NoteMarkdown: ({ markdown }: { markdown: string }) => <div>{markdown}</div>
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  entityLinkMultiSelectPropsMock.mockClear();
});

function renderEditor(
  onSubmit: (draft: ReturnType<typeof buildNoteEditorDraft>) => Promise<void>,
  note: Parameters<typeof buildNoteEditorDraft>[0] = null
) {
  return render(
    <NoteEditorFlowDialog
      open
      note={note}
      entityOptions={[]}
      draftScopeKey="test-scope"
      onOpenChange={() => undefined}
      onSubmit={onSubmit}
    />
  );
}

function continueToReview() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("NoteEditorFlowDialog", () => {
  it("preserves every anchor when a note links to the same record more than once", () => {
    const draft = buildNoteEditorDraft({
      id: "note_1",
      title: "Anchored note",
      contentMarkdown: "Anchor evidence",
      links: [
        {
          entityType: "trigger_report",
          entityId: "report_1",
          anchorKey: "spark"
        },
        {
          entityType: "trigger_report",
          entityId: "report_1",
          anchorKey: "pivot"
        }
      ]
    });

    expect(resolveNoteDraftLinks(draft)).toEqual([
      {
        entityType: "trigger_report",
        entityId: "report_1",
        anchorKey: "spark"
      },
      { entityType: "trigger_report", entityId: "report_1", anchorKey: "pivot" }
    ]);
  });

  it("recovers a locally persisted draft and clears it after a successful save", async () => {
    const firstSubmit = vi.fn().mockResolvedValue(undefined);
    const firstRender = renderEditor(firstSubmit);

    fireEvent.change(
      screen.getByPlaceholderText(
        "Write what happened, what it means, or what should be remembered."
      ),
      {
        target: { value: "Recovered durable note" }
      }
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      window.localStorage.getItem(
        "forge.question-flow-draft.notes.test-scope.new"
      )
    ).toContain("Recovered durable note");
    firstRender.unmount();

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEditor(onSubmit);
    expect(
      await screen.findByDisplayValue("Recovered durable note")
    ).toBeInTheDocument();

    continueToReview();
    fireEvent.click(screen.getByRole("button", { name: "Create note" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(
      window.localStorage.getItem(
        "forge.question-flow-draft.notes.test-scope.new"
      )
    ).toBeNull();
  });

  it("keeps the editor and draft available when a revision conflict rejects save", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error("This note changed in another editor."));
    renderEditor(onSubmit, {
      id: "note_conflict",
      title: "Conflict note",
      contentMarkdown: "Original revision",
      revisionHash: "revision-1",
      links: []
    });

    continueToReview();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This note changed in another editor."
    );
    expect(onSubmit.mock.calls[0]?.[0].baseRevisionHash).toBe("revision-1");
    expect(screen.getByTestId("question-flow-dialog")).toBeInTheDocument();
  });

  it("contains a long unbroken title in the review card", () => {
    const longTitle = "ReviewTitleWithoutBreaks".repeat(40);
    renderEditor(vi.fn().mockResolvedValue(undefined));

    fireEvent.change(screen.getByPlaceholderText("Research handoff"), {
      target: { value: longTitle }
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Write what happened, what it means, or what should be remembered."
      ),
      { target: { value: "Review body" } }
    );
    continueToReview();

    const reviewTitle = screen.getByText(longTitle);
    expect(reviewTitle).toHaveClass(
      "min-w-0",
      "max-w-full",
      "break-words",
      "whitespace-normal",
      "[overflow-wrap:anywhere]"
    );
    expect(reviewTitle.parentElement).toHaveClass(
      "min-w-0",
      "max-w-full",
      "overflow-hidden"
    );
  });

  it("passes remote entity search through the guided context step", () => {
    const onSearchEntityOptions = vi.fn().mockResolvedValue([]);
    render(
      <NoteEditorFlowDialog
        open
        note={null}
        entityOptions={[]}
        onSearchEntityOptions={onSearchEntityOptions}
        onOpenChange={() => undefined}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Write what happened, what it means, or what should be remembered."
      ),
      { target: { value: "Searchable note" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(entityLinkMultiSelectPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ onSearch: onSearchEntityOptions })
    );
  });
});
