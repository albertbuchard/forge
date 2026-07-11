import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  SETTINGS_SECTIONS,
  SettingsSectionNav
} from "@/components/settings/settings-section-nav";

describe("SettingsSectionNav", () => {
  afterEach(cleanup);

  it("indexes every operator settings family with a distinct description", () => {
    render(
      <MemoryRouter initialEntries={["/settings/models"]}>
        <SettingsSectionNav />
      </MemoryRouter>
    );

    expect(
      screen.getAllByRole("navigation", { name: "Settings sections" })[0]
    ).toBeInTheDocument();
    for (const section of SETTINGS_SECTIONS) {
      const links = screen.getAllByRole("link", { name: section.label });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute("href", section.to);
      expect(links[0]).toHaveAttribute("title", section.description);
    }
  });

  it("keeps descriptions and return paths available in the mobile index", () => {
    render(
      <MemoryRouter initialEntries={["/settings/mobile/lab"]}>
        <SettingsSectionNav />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /settings section/i }));

    expect(
      screen.getByRole("dialog", { name: "Settings sections" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "iPhone and watch pairing, permissions, sync, and recovery."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Runtime" })[0]).toHaveAttribute(
      "href",
      "/settings"
    );
  });
});
