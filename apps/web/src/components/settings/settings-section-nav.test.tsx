import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  SETTINGS_SECTIONS,
  SettingsSectionNav
} from "@/components/settings/settings-section-nav";

const { prefetchRouteModuleMock } = vi.hoisted(() => ({
  prefetchRouteModuleMock: vi.fn()
}));

vi.mock("@/routes/route-prefetch", () => ({
  prefetchRouteModule: prefetchRouteModuleMock
}));

const EXPECTED_SETTINGS_INDEX = [
  [
    "Runtime",
    "/settings",
    "Operator session, execution policy, appearance, locale, and Doctor checks."
  ],
  [
    "Data",
    "/settings/data",
    "Active data root, backups, exports, and recovery candidates."
  ],
  [
    "Users",
    "/settings/users",
    "Human and bot identities, ownership, and directional access."
  ],
  [
    "Calendar",
    "/settings/calendar",
    "Provider connections, calendar selection, and sync defaults."
  ],
  [
    "Mobile",
    "/settings/mobile",
    "iPhone and watch pairing, permissions, sync, and recovery."
  ],
  [
    "Models",
    "/settings/models",
    "Model providers, credentials, defaults, and health checks."
  ],
  [
    "Agents",
    "/settings/agents",
    "Agent identities, sessions, scopes, tokens, and approvals."
  ],
  [
    "Rewards",
    "/settings/rewards",
    "Progression rules, assets, and reward controls."
  ],
  [
    "KarpaWiki",
    "/settings/wiki",
    "Wiki spaces, index health, ingest behavior, and reindexing."
  ],
  [
    "Logs",
    "/settings/logs",
    "Bounded runtime diagnostics and recovery evidence."
  ],
  [
    "Bin",
    "/settings/bin",
    "Soft-deleted records available for deliberate recovery."
  ]
] as const;

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

describe("SettingsSectionNav", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("indexes every operator settings family in the canonical order", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsSectionNav />
      </MemoryRouter>
    );

    expect(
      SETTINGS_SECTIONS.map(({ label, to, description }) => [
        label,
        to,
        description
      ])
    ).toEqual(EXPECTED_SETTINGS_INDEX);

    const navigation = screen.getByRole("navigation", {
      name: "Settings sections"
    });
    const links = within(navigation).getAllByRole("link");
    expect(links).toHaveLength(EXPECTED_SETTINGS_INDEX.length);

    EXPECTED_SETTINGS_INDEX.forEach(([label, to, description], index) => {
      expect(links[index]).toHaveAccessibleName(label);
      expect(links[index]).toHaveAttribute("href", to);
      expect(links[index]).toHaveAccessibleDescription(description);
    });
    expect(
      within(navigation).getByRole("link", { name: "Runtime" })
    ).toHaveAttribute("aria-current", "page");
  });

  it("routes every desktop index destination and focuses its return link", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsSectionNav />
        <LocationProbe />
      </MemoryRouter>
    );

    for (const [label, to] of EXPECTED_SETTINGS_INDEX) {
      const navigation = screen.getByRole("navigation", {
        name: "Settings sections"
      });
      const link = within(navigation).getByRole("link", { name: label });
      fireEvent.click(link);

      expect(
        screen.getByRole("status", { name: "Current route" })
      ).toHaveTextContent(to);
      await waitFor(() => expect(link).toHaveFocus());
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });

  it("marks nested routes active and prefetches destinations on intent", () => {
    render(
      <MemoryRouter initialEntries={["/settings/mobile/lab"]}>
        <SettingsSectionNav />
      </MemoryRouter>
    );

    const navigation = screen.getByRole("navigation", {
      name: "Settings sections"
    });
    const mobileLink = within(navigation).getByRole("link", {
      name: "Mobile"
    });
    expect(mobileLink).toHaveAttribute("aria-current", "page");
    expect(mobileLink).toHaveAttribute(
      "title",
      "iPhone and watch pairing, permissions, sync, and recovery."
    );

    const modelsLink = within(navigation).getByRole("link", {
      name: "Models"
    });
    fireEvent.pointerEnter(modelsLink);
    expect(prefetchRouteModuleMock).toHaveBeenCalledWith("/settings/models");
  });

  it("keeps descriptions and return paths available in a keyboard-safe mobile index", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/mobile/lab"]}>
        <SettingsSectionNav />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: /settings section/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Settings sections" });
    expect(dialog).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.body.style.overflow).toBe("hidden");
    EXPECTED_SETTINGS_INDEX.forEach(([label, , description]) => {
      expect(
        within(dialog).getByRole("link", { name: label })
      ).toHaveAccessibleDescription(description);
    });
    expect(
      within(dialog).getByRole("link", { name: "Runtime" })
    ).toHaveAttribute("href", "/settings");
    expect(
      screen.getAllByRole("button", { name: "Close settings sections" })
    ).toHaveLength(1);

    const closeButton = within(dialog).getByRole("button", {
      name: "Close settings sections"
    });
    await waitFor(() => expect(closeButton).toHaveFocus());

    const dialogLinks = within(dialog).getAllByRole("link");
    const lastLink = dialogLinks[dialogLinks.length - 1];
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastLink).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
  });

  it("moves focus to the destination trigger after mobile route navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/mobile"]}>
        <Routes>
          <Route
            path="/settings/mobile"
            element={
              <div>
                <SettingsSectionNav />
              </div>
            }
          />
          <Route
            path="/settings/models"
            element={
              <section>
                <SettingsSectionNav />
              </section>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /settings section/i }));
    const dialog = screen.getByRole("dialog", { name: "Settings sections" });
    fireEvent.click(within(dialog).getByRole("link", { name: "Models" }));

    const destinationTrigger = await screen.findByRole("button", {
      name: /settings section models browse/i
    });
    await waitFor(() => expect(destinationTrigger).toHaveFocus());
    expect(
      screen.queryByRole("dialog", { name: "Settings sections" })
    ).not.toBeInTheDocument();
  });

  it("returns focus when the current mobile section is selected again", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/models"]}>
        <SettingsSectionNav />
        <LocationProbe />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: /settings section/i });
    fireEvent.click(trigger);
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Settings sections" })
      ).getByRole("link", { name: "Models" })
    );

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      screen.getByRole("status", { name: "Current route" })
    ).toHaveTextContent("/settings/models");
    expect(
      screen.queryByRole("dialog", { name: "Settings sections" })
    ).not.toBeInTheDocument();
  });
});
