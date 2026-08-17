import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";

import { RemoteBrowserPairing } from "@/components/security/remote-browser-pairing";
import {
  approveRemoteBrowserPairingWithMasterPassword,
  beginRemoteBrowserPairing,
  beginTrustedBrowserAuthentication,
  beginTrustedBrowserRegistration,
  completeTrustedBrowserRegistration,
  completeTrustedBrowserAuthentication,
  cancelRemoteBrowserPairingOnPageExit,
  pollRemoteBrowserPairing
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  approveRemoteBrowserPairingWithMasterPassword: vi.fn(),
  beginRemoteBrowserPairing: vi.fn(),
  beginTrustedBrowserAuthentication: vi.fn(),
  beginTrustedBrowserRegistration: vi.fn(),
  cancelRemoteBrowserPairing: vi.fn(),
  cancelRemoteBrowserPairingOnPageExit: vi.fn(),
  completeTrustedBrowserAuthentication: vi.fn(),
  completeTrustedBrowserRegistration: vi.fn(),
  pollRemoteBrowserPairing: vi.fn(),
  refreshRemoteBrowserPairingCancelProof: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RemoteBrowserPairing", () => {
  it("offers explicit trusted restoration before normal pairing", async () => {
    vi.mocked(beginTrustedBrowserAuthentication).mockResolvedValueOnce({
      challengeId: "tbc_1234567890123456",
      options: { challenge: "trusted-challenge" }
    });
    vi.mocked(startAuthentication).mockResolvedValueOnce({
      id: "trusted-credential"
    } as Awaited<ReturnType<typeof startAuthentication>>);
    vi.mocked(completeTrustedBrowserAuthentication).mockResolvedValueOnce({});
    const onPaired = vi.fn();

    render(<RemoteBrowserPairing onPaired={onPaired} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use a trusted device" })
    );

    await waitFor(() => {
      expect(startAuthentication).toHaveBeenCalledTimes(1);
      expect(completeTrustedBrowserAuthentication).toHaveBeenCalledWith({
        challengeId: "tbc_1234567890123456",
        response: { id: "trusted-credential" }
      });
      expect(onPaired).toHaveBeenCalledTimes(1);
    });
    expect(beginRemoteBrowserPairing).not.toHaveBeenCalled();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("falls back to ordinary pairing when WebAuthn is unavailable or declined", async () => {
    vi.mocked(beginTrustedBrowserAuthentication).mockResolvedValueOnce({
      challengeId: "tbc_1234567890123456",
      options: { challenge: "trusted-challenge" }
    });
    vi.mocked(startAuthentication).mockRejectedValueOnce(
      new DOMException("The operation was cancelled.", "NotAllowedError")
    );

    render(<RemoteBrowserPairing onPaired={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use a trusted device" })
    );

    expect(
      await screen.findByText(/could not restore this trusted browser/i)
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Pair this browser" })
    ).toBeEnabled();
    expect(beginRemoteBrowserPairing).not.toHaveBeenCalled();
  });

  it("offers explicit trust or ordinary continuation after pairing", async () => {
    const pairing = {
      requestId: "pair_browser_trust",
      deviceCode: "fg_device_trust",
      userCode: "BCDF-GHJK",
      verificationUri: "/forge/pair",
      expiresAt: Date.now() + 180_000,
      intervalSeconds: 0,
      masterPasswordAvailable: false,
      privateKey: {} as CryptoKey,
      publicJwk: {},
      cancelProof: "signed-cancel-proof"
    };
    vi.mocked(beginRemoteBrowserPairing).mockResolvedValueOnce(pairing);
    vi.mocked(pollRemoteBrowserPairing).mockResolvedValueOnce({
      status: "approved",
      clientId: "client_1234567890123456"
    });
    vi.mocked(beginTrustedBrowserRegistration).mockResolvedValueOnce({
      challengeId: "tbc_1234567890123456",
      options: { challenge: "registration-challenge" }
    });
    vi.mocked(startRegistration).mockResolvedValueOnce({
      id: "new-trusted-credential"
    } as Awaited<ReturnType<typeof startRegistration>>);
    vi.mocked(completeTrustedBrowserRegistration).mockResolvedValueOnce({
      credential: {} as never
    });
    const onPaired = vi.fn();

    render(<RemoteBrowserPairing onPaired={onPaired} />);
    fireEvent.click(screen.getByRole("button", { name: "Pair this browser" }));
    expect(
      await screen.findByRole("button", { name: "Trust this device" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue without trusting" })
    ).toBeInTheDocument();
    expect(onPaired).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Trust this device" }));
    await waitFor(() => {
      expect(completeTrustedBrowserRegistration).toHaveBeenCalledWith({
        clientId: "client_1234567890123456",
        challengeId: "tbc_1234567890123456",
        response: { id: "new-trusted-credential" }
      });
      expect(onPaired).toHaveBeenCalledTimes(1);
    });
  });

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
