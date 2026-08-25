import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startAuthentication,
  startRegistration,
  WebAuthnAbortService
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
  startRegistration: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() }
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

beforeEach(() => {
  vi.mocked(beginTrustedBrowserAuthentication).mockRejectedValue(
    new DOMException("No device passkey is available.", "NotAllowedError")
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("RemoteBrowserPairing", () => {
  it("automatically restores a device passkey before normal pairing", async () => {
    vi.mocked(beginTrustedBrowserAuthentication).mockResolvedValue({
      challengeId: "tbc_1234567890123456",
      options: { challenge: "trusted-challenge" }
    });
    vi.mocked(startAuthentication).mockResolvedValue({
      id: "trusted-credential"
    } as Awaited<ReturnType<typeof startAuthentication>>);
    vi.mocked(completeTrustedBrowserAuthentication).mockResolvedValue({});
    const onPaired = vi.fn();

    render(
      <StrictMode>
        <RemoteBrowserPairing onPaired={onPaired} />
      </StrictMode>
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

  it("falls back to ordinary pairing when automatic device restoration is unavailable or declined", async () => {
    vi.mocked(beginTrustedBrowserAuthentication).mockResolvedValueOnce({
      challengeId: "tbc_1234567890123456",
      options: { challenge: "trusted-challenge" }
    });
    vi.mocked(startAuthentication).mockRejectedValueOnce(
      new DOMException("The operation was cancelled.", "NotAllowedError")
    );

    render(<RemoteBrowserPairing onPaired={vi.fn()} />);

    const pairButton = screen.getByRole("button", {
      name: "Pair this browser"
    });
    await waitFor(() => expect(pairButton).toBeEnabled());
    expect(startAuthentication).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Restore this device" })
    ).toBeEnabled();
    expect(beginRemoteBrowserPairing).not.toHaveBeenCalled();
  });

  it("keeps ordinary pairing available while automatic device restoration is still waiting", async () => {
    const pairing = {
      requestId: "pair_browser_hanging_restore",
      deviceCode: "fg_device_hanging_restore",
      userCode: "BCDF-GHJK",
      verificationUri: "/forge/pair",
      expiresAt: Date.now() + 180_000,
      intervalSeconds: 5,
      masterPasswordAvailable: false,
      privateKey: {} as CryptoKey,
      publicJwk: {},
      cancelProof: "signed-cancel-proof"
    };
    vi.mocked(beginTrustedBrowserAuthentication).mockResolvedValueOnce({
      challengeId: "tbc_hanging_restore",
      options: { challenge: "trusted-challenge" }
    });
    vi.mocked(startAuthentication).mockReturnValueOnce(
      new Promise<Awaited<ReturnType<typeof startAuthentication>>>(
        () => undefined
      )
    );
    vi.mocked(beginRemoteBrowserPairing).mockResolvedValueOnce(pairing);

    render(<RemoteBrowserPairing onPaired={vi.fn()} />);
    await waitFor(() => expect(startAuthentication).toHaveBeenCalledTimes(1));
    const pairButton = screen.getByRole("button", {
      name: "Pair this browser"
    });
    expect(pairButton).toBeEnabled();
    fireEvent.click(pairButton);

    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
    expect(await screen.findByText("BCDF-GHJK")).toBeInTheDocument();
  });

  it("enrolls a device passkey immediately after the one approved pairing", async () => {
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
    const pairButton = screen.getByRole("button", {
      name: "Pair this browser"
    });
    await waitFor(() => expect(pairButton).toBeEnabled());
    fireEvent.click(pairButton);

    await waitFor(() => {
      expect(completeTrustedBrowserRegistration).toHaveBeenCalledWith({
        clientId: "client_1234567890123456",
        challengeId: "tbc_1234567890123456",
        response: { id: "new-trusted-credential" }
      });
      expect(onPaired).toHaveBeenCalledTimes(1);
    });
    expect(beginTrustedBrowserRegistration).toHaveBeenCalledWith({
      clientId: "client_1234567890123456",
      label: expect.stringMatching(/^Forge device passkey on /)
    });
  });

  it("keeps the paired session usable when device-passkey enrollment is declined", async () => {
    const pairing = {
      requestId: "pair_browser_session_fallback",
      deviceCode: "fg_device_session_fallback",
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
    vi.mocked(startRegistration).mockRejectedValueOnce(
      new DOMException("The operation was cancelled.", "NotAllowedError")
    );
    const onPaired = vi.fn();

    render(<RemoteBrowserPairing onPaired={onPaired} />);
    const pairButton = screen.getByRole("button", {
      name: "Pair this browser"
    });
    await waitFor(() => expect(pairButton).toBeEnabled());
    fireEvent.click(pairButton);

    expect(
      await screen.findByRole("button", {
        name: "Finish trusting this device"
      })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Use this browser session only" })
    ).toBeEnabled();
    expect(onPaired).not.toHaveBeenCalled();
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
    const pairButton = screen.getByRole("button", {
      name: "Pair this browser"
    });
    await waitFor(() => expect(pairButton).toBeEnabled());
    fireEvent.click(pairButton);

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
    const pairButton = screen.getByRole("button", {
      name: "Pair this browser"
    });
    await waitFor(() => expect(pairButton).toBeEnabled());
    fireEvent.click(pairButton);
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
    const pairButton = screen.getByRole("button", {
      name: "Pair this browser"
    });
    await waitFor(() => expect(pairButton).toBeEnabled());
    fireEvent.click(pairButton);
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
