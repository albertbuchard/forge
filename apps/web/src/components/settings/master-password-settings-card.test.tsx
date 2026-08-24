import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MasterPasswordSettingsCard } from "@/components/settings/master-password-settings-card";
import { getMasterPasswordStatus, setMasterPassword } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getMasterPasswordStatus: vi.fn(),
  setMasterPassword: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MasterPasswordSettingsCard />
    </QueryClientProvider>
  );
}

describe("MasterPasswordSettingsCard", () => {
  it("enforces only the basic length rule and makes strength guidance non-blocking", async () => {
    vi.mocked(getMasterPasswordStatus).mockResolvedValueOnce({
      configured: false,
      configuredAt: null,
      updatedAt: null,
      minimumLength: 15,
      maximumLength: 128
    });
    vi.mocked(setMasterPassword).mockResolvedValueOnce({
      configured: true,
      configuredAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-11T12:00:00.000Z",
      minimumLength: 15,
      maximumLength: 128
    });

    renderCard();
    expect(await screen.findByText("Not set")).toBeInTheDocument();
    expect(
      screen.getByText(/optional and unset by default/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /only strength requirement is at least 15 characters\./i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/strength estimate.*will not block/i)
    ).toBeVisible();
    const save = await screen.findByRole("button", {
      name: "Set master password"
    });
    const password = screen.getByLabelText("Create master password");
    const confirmation = screen.getByLabelText("Confirm master password");

    fireEvent.change(password, { target: { value: "too short" } });
    fireEvent.change(confirmation, { target: { value: "too short" } });
    expect(save).toBeDisabled();
    expect(screen.getByText("Too short")).toBeVisible();
    expect(
      screen.getByRole("progressbar", {
        name: "Estimated master password strength"
      })
    ).toHaveAttribute("aria-valuenow", "21");

    const accepted = "aaaaaaaaaaaaaaaa";
    fireEvent.change(password, { target: { value: accepted } });
    fireEvent.change(confirmation, { target: { value: `${accepted}!` } });
    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    expect(save).toBeDisabled();

    fireEvent.change(confirmation, { target: { value: accepted } });
    expect(screen.getByText("Minimum met")).toBeVisible();
    expect(screen.getByText(/accepted.*not required/i)).toBeVisible();
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => {
      expect(vi.mocked(setMasterPassword).mock.calls[0]?.[0]).toEqual({
        password: accepted,
        confirmation: accepted
      });
    });
    expect(
      await screen.findByText(/remote browsers may now choose/i)
    ).toBeInTheDocument();
  });
});
