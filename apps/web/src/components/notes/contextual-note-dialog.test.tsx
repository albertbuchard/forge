import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextualNoteDialog } from "./contextual-note-dialog";

const { createNoteMock, editorPropsMock } = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
  editorPropsMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({ createNote: createNoteMock }));

vi.mock("./note-editor-flow-dialog", () => ({
  resolveNoteDraftDestroyAt: () => null,
  resolveNoteDraftFrontmatter: () => ({}),
  resolveNoteDraftLinks: (draft: {
    linkedValues: string[];
    linkAnchors: Record<string, Array<string | null>>;
  }) =>
    draft.linkedValues.map((value) => {
      const [entityType, entityId] = value.split(":", 2);
      return {
        entityType,
        entityId,
        anchorKey: draft.linkAnchors[value]?.[0] ?? null
      };
    }),
  NoteEditorFlowDialog: (props: {
    open: boolean;
    lockedLinks: Array<{
      entityType: string;
      entityId: string;
      anchorKey: string | null;
    }>;
    onOpenChange: (open: boolean) => void;
    onSubmit: (draft: unknown) => Promise<void>;
  }) => {
    editorPropsMock(props);
    if (!props.open) {
      return null;
    }
    const source = props.lockedLinks[0]!;
    const sourceValue = `${source.entityType}:${source.entityId}`;
    return (
      <div>
        <span>{sourceValue}</span>
        <button
          type="button"
          onClick={async () => {
            await props.onSubmit({
              title: "Context evidence",
              contentMarkdown: "A bounded related note.",
              author: "Albert",
              tags: ["related"],
              linkedValues: [sourceValue],
              linkAnchors: { [sourceValue]: [source.anchorKey] }
            });
            props.onOpenChange(false);
          }}
        >
          Submit contextual note
        </button>
      </div>
    );
  }
}));

function renderDialog(returnFocusTarget: HTMLElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <ContextualNoteDialog
        open
        source={{
          version: 1,
          entityType: "habit",
          entityId: "habit_walk",
          anchorKey: null,
          label: "Evening walk"
        }}
        defaultUserId="user_operator"
        returnState={{
          scrollX: 12,
          scrollY: 340,
          focusTarget: returnFocusTarget
        }}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe("ContextualNoteDialog", () => {
  beforeEach(() => {
    createNoteMock.mockReset();
    editorPropsMock.mockReset();
    createNoteMock.mockResolvedValue({ note: { id: "note_created" } });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  it("submits one versioned locked source and restores scroll and focus", async () => {
    const returnFocusTarget = document.createElement("button");
    returnFocusTarget.textContent = "Create";
    document.body.appendChild(returnFocusTarget);
    const focusSpy = vi.spyOn(returnFocusTarget, "focus");
    renderDialog(returnFocusTarget);

    fireEvent.click(
      screen.getByRole("button", { name: "Submit contextual note" })
    );

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1));
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_operator",
        links: [
          {
            entityType: "habit",
            entityId: "habit_walk",
            anchorKey: null
          }
        ],
        createContext: {
          version: 1,
          sourceEntityType: "habit",
          sourceEntityId: "habit_walk",
          anchorKey: null
        }
      })
    );
    expect(window.scrollTo).toHaveBeenCalledWith(12, 340);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(
      await screen.findByText("Note created and linked to Evening walk.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss note confirmation" })
    ).toHaveClass("size-11");

    returnFocusTarget.remove();
  });
});
