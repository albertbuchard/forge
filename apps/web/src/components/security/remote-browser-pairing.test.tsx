import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteBrowserPairing } from "@/components/security/remote-browser-pairing";
import {
  approveRemoteBrowserPairingWithMasterPassword,
  beginRemoteBrowserPairing,
  cancelRemoteBrowserPairingOnPageExit
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";

vi.mock("@/lib/api", () => ({
  approveRemoteBrowserPairingWithMasterPassword: vi.fn(),
  beginRemoteBrowserPairing: vi.fn(),
  cancelRemoteBrowserPairing: vi.fn(),
  cancelRemoteBrowserPairingOnPageExit: vi.fn(),
  pollRemoteBrowserPairing: vi.fn(),
  refreshRemoteBrowserPairingCancelProof: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RemoteBrowserPairing", () => {
  it("shows an actionable bounded countdown when pending requests fill the cap", async () => {
    vi.mocked(beginRemoteBrowserPairing).mockRejectedValueOnce(
      new ForgeApiError({
        status: 429,
        code: "pairing_admission_limited",
        message:
          "Forge cannot admit another pairing request in the current bounded window.",
        requestPath: "/api/v1/auth/device",
        retryAfterSeconds: 600
      })
    );

    render(<RemoteBrowserPairing onPaired={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pair this browser" }));

    expect(
      await screen.findByText(/when the 600-second countdown ends/i)
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Try again in 600s" });
    expect(retry).toBeDisabled();
  });

  it("cancels an unfinished request when the paired page exits", async () => {
    const pairing = {
      requestId: "pair_browser_exit",
      deviceCode: "fg_device_exit",
      userCode: "BCDF-GHJK",
      verificationUri: "/forge/pair",
      expiresAt: Date.now() + 180_000,
      intervalSeconds: 5,
      masterPasswordAvailable: false,
      privateKey: {} as CryptoKey,
      publicJwk: {},
      cancelProof: "signed-cancel-proof"
    };
    vi.mocked(beginRemoteBrowserPairing).mockResolvedValueOnce(pairing);

    render(<RemoteBrowserPairing onPaired={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pair this browser" }));
    await screen.findByText("BCDF-GHJK");

    fireEvent(window, new PageTransitionEvent("pagehide"));

    await waitFor(() => {
      expect(cancelRemoteBrowserPairingOnPageExit).toHaveBeenCalledWith(
        pairing
      );
    });
  });

  it("offers configured master-password pairing without retaining the password", async () => {
    const pairing = {
      requestId: "pair_browser_master",
      deviceCode: "fg_device_master",
      userCode: "BCDF-GHJK",
      verificationUri: "/forge/pair",
      expiresAt: Date.now() + 180_000,
      intervalSeconds: 5,
      masterPasswordAvailable: true,
      privateKey: {} as CryptoKey,
      publicJwk: {},
      cancelProof: "signed-cancel-proof"
    };
    vi.mocked(beginRemoteBrowserPairing).mockResolvedValueOnce(pairing);
    vi.mocked(
      approveRemoteBrowserPairingWithMasterPassword
    ).mockResolvedValueOnce(undefined);

    render(<RemoteBrowserPairing onPaired={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pair this browser" }));
    const password = await screen.findByLabelText("Master password");
    fireEvent.change(password, {
      target: { value: "Frosted lanterns orbit the quiet lake 2026" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Pair with master password" })
    );

    await waitFor(() => {
      expect(
        approveRemoteBrowserPairingWithMasterPassword
      ).toHaveBeenCalledWith(
        pairing,
        "Frosted lanterns orbit the quiet lake 2026"
      );
    });
    expect(password).toHaveValue("");
    expect(screen.getByText(/master password accepted/i)).toBeInTheDocument();
  });
});
