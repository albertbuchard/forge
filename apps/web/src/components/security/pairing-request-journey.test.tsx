import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PairingRequestNotification,
  pairingRequestPollingInterval
} from "@/components/security/pairing-request-notification";
import { RemotePairingApprovalCard } from "@/components/settings/remote-pairing-approval-card";
import {
  approveRemotePairingRequest,
  beginPrivilegedPairingStepUp,
  completePrivilegedPairingStepUp,
  denyRemotePairingRequest,
  listRemoteClients,
  listRemotePairingRequests
} from "@/lib/api";

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  approveRemotePairingRequest: vi.fn(),
  beginPrivilegedPairingStepUp: vi.fn(),
  completePrivilegedPairingStepUp: vi.fn(),
  denyRemotePairingRequest: vi.fn(),
  listRemoteClients: vi.fn(),
  listRemotePairingRequests: vi.fn(),
  revokeRemoteClient: vi.fn()
}));

const request = {
  requestId: "pair_12345678-1234-1234-1234-123456789012",
  clientName: "Forge Companion on iPhone",
  clientType: "api" as const,
  audience: "urn:forge:install_1234567890123456:api",
  requestedScopes: ["companion.pair"],
  requestedProfile: "trusted_personal_assistant" as const,
  expiresAt: "2026-07-28T14:30:00.000Z",
  installationFingerprint: "11111111-22222222-33333333-44444444",
  endpoint: {
    origin: "https://forge.example.test",
    fingerprint: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD"
  },
  boundaries: {
    resources: {
      profile: "trusted_personal_assistant",
      scopes: ["companion.pair"],
      enforcement: "profile_scopes_and_route_policy" as const
    },
    egress: {
      requestedScopes: [],
      enforcement: "capability_policy_and_destination_validation" as const,
      default: "denied_unless_capability_explicitly_allows" as const
    }
  },
  status: "pending" as "pending" | "approved",
  approvedAt: null as string | null,
  clientId: null as string | null
};

