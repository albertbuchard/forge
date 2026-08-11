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
  it("offers an unset-by-default strong master password and confirms before saving", async () => {
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
      await screen.findByText(/repeated short patterns.*keyboard sequences/i)
    ).toBeInTheDocument();
    const save = await screen.findByRole("button", {
      name: "Set master password"
    });
    const password = screen.getByLabelText("Create master password");
    const confirmation = screen.getByLabelText("Confirm master password");

    fireEvent.change(password, { target: { value: "too short" } });
    fireEvent.change(confirmation, { target: { value: "too short" } });
    expect(save).toBeDisabled();

    const strong = "Frosted lanterns orbit the quiet lake 2026";
    fireEvent.change(password, { target: { value: strong } });
    fireEvent.change(confirmation, { target: { value: `${strong}!` } });
    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    expect(save).toBeDisabled();

    fireEvent.change(confirmation, { target: { value: strong } });
    fireEvent.click(save);
    await waitFor(() => {
      expect(vi.mocked(setMasterPassword).mock.calls[0]?.[0]).toEqual({
        password: strong,
        confirmation: strong
      });
    });
    expect(
      await screen.findByText(/remote browsers may now choose/i)
    ).toBeInTheDocument();
  });
});
