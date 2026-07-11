import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const { enqueuePreferenceEntityMock } = vi.hoisted(() => ({
  enqueuePreferenceEntityMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  enqueuePreferenceEntity: enqueuePreferenceEntityMock
}));

import { PreferenceEntityHandoffButton } from "./preference-entity-handoff-button";

afterEach(() => {
  cleanup();
  enqueuePreferenceEntityMock.mockReset();
});

function renderButton(userId: string | null = "user_1") {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PreferenceEntityHandoffButton
          userId={userId}
          domain="projects"
          entityType="project"
          entityId="project_1"
          label="Preferences"
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PreferenceEntityHandoffButton", () => {
  it("surfaces enqueue failures without an unhandled rejected promise", async () => {
    enqueuePreferenceEntityMock.mockRejectedValueOnce(
      new Error("Source project was deleted.")
    );
    renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: "Send to Preferences" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Source project was deleted."
    );
  });

  it("requires one selected owner before enqueue", () => {
    renderButton(null);
    expect(
      screen.getByRole("button", { name: "Send to Preferences" })
    ).toBeDisabled();
  });
});
