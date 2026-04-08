import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PsycheSelfObservationPage } from "@/pages/psyche-self-observation-page";

const {
  useForgeShellMock,
  navigateMock,
  getPsycheObservationCalendarMock,
  createNoteMock,
  patchNoteMock,
  deleteNoteMock,
  listPsycheValuesMock,
  listBehaviorPatternsMock,
  listBehaviorsMock,
  listBeliefsMock,
  listModesMock,
  listTriggerReportsMock
} = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  navigateMock: vi.fn(),
  getPsycheObservationCalendarMock: vi.fn(),
  createNoteMock: vi.fn(),
  patchNoteMock: vi.fn(),
  deleteNoteMock: vi.fn(),
  listPsycheValuesMock: vi.fn(),
  listBehaviorPatternsMock: vi.fn(),
  listBehaviorsMock: vi.fn(),
  listBeliefsMock: vi.fn(),
  listModesMock: vi.fn(),
  listTriggerReportsMock: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge,
    actions
  }: {
    title: string;
    description: string;
    badge?: string;
    actions?: ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
      {actions}
    </div>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <div>Psyche section nav</div>
}));

vi.mock("@/components/experience/sheet-scaffold", () => ({
  SheetScaffold: ({
    open,
    title,
    children
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) => (open ? <div><div>{title}</div>{children}</div> : null)
}));

vi.mock("@/components/notes/note-tags-input", () => ({
  NoteTagsInput: ({
    value,
    onChange,
    availableTags = []
  }: {
    value: string[];
    onChange: (value: string[]) => void;
    availableTags?: string[];
  }) => (
    <div>
      <div>Tag picker</div>
      {availableTags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() =>
            onChange(
              value.includes(tag)
                ? value.filter((entry) => entry !== tag)
                : [...value, tag]
            )
          }
        >
          {tag}
        </button>
      ))}
      <div>{value.join(",")}</div>
    </div>
  )
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: ({
    options,
    selectedValues,
    onChange
  }: {
    options: Array<{ value: string; label: string }>;
    selectedValues: string[];
    onChange: (value: string[]) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() =>
            onChange(
              selectedValues.includes(option.value)
                ? selectedValues.filter((entry) => entry !== option.value)
                : [...selectedValues, option.value]
            )
          }
        >
          {option.label}
        </button>
      ))}
      <div>{selectedValues.join(",")}</div>
    </div>
  )
}));

