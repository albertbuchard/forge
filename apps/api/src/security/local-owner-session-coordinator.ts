import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify
} from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../errors.js";
import { BrowserSessionService } from "./browser-session-service.js";
import type { ForgePrincipal } from "./contracts.js";
import { LocalOwnerAssertionService } from "./local-owner-assertion.js";
import {
  NATIVE_OWNER_BROKER_PROTOCOL,
  NativeOwnerBroker,
  type NativeOwnerBrokerRequest,
  OwnerChannelAuthority
} from "./owner-channel.js";
import type { SecurityClock } from "./security-runtime.js";

const MAXIMUM_PENDING_LOCAL_OWNER_TRANSACTIONS = 4;
const LOCAL_AUTOMATIC_BROWSER_BROKER_TIMEOUT_MS = 5_000;
const LOCAL_INTERACTIVE_BROWSER_TRANSACTION_SECONDS = 120;
const LOCAL_INTERACTIVE_BROWSER_BROKER_TIMEOUT_MS = 120_000;
const LOCAL_NATIVE_SERVICE_BROKER_TIMEOUT_MS = 15_000;
const LOCAL_NATIVE_SESSION_IDLE_SECONDS = 15 * 60;
const LOCAL_NATIVE_SESSION_ABSOLUTE_SECONDS = 60 * 60;

type LocalOwnerApprovalMode = "automatic" | "interactive";

type NativeOwnerBrokerFactory = (input: {
  binaryPath: string;
  socketPath: string;
  clock: SecurityClock;
  timeoutMilliseconds: number;
  expectedBinarySha256: string | null;
}) => NativeOwnerBroker;

type PendingLocalOwnerSession = {
  transactionId: string;
  expiresAt: string;
  broker: NativeOwnerBroker | null;
  request: NativeOwnerBrokerRequest;
  assertion: Promise<string> | null;
  platformServerNonce: string | null;
  exchangeStarted: boolean;
  challengeClaimed: boolean;
  browserPublicKey: BrowserPublicKey | null;
};

export type BrowserPublicKey = {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  ext: true;
  key_ops: ["verify"];
};

export type LocalOwnerSessionBeginResult = {
  transactionId: string;
  installationId: string;
  expiresAt: string;
  broker: {
    socketPath: string;
    request: NativeOwnerBrokerRequest;
  } | null;
  platform: {
    protocol: "forge-platform-owner-proof/1";
    serverNonce: string;
    request: NativeOwnerBrokerRequest;
  } | null;
};

export type LocalOwnerSessionExchangeResult = {
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  absoluteExpiresAt: string;
};

export class LocalOwnerSessionCoordinator {
  private readonly pending = new Map<string, PendingLocalOwnerSession>();
  private readonly initializingBrokers = new Set<NativeOwnerBroker>();
  private pendingInitializations = 0;
  private lifecycleGeneration = 0;

  constructor(
    private readonly installationId: string,
    private readonly audience: string,
    private readonly ownerId: string,
    private readonly brokerBinaryPath: string | null,
    private readonly brokerBinarySha256: string | null,
    private readonly socketDirectory: string,
    private readonly clock: SecurityClock,
    private readonly assertions: LocalOwnerAssertionService,
    private readonly ownerChannel: OwnerChannelAuthority,
    private readonly browserSessions: BrowserSessionService,
    private readonly platformOwnerKey: Buffer | null = null,
    private readonly brokerFactory: NativeOwnerBrokerFactory = (input) =>
      new NativeOwnerBroker(
        input.binaryPath,
        input.socketPath,
        input.clock,
        input.timeoutMilliseconds,
        undefined,
        input.expectedBinarySha256
      )
  ) {}

