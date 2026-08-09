import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsBinPage } from "@/pages/settings-bin-page";
import type { DeletedEntityRecord } from "@/lib/types";

const {
  deleteEntitiesMock,
  ensureOperatorSessionMock,
  getSettingsBinMock,
  restoreEntitiesMock
} = vi.hoisted(() => ({
  deleteEntitiesMock: vi.fn(),
  ensureOperatorSessionMock: vi.fn(),
  getSettingsBinMock: vi.fn(),
  restoreEntitiesMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  deleteEntities: (...args: unknown[]) => deleteEntitiesMock(...args),
  ensureOperatorSession: (...args: unknown[]) =>
    ensureOperatorSessionMock(...args),
  getSettingsBin: (...args: unknown[]) => getSettingsBinMock(...args),
  restoreEntities: (...args: unknown[]) => restoreEntitiesMock(...args)
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title, badge }: { title: string; badge: string }) => (
    <div>
      <h1>{title}</h1>
      <span>{badge}</span>
    </div>
  )
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>,
  SettingsStateFrame: ({
    children
  }: {
    children: import("react").ReactNode;
  }) => (
    <>
      <div>Settings nav</div>
      {children}
    </>
  )
}));

function makeRecord(
  index: number,
  entityType: DeletedEntityRecord["entityType"] = "task"
): DeletedEntityRecord {
  return {
    entityType,
    entityId: `${entityType}_${index}`,
    title: `Deleted ${entityType.replaceAll("_", " ")} ${index}`,
    subtitle: null,
    deletedAt: "2026-07-11T09:00:00.000Z",
    deletedByActor: "operator",
    deletedSource: "ui",
    deleteReason: "No longer needed",
    snapshot: {}
  };
}

function binPayload(records: DeletedEntityRecord[]) {
  return {
    bin: {
      generatedAt: "2026-07-11T10:00:00.000Z",
      totalCount: records.length,
      countsByEntityType: { task: records.length },
      records
    }
  };
}

function renderPage(
  records: DeletedEntityRecord[],
  recordsAfterMutation?: DeletedEntityRecord[]
) {
  if (recordsAfterMutation) {
    getSettingsBinMock
      .mockResolvedValueOnce(binPayload(records))
      .mockResolvedValue(binPayload(recordsAfterMutation));
  } else {
    getSettingsBinMock.mockResolvedValue(binPayload(records));
  }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsBinPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsBinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureOperatorSessionMock.mockResolvedValue({
      session: { actorLabel: "Operator", profile: "operator" }
    });
    deleteEntitiesMock.mockResolvedValue({ results: [] });
    restoreEntitiesMock.mockResolvedValue({ results: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the local-owner boundary without requesting deleted records for a paired browser", async () => {
    ensureOperatorSessionMock.mockResolvedValueOnce({
      session: {
        actorLabel: "Paired Browser",
        profile: "trusted_personal_assistant"
      }
    });

    renderPage([makeRecord(1)]);

    expect(
      await screen.findByText("Permanent deletion stays on the Forge host")
    ).toBeInTheDocument();
    expect(getSettingsBinMock).not.toHaveBeenCalled();
  });

  it("bounds the rendered records and destructive batch size", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage(Array.from({ length: 45 }, (_, index) => makeRecord(index + 1)));

    expect(
      await screen.findByText("40 shown of 45 matching")
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Delete forever" })
    ).toHaveLength(40);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete shown forever" })
    );
    await waitFor(() => {
      const request = deleteEntitiesMock.mock.calls[0]?.[0] as {
        operations: unknown[];
      };
      expect(request.operations).toHaveLength(40);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));

    expect(screen.getByText("45 shown of 45 matching")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Delete forever" })
    ).toHaveLength(45);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete first 40 shown forever"
      })
    );
    await waitFor(() => {
      const request = deleteEntitiesMock.mock.calls[1]?.[0] as {
        operations: unknown[];
      };
      expect(request.operations).toHaveLength(40);
    });
    expect(window.confirm).toHaveBeenLastCalledWith(
      "Permanently delete the first 40 of 45 shown items from the bin? This cannot be undone."
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Restore first 40 shown"
      })
    );
    await waitFor(() => {
      const request = restoreEntitiesMock.mock.calls[0]?.[0] as {
        operations: unknown[];
      };
      expect(request.operations).toHaveLength(40);
    });
  }, 15_000);

  it("requires confirmation before permanently deleting one record", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderPage([makeRecord(1)], []);

    const deleteButton = await screen.findByRole("button", {
      name: "Delete forever"
    });
    fireEvent.click(deleteButton);
    expect(deleteEntitiesMock).not.toHaveBeenCalled();

    fireEvent.click(deleteButton);
    await waitFor(() => {
      expect(deleteEntitiesMock).toHaveBeenCalledWith({
        operations: [{ entityType: "task", id: "task_1", mode: "hard" }]
      });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("status", { name: "" })
      );
    });
    expect(confirm).toHaveBeenLastCalledWith(
      'Permanently delete "Deleted task 1"? This removes the task record and cannot be undone.'
    );
    expect(deleteButton).toHaveClass("min-h-11");
  });

  it("exposes the active type filter and restores the exact selected record", async () => {
    renderPage([makeRecord(1)]);

    const taskFilter = await screen.findByRole("button", { name: "Tasks" });
    expect(taskFilter).toHaveAttribute("aria-pressed", "false");
    expect(taskFilter).toHaveClass("min-h-11");

    fireEvent.click(taskFilter);
    expect(taskFilter).toHaveAttribute("aria-pressed", "true");

    const restoreButton = screen.getByRole("button", { name: "Restore" });
    expect(restoreButton).toHaveClass("min-h-11");
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(restoreEntitiesMock).toHaveBeenCalledWith({
        operations: [{ entityType: "task", id: "task_1" }]
      });
    });
  });

  it("reveals the remaining records after restoring the last item in an active filter", async () => {
    const task = makeRecord(1);
    const note = makeRecord(2, "note");
    renderPage([task, note], [note]);

    const taskFilter = await screen.findByRole("button", { name: "Tasks" });
    fireEvent.click(taskFilter);
    expect(screen.getByText("Deleted task 1")).toBeInTheDocument();
    expect(screen.queryByText("Deleted note 2")).not.toBeInTheDocument();

    const restoreButton = screen.getByRole("button", { name: "Restore" });
    restoreButton.focus();
    fireEvent.click(restoreButton);

    expect(await screen.findByText("Deleted note 2")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tasks" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("status", { name: "" })
      );
    });
  });

  it("keeps a failed permanent deletion visible and recoverable", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteEntitiesMock.mockRejectedValueOnce(new Error("Bin write failed"));
    renderPage([makeRecord(1)]);

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete forever" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bin write failed"
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
