import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ComparisonPage } from "./comparison-page";

const { getComparisonMock, listComparisonCatalogMock, useForgeShellMock } =
  vi.hoisted(() => ({
    getComparisonMock: vi.fn(),
    listComparisonCatalogMock: vi.fn(),
    useForgeShellMock: vi.fn()
  }));

vi.mock("@/lib/api", () => ({
  getComparison: getComparisonMock,
  listComparisonCatalog: listComparisonCatalogMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(initialEntry = "/compare") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/compare"
            element={
              <>
                <ComparisonPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const catalogResponse = {
  userId: "user_operator",
  query: "",
  family: null,
  items: [
    {
      selector: "health:resting_heart_rate",
      family: "health",
      title: "Resting heart rate",
      description: "Daily resting heart rate from the Health summary.",
      valueKind: "number",
      unit: "bpm",
      availability: "history",
      sourceHref: "/vitals"
    },
    {
      selector: "note:note_1",
      family: "note",
      title: "Recovery note",
      description: "A current Note event with its original source.",
      valueKind: "event",
      unit: null,
      availability: "current_only",
      sourceHref: "/notes?focus=note_1"
    }
  ],
  total: 2,
  limit: 40,
  nextCursor: null,
  hasMore: false
} as const;

const comparisonResponse = {
  userId: "user_operator",
  from: "2026-07-01",
  to: "2026-07-31",
  timeZone: "Europe/Zurich",
  alignmentRequested: "separate_tracks",
  alignmentApplied: "separate_tracks",
  sharedAxisReason: null,
  lanes: [
    {
      selector: "health:resting_heart_rate",
      family: "health",
      title: "Resting heart rate",
      valueKind: "number",
      unit: "bpm",
      availability: "history",
      state: "available",
      limitation: null,
      sourceHref: "/vitals",
      points: [
        {
          at: "2026-07-01T10:00:00.000Z",
          dateKey: "2026-07-01",
          value: 58,
          label: null,
          missingReason: null,
          source: {
            entityType: "health_daily_summary",
            entityId: "2026-07-01:user_operator",
            href: "/vitals?date=2026-07-01"
          },
          evidence: [{ key: "health:2026-07-01", label: "Daily summary" }]
        },
        {
          at: "2026-07-02T10:00:00.000Z",
          dateKey: "2026-07-02",
          value: null,
          label: null,
          missingReason: "not_recorded",
          source: null,
          evidence: []
        }
      ],
      pointCount: 2,
      sourceReferenceCount: 1,
      sourceReferencesTruncated: false
    }
  ],
  totals: {
    laneCount: 1,
    pointCount: 2,
    sourceReferenceCount: 1,
    sourceReferencesTruncated: false
  }
} as const;

describe("ComparisonPage", () => {
  beforeEach(() => {
    useForgeShellMock.mockReturnValue({ selectedUserIds: ["user_operator"] });
    listComparisonCatalogMock.mockResolvedValue(catalogResponse);
    getComparisonMock.mockResolvedValue(comparisonResponse);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires exactly one selected person before reading any comparison data", () => {
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_one", "user_two"]
    });

    renderPage();

    expect(screen.getByText("One person is required")).toBeInTheDocument();
    expect(screen.getByText(/will not mix records/i)).toBeInTheDocument();
    expect(listComparisonCatalogMock).not.toHaveBeenCalled();
    expect(getComparisonMock).not.toHaveBeenCalled();
  });

  it("writes implicit dates and the device time zone into a restorable URL", async () => {
    renderPage("/compare");

    await waitFor(() => {
      const params = new URLSearchParams(
        screen.getByTestId("location").textContent ?? ""
      );
      expect(params.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.get("timeZone")).toBeTruthy();
      expect(params.get("from")! <= params.get("to")!).toBe(true);
    });
  });

  it("shows recoverable errors for invalid dates and time zones without querying", async () => {
    renderPage(
      "/compare?selection=health%3Aresting_heart_rate&from=2026-02-31&to=not-a-date&timeZone=Not%2FA_Time_Zone"
    );

    expect(
      await screen.findByText(/time zone in this link is not valid/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/dates in this link are not valid/i)
    ).toBeInTheDocument();
    expect(getComparisonMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /use this device’s time zone/i })
    ).toHaveClass("min-h-11");
  });

  it("round-trips ordered URL selections and keeps gaps, units, and sources explicit", async () => {
    renderPage(
      "/compare?selection=health%3Aresting_heart_rate&from=2026-07-01&to=2026-07-31&timeZone=Europe%2FZurich&alignment=separate_tracks"
    );

    expect((await screen.findAllByText("Resting heart rate")).length).toBe(2);
    expect(screen.getAllByText("bpm").length).toBeGreaterThan(0);
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "/vitals?date=2026-07-01"
    );
    await waitFor(() =>
      expect(getComparisonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_operator",
          selections: ["health:resting_heart_rate"],
          from: "2026-07-01",
          to: "2026-07-31",
          timeZone: "Europe/Zurich",
          alignment: "separate_tracks"
        })
      )
    );
  });

  it("adds and removes records through the URL without exceeding eight selections", async () => {
    renderPage("/compare?from=2026-07-01&to=2026-07-31");

    const [addButton] = await screen.findAllByRole("button", {
      name: "Add to comparison"
    });
    expect(addButton).toBeDefined();
    if (!addButton) throw new Error("Expected one available comparison record");
    fireEvent.click(addButton);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "selection=health%3Aresting_heart_rate"
    );

    const removeButtons = await screen.findAllByRole("button", {
      name: "Remove"
    });
    const removeButton = removeButtons.at(-1);
    expect(removeButton).toBeDefined();
    if (!removeButton)
      throw new Error("Expected the selected comparison record");
    fireEvent.click(removeButton);
    expect(screen.getByTestId("location")).not.toHaveTextContent("selection=");
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Add to comparison" })[0]
      ).toHaveFocus()
    );
  });

  it("uses one numeric scale only when the API confirms matching units", async () => {
    getComparisonMock.mockResolvedValueOnce({
      ...comparisonResponse,
      alignmentRequested: "shared_axis",
      alignmentApplied: "shared_axis",
      lanes: [
        {
          ...comparisonResponse.lanes[0],
          selector: "health:resting_heart_rate",
          title: "Resting heart rate",
          points: [
            { ...comparisonResponse.lanes[0].points[0], value: 50 },
            { ...comparisonResponse.lanes[0].points[1], value: 100 }
          ]
        },
        {
          ...comparisonResponse.lanes[0],
          selector: "health:walking_heart_rate",
          title: "Walking heart rate",
          points: [
            { ...comparisonResponse.lanes[0].points[0], value: 75 },
            { ...comparisonResponse.lanes[0].points[1], value: 80 }
          ]
        }
      ],
      totals: { ...comparisonResponse.totals, laneCount: 2, pointCount: 4 }
    });

    renderPage(
      "/compare?selection=health%3Aresting_heart_rate&selection=health%3Awalking_heart_rate&from=2026-07-01&to=2026-07-31&alignment=shared_axis"
    );

    expect(
      await screen.findByText("One shared scale is in use.")
    ).toBeInTheDocument();
    expect(screen.getAllByText("50–100 bpm")).toHaveLength(2);
  });

  it("keeps a source action for a current-only record outside the date range", async () => {
    getComparisonMock.mockResolvedValueOnce({
      ...comparisonResponse,
      lanes: [
        {
          ...comparisonResponse.lanes[0],
          selector: "note:note_1",
          family: "note",
          title: "Recovery note",
          valueKind: "event",
          unit: null,
          availability: "current_only",
          limitation:
            "Forge stores only the current record and does not reconstruct earlier content.",
          sourceHref: "/notes?focus=note_1",
          points: [],
          pointCount: 0,
          sourceReferenceCount: 0
        }
      ],
      totals: {
        ...comparisonResponse.totals,
        pointCount: 0,
        sourceReferenceCount: 0
      }
    });

    renderPage(
      "/compare?selection=note%3Anote_1&from=2026-07-01&to=2026-07-31&timeZone=Europe%2FZurich"
    );

    expect((await screen.findAllByText("Recovery note")).length).toBe(2);
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "/notes?focus=note_1"
    );
  });

  it("lets a person remove selections from an over-limit URL", async () => {
    const selections = Array.from(
      { length: 9 },
      (_, index) => `selection=note%3Anote_${index + 1}`
    ).join("&");
    renderPage(`/compare?${selections}`);

    const removeNinth = screen.getByRole("button", {
      name: "Remove selected record 9"
    });
    expect(removeNinth).toHaveClass("min-h-11");
    fireEvent.click(removeNinth);
    expect(screen.getByTestId("location")).not.toHaveTextContent("note_9");
  });

  it("shows truthful catalog and comparison errors with bounded retry actions", async () => {
    listComparisonCatalogMock.mockRejectedValueOnce(
      new Error("Catalog permission check failed")
    );
    getComparisonMock.mockRejectedValueOnce(
      new Error("Comparison could not be loaded")
    );

    renderPage(
      "/compare?selection=health%3Aresting_heart_rate&from=2026-07-01&to=2026-07-31"
    );

    expect(
      await screen.findByText("Catalog permission check failed")
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Comparison could not be loaded")
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again/i }).length).toBe(
      2
    );
  });
});