  async begin(input: {
    browserOrigin: string;
    browserNonce: string;
    browserPublicKey?: BrowserPublicKey;
    approvalMode?: LocalOwnerApprovalMode;
  }): Promise<LocalOwnerSessionBeginResult> {
    this.cleanupExpired();
    if (
      this.pending.size + this.pendingInitializations >=
      MAXIMUM_PENDING_LOCAL_OWNER_TRANSACTIONS
    ) {
      throw new HttpError(
        429,
        "local_owner_capacity_exhausted",
        "Forge already has the maximum number of bounded local-owner verifications in progress."
      );
    }
    this.pendingInitializations += 1;
    const lifecycleGeneration = this.lifecycleGeneration;
    try {
      const browserTransaction = input.browserPublicKey !== undefined;
      const approvalMode = input.approvalMode ?? "automatic";
      if (!browserTransaction && input.approvalMode !== undefined) {
        throw new Error(
          "Forge local-owner approval modes apply only to proof-bound browser transactions."
        );
      }
      const interactiveBrowserApproval =
        browserTransaction && approvalMode === "interactive";
      const transaction = this.assertions.begin(
        {
          installId: this.installationId,
          browserOrigin: input.browserOrigin,
          browserNonce: input.browserNonce
        },
        interactiveBrowserApproval
          ? {
              transactionLifetimeSeconds:
                LOCAL_INTERACTIVE_BROWSER_TRANSACTION_SECONDS
            }
          : undefined
      );
      const request: NativeOwnerBrokerRequest = {
        protocol: NATIVE_OWNER_BROKER_PROTOCOL,
        requestId: `owner_${randomUUID()}`,
        transactionId: transaction.transactionId,
        installId: this.installationId,
        browserOrigin: input.browserOrigin,
        browserNonce: input.browserNonce
      };
      if (this.platformOwnerKey) {
        const platformServerNonce = randomBytes(32).toString("base64url");
        this.pending.set(transaction.transactionId, {
          transactionId: transaction.transactionId,
          expiresAt: transaction.expiresAt,
          broker: null,
          request,
          assertion: null,
          platformServerNonce,
          exchangeStarted: false,
          challengeClaimed: false,
          browserPublicKey: input.browserPublicKey ?? null
        });
        return {
          transactionId: transaction.transactionId,
          installationId: this.installationId,
          expiresAt: transaction.expiresAt,
          broker: null,
          platform: {
            protocol: "forge-platform-owner-proof/1",
            serverNonce: platformServerNonce,
            request
          }
        };
      }
      if (!this.brokerBinaryPath) {
        throw new HttpError(
          503,
          "local_owner_channel_unavailable",
          "Forge has no verified local-owner authentication channel."
        );
      }
      await this.ensurePrivateSocketDirectory();
      this.requireActiveLifecycle(lifecycleGeneration);
      const socketPath = path.join(
        this.socketDirectory,
        `o_${createHash("sha256")
          .update(transaction.transactionId)
          .digest("hex")
          .slice(0, 20)}.sock`
      );
      const brokerTimeoutMilliseconds = browserTransaction
        ? interactiveBrowserApproval
          ? LOCAL_INTERACTIVE_BROWSER_BROKER_TIMEOUT_MS
          : LOCAL_AUTOMATIC_BROWSER_BROKER_TIMEOUT_MS
        : LOCAL_NATIVE_SERVICE_BROKER_TIMEOUT_MS;
      const broker = this.brokerFactory({
        binaryPath: this.brokerBinaryPath,
        socketPath,
        clock: this.clock,
        timeoutMilliseconds: brokerTimeoutMilliseconds,
        expectedBinarySha256: this.brokerBinarySha256
      });
      this.initializingBrokers.add(broker);
      let signalReady!: () => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        signalReady = resolve;
        rejectReady = reject;
      });
      const assertion = this.ownerChannel
        .authenticateWithNativeBroker(broker, request, async () => {
          // Only the independently installed local client may invoke `approve`.
          // Returning here lets the HTTP begin response expose the exact bounded
          // request while the server remains blocked in its `serve` role.
          signalReady();
        })
        .then((evidence) =>
          this.assertions.mintFromOwnerChannel({
            transactionId: transaction.transactionId,
            evidence
          })
        )
        .catch((error: unknown) => {
          rejectReady(
            error instanceof Error
              ? error
              : new Error("Forge local-owner verification failed.")
          );
          throw error;
        });
      void assertion.catch(() => undefined);
      try {
        await ready;
        this.requireActiveLifecycle(lifecycleGeneration, broker);
      } catch (error) {
        broker.close();
        throw error;
      } finally {
        this.initializingBrokers.delete(broker);
      }
      this.pending.set(transaction.transactionId, {
        transactionId: transaction.transactionId,
        expiresAt: transaction.expiresAt,
        broker,
        request,
        assertion,
        platformServerNonce: null,
        exchangeStarted: false,
        challengeClaimed: false,
        browserPublicKey: input.browserPublicKey ?? null
      });
      return {
        transactionId: transaction.transactionId,
        installationId: this.installationId,
        expiresAt: transaction.expiresAt,
        broker: {
          socketPath,
          request
        },
        platform: null
      };
    } finally {
      this.pendingInitializations -= 1;
    }
  }

  async exchange(
    input: {
      transactionId: string;
      browserOrigin: string;
      browserNonce: string;
      browserProof?: string;
      ownerProof?: string;
    },
    options: {
      principalKind?: "local_service" | "operator_session";
    } = {}
  ): Promise<LocalOwnerSessionExchangeResult> {
    const pending = this.pending.get(input.transactionId);
    const principalKind = options.principalKind ?? "local_service";
    if (
      !pending ||
      pending.exchangeStarted ||
      Date.parse(pending.expiresAt) <= this.clock.now().getTime() ||
      pending.request.browserOrigin !== input.browserOrigin ||
      pending.request.browserNonce !== input.browserNonce
    ) {
      throw new HttpError(
        401,
        "local_owner_transaction_invalid",
        "The Forge local-owner transaction is missing, expired, or already used."
      );
    }
    if (
      principalKind === "operator_session" &&
      !this.verifyBrowserProof(pending, input.browserProof)
    ) {
      throw new HttpError(
        401,
        "local_owner_browser_proof_invalid",
        "The Forge browser proof is missing or invalid."
      );
    }
    pending.exchangeStarted = true;
    try {
      const assertion = pending.platformServerNonce
        ? await this.platformAssertion(pending, input.ownerProof)
        : await pending.assertion!;
      const verified = await this.assertions.exchange({
        assertion,
        installId: this.installationId,
        browserOrigin: input.browserOrigin,
        browserNonce: input.browserNonce
      });
      return this.browserSessions.create(
        this.localNativePrincipal(
          verified.ownerUserId,
          verified.ownerSecurityEpoch,
          principalKind
        ),
        principalKind === "local_service"
          ? {
              idleLifetimeSeconds: LOCAL_NATIVE_SESSION_IDLE_SECONDS,
              absoluteLifetimeSeconds: LOCAL_NATIVE_SESSION_ABSOLUTE_SECONDS
            }
          : {}
      );
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(
        401,
        "local_owner_verification_failed",
        "Forge could not verify the local operating-system owner."
      );
    } finally {
      this.pending.delete(input.transactionId);
      pending.broker?.close();
    }
  }

  close() {
    this.lifecycleGeneration += 1;
    for (const broker of this.initializingBrokers) {
      broker.close();
    }
    this.initializingBrokers.clear();
    for (const pending of this.pending.values()) {
      pending.broker?.close();
    }
    this.pending.clear();
  }

  private requireActiveLifecycle(
    expectedGeneration: number,
    broker?: NativeOwnerBroker
  ) {
    if (expectedGeneration === this.lifecycleGeneration) {
      return;
    }
    broker?.close();
    throw new HttpError(
      503,
      "local_owner_coordinator_closed",
      "Forge stopped this local-owner verification during runtime shutdown."
    );
  }

  challenge(input: {
    transactionId: string;
    browserOrigin: string;
    browserNonce: string;
  }) {
    const pending = this.pending.get(input.transactionId);
    if (
      !pending ||
      pending.challengeClaimed ||
      Date.parse(pending.expiresAt) <= this.clock.now().getTime() ||
      pending.request.browserOrigin !== input.browserOrigin ||
      pending.request.browserNonce !== input.browserNonce ||
      !pending.broker ||
      !pending.browserPublicKey
    ) {
      throw new HttpError(
        401,
        "local_owner_transaction_invalid",
        "The Forge local-owner transaction is missing, expired, or already used."
      );
    }
    pending.challengeClaimed = true;
    return {
      broker: {
        socketPath: pending.broker.socketPath,
        request: pending.request
      },
      expiresAt: pending.expiresAt
    };
  }

  private localNativePrincipal(
    ownerId: string,
    ownerSecurityEpoch: number,
    principalKind: "local_service" | "operator_session"
  ): ForgePrincipal {
    return {
      kind: principalKind,
      subjectId: ownerId,
      ownerId,
      clientId: null,
      installationId:
        principalKind === "local_service" ? this.installationId : null,
      audience: this.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: this.clock.now().toISOString()
    };
  }

  private cleanupExpired() {
    const now = this.clock.now().getTime();
    for (const [transactionId, pending] of this.pending) {
      if (Date.parse(pending.expiresAt) <= now) {
        pending.broker?.close();
        this.pending.delete(transactionId);
      }
    }
  }

  private verifyBrowserProof(
    pending: PendingLocalOwnerSession,
    browserProof: string | undefined
  ) {
    if (
      !pending.browserPublicKey ||
      !browserProof ||
      !/^[A-Za-z0-9_-]{86}$/.test(browserProof)
    ) {
      return false;
    }
    try {
      const signature = Buffer.from(browserProof, "base64url");
      if (signature.byteLength !== 64) {
        return false;
      }
      const publicKey = createPublicKey({
        key: pending.browserPublicKey,
        format: "jwk"
      });
      return verify(
        "sha256",
        Buffer.from(
          [
            "forge-local-browser-exchange/1",
            pending.transactionId,
            pending.request.browserOrigin,
            pending.request.browserNonce
          ].join("\n"),
          "utf8"
        ),
        {
          key: publicKey,
          dsaEncoding: "ieee-p1363"
        },
        signature
      );
    } catch {
      return false;
    }
  }

  private async ensurePrivateSocketDirectory() {
    await mkdir(this.socketDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.socketDirectory, 0o700);
    const metadata = await lstat(this.socketDirectory);
    const currentUid = process.getuid?.();
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      (metadata.mode & 0o077) !== 0 ||
      (currentUid !== undefined && metadata.uid !== currentUid)
    ) {
      throw new HttpError(
        503,
        "local_owner_socket_directory_unsafe",
        "Forge refused an unsafe local-owner socket directory."
      );
    }
  }

  private async platformAssertion(
    pending: PendingLocalOwnerSession,
    ownerProof: string | undefined
  ) {
    if (
      !this.platformOwnerKey ||
      !pending.platformServerNonce ||
      !ownerProof ||
      !/^[0-9a-f]{64}$/.test(ownerProof)
    ) {
      throw new Error("Forge platform owner proof is missing or malformed.");
    }
    const expected = createHmac("sha256", this.platformOwnerKey)
      .update(
        JSON.stringify({
          protocol: "forge-platform-owner-proof/1",
          serverNonce: pending.platformServerNonce,
          request: pending.request
        })
      )
      .digest();
    const received = Buffer.from(ownerProof, "hex");
    if (
      received.byteLength !== expected.byteLength ||
      !timingSafeEqual(received, expected)
    ) {
      throw new Error("Forge platform owner proof is invalid.");
    }
    const evidence = await this.ownerChannel.authenticateWithPlatform({
      authenticate: async (expectedOwnerUserId) => ({
        ownerUserId: expectedOwnerUserId,
        authenticatedAt: this.clock.now()
      })
    });
    return this.assertions.mintFromOwnerChannel({
      transactionId: pending.transactionId,
      evidence
    });
  }
}