function renderWithProviders(node: import("react").ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("secure pairing request journey", () => {
  let requestStatus: "pending" | "approved" | "removed";
  let clients: Array<{
    id: string;
    clientName: string;
    clientType: "api";
    audience: string;
    profile: "trusted_personal_assistant";
    scopes: string[];
    createdAt: string;
    revokedAt: string | null;
    activationState: "awaiting_client";
  }>;

  beforeEach(() => {
    requestStatus = "pending";
    clients = [];
    vi.mocked(listRemotePairingRequests).mockImplementation(async () => ({
      requests:
        requestStatus === "removed"
          ? []
          : [
              {
                ...request,
                status: requestStatus,
                approvedAt:
                  requestStatus === "approved"
                    ? "2026-07-28T14:20:00.000Z"
                    : null,
                clientId:
                  requestStatus === "approved"
                    ? "client_12345678-1234-1234-1234-123456789012"
                    : null
              }
            ]
    }));
    vi.mocked(listRemoteClients).mockImplementation(async () => ({ clients }));
    vi.mocked(approveRemotePairingRequest).mockImplementation(
      async (requestId) => {
        requestStatus = "approved";
        clients = [
          {
            id: "client_12345678-1234-1234-1234-123456789012",
            clientName: request.clientName,
            clientType: "api",
            audience: request.audience,
            profile: "trusted_personal_assistant",
            scopes: ["companion.pair", "profile:trusted_personal_assistant"],
            createdAt: "2026-07-28T14:20:00.000Z",
            revokedAt: null,
            activationState: "awaiting_client"
          }
        ];
        return {
          requestId,
          clientId: clients[0]!.id,
          clientName: request.clientName,
          audience: request.audience,
          scopes: clients[0]!.scopes,
          profile: "trusted_personal_assistant" as const
        };
      }
    );
    vi.mocked(denyRemotePairingRequest).mockImplementation(async () => {
      requestStatus = "removed";
      return { denied: true };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("announces a new request and links directly to the pending list", async () => {
    renderWithProviders(<PairingRequestNotification enabled />);

    const link = await screen.findByRole("link", {
      name: /new pairing request/i
    });
    expect(link).toHaveAttribute("href", "/settings/agents#pending-pairings");
    expect(
      screen.getByText(/Forge Companion on iPhone is waiting/i)
    ).toBeVisible();
  });

  it("keeps visible polling bounded and pauses hidden tabs", () => {
    expect(pairingRequestPollingInterval(true, "pending")).toBe(3_000);
    expect(pairingRequestPollingInterval(true, "success")).toBe(3_000);
    expect(pairingRequestPollingInterval(true, "error")).toBe(15_000);
    expect(pairingRequestPollingInterval(false, "success")).toBe(false);
    expect(pairingRequestPollingInterval(false, "error")).toBe(false);
  });

  it("does not query pairing metadata when the local-owner notification is disabled", async () => {
    renderWithProviders(<PairingRequestNotification enabled={false} />);
    await Promise.resolve();
    expect(listRemotePairingRequests).not.toHaveBeenCalled();
  });

  it("uses the visible list as review and approves with one code submission", async () => {
    renderWithProviders(<RemotePairingApprovalCard />);

    expect(await screen.findByText("Forge Companion on iPhone")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /review request/i })
    ).toBeNull();
    fireEvent.change(
      screen.getByLabelText(/short code shown on Forge Companion on iPhone/i),
      { target: { value: "BCDF-GHJK" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveRemotePairingRequest).toHaveBeenCalledWith(
        request.requestId,
        "BCDF-GHJK"
      );
    });
    expect(
      await screen.findByText(/approved — waiting for the device/i)
    ).toBeVisible();
    expect(await screen.findByText("awaiting client")).toBeVisible();
  });

  it("denies an abandoned request by exact selection without asking for its code", async () => {
    renderWithProviders(<RemotePairingApprovalCard />);

    await screen.findByText("Forge Companion on iPhone");
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(denyRemotePairingRequest).toHaveBeenCalledWith(request.requestId);
    });
    expect(await screen.findByText(/was denied/i)).toBeVisible();
    expect(await screen.findByText(/no device is waiting/i)).toBeVisible();
  });

  it("uses one passkey step-up to approve the exact elevated request", async () => {
    const elevatedRequest = {
      ...request,
      requestedProfile: "executor" as const,
      requestedScopes: ["machine.execute"]
    };
    vi.mocked(listRemotePairingRequests).mockResolvedValue({
      requests: [elevatedRequest]
    });
    vi.mocked(beginPrivilegedPairingStepUp).mockResolvedValue({
      ceremony: "authenticate",
      challengeId: "stepup_1234567890123456",
      review: elevatedRequest,
      options: { challenge: "A".repeat(43) }
    } as never);
    vi.mocked(startAuthentication).mockResolvedValue({
      id: "credential_1234567890123456"
    } as never);
    vi.mocked(completePrivilegedPairingStepUp).mockResolvedValue({
      requestId: elevatedRequest.requestId,
      clientId: "client_12345678-1234-1234-1234-123456789012"
    } as never);

    renderWithProviders(<RemotePairingApprovalCard />);

    await screen.findByText("Forge Companion on iPhone");
    fireEvent.change(
      screen.getByLabelText(/short code shown on Forge Companion on iPhone/i),
      { target: { value: "BCDF-GHJK" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and approve" })
    );

    await waitFor(() => {
      expect(beginPrivilegedPairingStepUp).toHaveBeenCalledWith("BCDF-GHJK");
      expect(startAuthentication).toHaveBeenCalledTimes(1);
      expect(completePrivilegedPairingStepUp).toHaveBeenCalledWith(
        expect.objectContaining({
          userCode: "BCDF-GHJK",
          review: elevatedRequest,
          challengeId: "stepup_1234567890123456"
        })
      );
    });
    expect(
      await screen.findByText(/approved and waiting for the device/i)
    ).toBeVisible();
    expect(approveRemotePairingRequest).not.toHaveBeenCalled();
  });
});
