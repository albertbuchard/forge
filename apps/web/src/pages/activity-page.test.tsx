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
import { ActivityPage } from "@/pages/activity-page";
import type { ActivityEvent } from "@/lib/types";

const { listActivityMock, removeActivityLogMock } = vi.hoisted(() => ({
  listActivityMock: vi.fn(),
  removeActivityLogMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  listActivity: (...args: unknown[]) => listActivityMock(...args),
  removeActivityLog: (...args: unknown[]) => removeActivityLogMock(...args)
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({ selectedUserIds: ["user_activity"] })
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge
  }: {
    title: string;
    description: string;
    badge?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {badge ? <span>{badge}</span> : null}
    </header>
  )
}));

function activityEvent(): ActivityEvent {
  return {
    id: "activity_ready_1",
    entityType: "task",
    entityId: "task_ready_1",
    eventType: "task_checked",
    title: "Rotated api_key=raw-activity-secret",
    description: "Authorization: Bearer raw.activity.secret",
    actor: "Activity agent",
    source: "agent",
    metadata: {},
    createdAt: "2026-08-08T10:00:00.000Z",
    userId: "user_activity",
    user: null
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          "/activity?source=agent&entityType=task&from=2026-08-08&through=2026-08-08&includeCorrected=true"
        ]}
      >
        <ActivityPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ActivityPage readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listActivityMock.mockResolvedValue({ activity: [activityEvent()] });
    removeActivityLogMock.mockResolvedValue({ event: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it("preserves exact filters, redacts visible secrets, and keeps activity actions comfortably sized", async () => {
    renderPage();

    expect(await screen.findByText("1 of 1 events")).toBeInTheDocument();
    expect(listActivityMock).toHaveBeenCalledWith({
      limit: 100,
      entityType: "task",
      entityId: undefined,
      source: "agent",
      from: "2026-08-08",
      to: "2026-08-09",
      includeCorrected: true,
      userIds: ["user_activity"]
    });
    expect(document.body.textContent).not.toContain("raw-activity-secret");
    expect(document.body.textContent).not.toContain("raw.activity.secret");
    expect(
      screen.getAllByText("Rotated api_key=[redacted]").length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Authorization: Bearer [redacted]").length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "Rotated api_key=[redacted]" })
    ).toHaveClass("min-h-11");

    const correctionToggle = screen.getByRole("checkbox", {
      name: "Show corrected and correction entries"
    });
    expect(correctionToggle).toHaveClass("size-5");
    expect(correctionToggle.parentElement).toHaveClass("min-h-11");
    for (const link of screen.getAllByRole("link", { name: "Open" })) {
      expect(link).toHaveClass("min-h-11");
    }
    for (const button of screen.getAllByRole("button", {
      name: /Remove Rotated api_key=\[redacted\] from visible activity/
    })) {
      expect(button).toHaveClass("min-h-11");
    }
    expect(screen.getByRole("link", { name: "Open task" })).toHaveClass(
      "min-h-11"
    );

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Search visible activity"
      }),
      { target: { value: "raw-activity-secret" } }
    );
    expect(await screen.findByText("No visible match")).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Search visible activity"
      }),
      { target: { value: "[redacted]" } }
    );
    expect(
      (await screen.findAllByText("Rotated api_key=[redacted]")).length
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: "ui" }
    });
    await waitFor(() => {
      expect(listActivityMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: "ui" })
      );
    });
  });
});