vi.mock("@/lib/api", () => ({
  getPsycheObservationCalendar: getPsycheObservationCalendarMock,
  createNote: createNoteMock,
  patchNote: patchNoteMock,
  deleteNote: deleteNoteMock,
  listPsycheValues: listPsycheValuesMock,
  listBehaviorPatterns: listBehaviorPatternsMock,
  listBehaviors: listBehaviorsMock,
  listBeliefs: listBeliefsMock,
  listModes: listModesMock,
  listTriggerReports: listTriggerReportsMock
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/psyche/self-observation"]}>
        <PsycheSelfObservationPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function createObservation(args: {
  id: string;
  contentMarkdown: string;
  contentPlain: string;
  observedAt: string;
  author: string;
  tags: string[];
  userKind: "human" | "bot";
  links?: Array<{ entityType: string; entityId: string; anchorKey: null }>;
}) {
  return {
    id: args.id,
    observedAt: args.observedAt,
    note: {
      id: args.id,
      kind: "evidence",
      title: "",
      slug: args.id,
      spaceId: "wiki_space_main",
      parentSlug: null,
      indexOrder: 0,
      showInIndex: false,
      aliases: [],
      summary: "",
      contentMarkdown: args.contentMarkdown,
      contentPlain: args.contentPlain,
      author: args.author,
      source: "ui",
      sourcePath: "",
      frontmatter: { observedAt: args.observedAt },
      revisionHash: "",
      lastSyncedAt: null,
      createdAt: args.observedAt,
      updatedAt: args.observedAt,
      links: args.links ?? [],
      tags: args.tags,
      destroyAt: null,
      userId: args.userKind === "human" ? "user_operator" : "user_forge_bot",
      user: {
        id: args.userKind === "human" ? "user_operator" : "user_forge_bot",
        kind: args.userKind,
        handle: args.userKind === "human" ? "albert" : "forge-bot",
        displayName: args.userKind === "human" ? "Albert" : "Forge Bot",
        description: "",
        accentColor: "#ffffff",
        createdAt: args.observedAt,
        updatedAt: args.observedAt
      }
    },
    linkedPatterns: [],
    linkedReports: []
  };
}

describe("PsycheSelfObservationPage", () => {
  let observations: ReturnType<typeof createObservation>[];

  beforeEach(() => {
    observations = [
      createObservation({
        id: "note_human",
        contentMarkdown: "Notice the tension before the meeting.",
        contentPlain: "Notice the tension before the meeting.",
        observedAt: "2026-04-06T09:15:00.000Z",
        author: "Albert",
        tags: ["Self-observation", "focus"],
        userKind: "human",
        links: [
          {
            entityType: "goal",
            entityId: "goal_1",
            anchorKey: null
          }
        ]
      }),
      createObservation({
        id: "note_bot",
        contentMarkdown: "Automated system note.",
        contentPlain: "Automated system note.",
        observedAt: "2026-04-06T10:30:00.000Z",
        author: "Forge",
        tags: ["ops"],
        userKind: "bot"
      })
    ];

    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: {
        users: [
          {
            id: "user_operator",
            kind: "human",
            handle: "albert",
            displayName: "Albert",
            description: "",
            accentColor: "#ffffff",
            createdAt: "2026-04-06T08:00:00.000Z",
            updatedAt: "2026-04-06T08:00:00.000Z"
          },
          {
            id: "user_forge_bot",
            kind: "bot",
            handle: "forge-bot",
            displayName: "Forge Bot",
            description: "",
            accentColor: "#ffffff",
            createdAt: "2026-04-06T08:00:00.000Z",
            updatedAt: "2026-04-06T08:00:00.000Z"
          }
        ],
        goals: [
          {
            id: "goal_1",
            title: "Calm nervous system",
            description: "Stay regulated before difficult conversations.",
            user: {
              id: "user_operator",
              kind: "human",
              handle: "albert",
              displayName: "Albert",
              description: "",
              accentColor: "#ffffff",
              createdAt: "2026-04-06T08:00:00.000Z",
              updatedAt: "2026-04-06T08:00:00.000Z"
            }
          }
        ],
        tasks: [],
        strategies: [],
        habits: [],
        tags: [],
        dashboard: {
          projects: []
        }
      }
    });

    getPsycheObservationCalendarMock.mockImplementation(async () => ({
      calendar: {
        generatedAt: "2026-04-06T08:00:00.000Z",
        from: "2026-04-06T00:00:00.000Z",
        to: "2026-04-13T00:00:00.000Z",
        observations,
        availableTags: ["Self-observation", "focus", "ops"]
      }
    }));

    listPsycheValuesMock.mockResolvedValue({ values: [] });
    listBehaviorPatternsMock.mockResolvedValue({
      patterns: [
        {
          id: "pattern_1",
          domainId: "psyche",
          title: "Withdrawal loop",
          description: "",
          targetBehavior: "Pull back",
          cueContexts: [],
          shortTermPayoff: "",
          longTermCost: "",
          preferredResponse: "",
          linkedValueIds: [],
          linkedSchemaLabels: [],
          linkedModeLabels: [],
          linkedModeIds: [],
          linkedBeliefIds: [],
          createdAt: "2026-04-06T08:00:00.000Z",
          updatedAt: "2026-04-06T08:00:00.000Z",
          userId: "user_operator",
          user: {
            id: "user_operator",
            kind: "human",
            handle: "albert",
            displayName: "Albert",
            description: "",
            accentColor: "#ffffff",
            createdAt: "2026-04-06T08:00:00.000Z",
            updatedAt: "2026-04-06T08:00:00.000Z"
          }
        }
      ]
    });
    listBehaviorsMock.mockResolvedValue({ behaviors: [] });
    listBeliefsMock.mockResolvedValue({ beliefs: [] });
    listModesMock.mockResolvedValue({ modes: [] });
    listTriggerReportsMock.mockResolvedValue({
      reports: [
        {
          id: "report_1",
          domainId: "psyche",
          title: "Meeting spiral",
          status: "draft",
          eventTypeId: null,
          customEventType: "",
          eventSituation: "",
          occurredAt: "2026-04-06T09:00:00.000Z",
          emotions: [],
          thoughts: [],
          behaviors: [],
          consequences: {
            selfShortTerm: [],
            selfLongTerm: [],
            othersShortTerm: [],
            othersLongTerm: []
          },
          linkedPatternIds: [],
          linkedValueIds: [],
          linkedGoalIds: [],
          linkedProjectIds: [],
          linkedTaskIds: [],
          linkedBehaviorIds: [],
          linkedBeliefIds: [],
          linkedModeIds: [],
          modeOverlays: [],
          schemaLinks: [],
          modeTimeline: [],
          nextMoves: [],
          createdAt: "2026-04-06T08:00:00.000Z",
          updatedAt: "2026-04-06T08:00:00.000Z",
          userId: "user_operator",
          user: {
            id: "user_operator",
            kind: "human",
            handle: "albert",
            displayName: "Albert",
            description: "",
            accentColor: "#ffffff",
            createdAt: "2026-04-06T08:00:00.000Z",
            updatedAt: "2026-04-06T08:00:00.000Z"
          }
        }
      ]
    });

    createNoteMock.mockImplementation(async (input: Record<string, unknown>) => {
      const observedAt = ((input.frontmatter as Record<string, string>).observedAt ??
        "2026-04-06T11:00:00.000Z") as string;
      observations = [
        ...observations,
        createObservation({
          id: "note_created",
          contentMarkdown: String(input.contentMarkdown),
          contentPlain: String(input.contentMarkdown),
          observedAt,
          author: String(input.author ?? ""),
          tags: (input.tags as string[]) ?? [],
          userKind: "human",
          links: ((input.links as Array<{ entityType: string; entityId: string; anchorKey: null }>) ?? [])
        })
      ];
      return { note: observations[observations.length - 1]!.note };
    });

    patchNoteMock.mockImplementation(async (noteId: string, patch: Record<string, unknown>) => {
      observations = observations.map((entry) =>
        entry.note.id === noteId
          ? createObservation({
              id: entry.id,
              contentMarkdown: String(
                patch.contentMarkdown ?? entry.note.contentMarkdown
              ),
              contentPlain: String(
                patch.contentMarkdown ?? entry.note.contentPlain
              ),
              observedAt: String(
                ((patch.frontmatter as Record<string, string> | undefined)?.observedAt ??
                  entry.observedAt) as string
              ),
              author: String(patch.author ?? entry.note.author ?? ""),
              tags: (patch.tags as string[]) ?? entry.note.tags ?? [],
              userKind:
                ((patch.userId as string | undefined) ?? entry.note.userId) ===
                "user_forge_bot"
                  ? "bot"
                  : "human",
              links:
                ((patch.links as Array<{ entityType: string; entityId: string; anchorKey: null }>) ??
                  entry.note.links) as Array<{
                  entityType: string;
                  entityId: string;
                  anchorKey: null;
                }>
            })
          : entry
      );
      return {
        note: observations.find((entry) => entry.note.id === noteId)!.note
      };
    });

    deleteNoteMock.mockResolvedValue({ note: observations[0]!.note });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("seeds the Self-observation tag filter by default and can clear it to reveal all notes", async () => {
    renderPage();

    expect(
      (await screen.findAllByText("Notice the tension before the meeting.")).length
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText("Automated system note.")).toHaveLength(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Self-observation" })[0]!);

    await waitFor(() =>
      expect(screen.getAllByText("Automated system note.").length).toBeGreaterThan(0)
    );
  });

  it("creates a new observation with the default self-observation tag and linked records", async () => {
    renderPage();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add observation" }))[0]!
    );

    expect(screen.getAllByText("Self-observation").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Author"), {
      target: { value: "Albert" }
    });
    fireEvent.change(screen.getByLabelText("Observation note"), {
      target: { value: "Wrote down the pressure before sending the message." }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "focus" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Withdrawal loop" }));
    fireEvent.click(screen.getByRole("button", { name: "Meeting spiral" }));
    fireEvent.click(screen.getByRole("button", { name: "Calm nervous system" }));
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));

    await waitFor(() =>
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contentMarkdown: "Wrote down the pressure before sending the message.",
          author: "Albert",
          userId: "user_operator",
          tags: expect.arrayContaining(["Self-observation", "focus"]),
          links: expect.arrayContaining([
            expect.objectContaining({
              entityType: "goal",
              entityId: "goal_1"
            }),
            expect.objectContaining({
              entityType: "behavior_pattern",
              entityId: "pattern_1"
            }),
            expect.objectContaining({
              entityType: "trigger_report",
              entityId: "report_1"
            })
          ])
        })
      )
    );

    await waitFor(() =>
      expect(
        screen.queryAllByText("Wrote down the pressure before sending the message.")
          .length
      ).toBeGreaterThan(0)
    );
  }, 10000);

  it("opens an existing observation in edit mode and lets it be deleted", async () => {
    renderPage();

    fireEvent.click(
      (await screen.findAllByText("Notice the tension before the meeting."))[0]!
    );

    expect(await screen.findByText("Edit observation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete observation" }));

    await waitFor(() =>
      expect(deleteNoteMock).toHaveBeenCalledWith("note_human")
    );
  });

  it("saves before opening the pattern flow from an observation", async () => {
    renderPage();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add observation" }))[0]!
    );

    fireEvent.change(screen.getByLabelText("Observation note"), {
      target: { value: "A fresh observation that should seed a pattern." }
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create pattern from observation" })
    );

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        "/psyche/patterns?create=1&sourceObservationNoteId=note_created&userId=user_operator"
      )
    );
  });

  it("moves an observation to a new hour slot with drag and drop", async () => {
    const view = renderPage();

    const card = (await screen.findAllByText("Notice the tension before the meeting."))[0]!;
    const targetSlot =
      view.container.querySelectorAll<HTMLElement>("[data-self-observation-slot]")[0]!;
    const dataTransfer = {
      payload: {} as Record<string, string>,
      setData(key: string, value: string) {
        this.payload[key] = value;
      },
      getData(key: string) {
        return this.payload[key] ?? "";
      }
    };

    fireEvent.dragStart(card.closest("[data-self-observation-card]")!, {
      dataTransfer
    });
    fireEvent.drop(targetSlot, { dataTransfer });

    await waitFor(() =>
      expect(patchNoteMock).toHaveBeenCalledWith(
        "note_human",
        expect.objectContaining({
          frontmatter: expect.objectContaining({
            observedAt: expect.any(String)
          })
        })
      )
    );
  });
});
