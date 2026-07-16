import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticPeopleGateway } from "@/components/people/people-fixtures";
import {
  renderPeopleUi,
  setPeopleViewport
} from "@/components/people/people-test-utils";
import { PeoplePage } from "@/pages/people-page";
import { PersonDetailPage } from "@/pages/person-detail-page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("People routes", () => {
  it("renders the collection as the first People screen", async () => {
    setPeopleViewport(false);
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    renderPeopleUi(
      <Routes>
        <Route path="/people" element={<PeoplePage />} />
      </Routes>,
      { gateway, route: "/people" }
    );

    expect(
      await screen.findByRole("heading", { name: "People", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("People collection")).toBeInTheDocument();
    expect(screen.queryByLabelText("Person detail")).not.toBeInTheDocument();
  });

  it("uses the live HTTP gateway by default without browser persistence", async () => {
    setPeopleViewport(false);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const fetchRequest = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        const body = url.startsWith("/api/v1/people?")
          ? {
              people: [],
              page: { limit: 100, hasMore: false, nextCursor: null }
            }
          : url.startsWith("/api/v1/peers/requests?")
            ? {
                requests: [],
                page: { limit: 100, hasMore: false, nextCursor: null }
              }
            : null;

        if (!body) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      });

    renderPeopleUi(
      <Routes>
        <Route path="/people" element={<PeoplePage />} />
      </Routes>,
      { route: "/people" }
    );

    expect(
      await screen.findByRole("heading", { name: "People", level: 1 })
    ).toBeInTheDocument();
    expect(
      await screen.findByText("You haven't added anyone yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("People could not be loaded")).toBeNull();
    await waitFor(() => {
      expect(fetchRequest).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/v1\/people\?/),
        expect.objectContaining({ credentials: "same-origin" })
      );
      expect(fetchRequest).toHaveBeenCalledWith(
        "/api/v1/peers/requests?status=pending&limit=100",
        expect.objectContaining({ credentials: "same-origin" })
      );
    });
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("uses a focused detail route on mobile and browser navigation back", async () => {
    setPeopleViewport(false);
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    renderPeopleUi(
      <Routes>
        <Route path="/people" element={<div>Collection destination</div>} />
        <Route path="/people/:personId" element={<PersonDetailPage />} />
      </Routes>,
      { gateway, route: "/people/person_000001" }
    );

    expect(
      await screen.findByRole("heading", { name: "Ari Alden", level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "People", level: 1 })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Person detail")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("People collection")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(
      await screen.findByText("Collection destination")
    ).toBeInTheDocument();
  });

  it("keeps the collection beside the routed detail on desktop", async () => {
    setPeopleViewport(true);
    const gateway = createSyntheticPeopleGateway({ count: 8 });
    renderPeopleUi(
      <Routes>
        <Route path="/people/:personId" element={<PersonDetailPage />} />
      </Routes>,
      { gateway, route: "/people/person_000001" }
    );

    expect(
      await screen.findByRole("heading", { name: "People", level: 1 })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Ari Alden", level: 2 })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("People collection")).toBeInTheDocument();
    expect(screen.getByLabelText("Person detail")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "People" })
    ).not.toBeInTheDocument();
  });
});
