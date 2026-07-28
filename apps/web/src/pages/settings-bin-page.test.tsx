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

function makeRecord(index: number): DeletedEntityRecord {
  return {
    entityType: "task",
    entityId: `task_${index}`,
    title: `Deleted task ${index}`,
    subtitle: null,
    deletedAt: "2026-07-11T09:00:00.000Z",
    deletedByActor: "operator",
    deletedSource: "ui",
    deleteReason: "No longer needed",
    snapshot: {}
  };
}

function renderPage(records: DeletedEntityRecord[]) {
  getSettingsBinMock.mockResolvedValue({
    bin: {
      generatedAt: "2026-07-11T10:00:00.000Z",
      totalCount: records.length,
      countsByEntityType: { task: records.length },
      records
    }
  });
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
  }, 15_000);

  it("requires confirmation before permanently deleting one record", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderPage([makeRecord(1)]);

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
    expect(confirm).toHaveBeenLastCalledWith(
      'Permanently delete "Deleted task 1"? This removes the task record and cannot be undone.'
    );
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
