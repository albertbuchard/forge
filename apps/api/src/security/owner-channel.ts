import type { Stats } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";

import type { SecurityClock } from "./security-runtime.js";

declare const verifiedOwnerChannelBrand: unique symbol;
declare const nativeOwnerBrokerReceiptBrand: unique symbol;

export const NATIVE_OWNER_BROKER_PROTOCOL = "forge-owner-broker/1";

export type VerifiedOwnerChannel = {
  readonly ownerUserId: string;
  readonly transport: "native_owner_broker" | "platform_os_auth";
  readonly verifiedAt: string;
  readonly [verifiedOwnerChannelBrand]: true;
};

export type NativeOwnerBrokerRequest = {
  protocol: typeof NATIVE_OWNER_BROKER_PROTOCOL;
  requestId: string;
  transactionId: string;
  installId: string;
  browserOrigin: string;
  browserNonce: string;
};

type NativeOwnerBrokerReceipt = {
  readonly requestId: string;
  readonly peerUid: number;
  readonly verifiedAt: string;
  readonly [nativeOwnerBrokerReceiptBrand]: true;
};

export type PlatformOwnerAuthenticationAdapter = {
  authenticate(expectedOwnerUserId: string): Promise<{
    ownerUserId: string;
    authenticatedAt: Date;
  }>;
};

export type NativeOwnerHelperLauncher = (input: {
  binaryPath: string;
  socketPath: string;
  request: NativeOwnerBrokerRequest;
}) => Promise<void>;

type NativeOwnerBrokerMetadataReader = (target: string) => Promise<Stats>;

type BrokerEvent =
  | { event: "ready"; protocol: string }
  | { event: "verified"; requestId: string; peerUid: number };

const MAXIMUM_BROKER_DIAGNOSTIC_CHARACTERS = 2_048;

class BoundedBrokerDiagnostic {
  private value = "";
  private truncated = false;

  append(chunk: string) {
    const printable = chunk.replace(/[^\x20-\x7E]/g, "?");
    const remaining = MAXIMUM_BROKER_DIAGNOSTIC_CHARACTERS - this.value.length;
    if (remaining > 0) {
      this.value += printable.slice(0, remaining);
    }
    if (printable.length > remaining) {
      this.truncated = true;
    }
  }

  suffix() {
    const bounded = this.value.trim();
    return bounded
      ? ` Broker stderr: ${bounded}${this.truncated ? "…" : ""}`
      : "";
  }
}

function validateNativeOwnerRequest(request: NativeOwnerBrokerRequest) {
  const identifier = /^[A-Za-z0-9._-]+$/;
  if (
    request.protocol !== NATIVE_OWNER_BROKER_PROTOCOL ||
    request.requestId.length < 16 ||
    request.requestId.length > 128 ||
    !identifier.test(request.requestId) ||
    request.transactionId.length < 16 ||
    request.transactionId.length > 160 ||
    !identifier.test(request.transactionId) ||
    request.installId.length < 1 ||
    request.installId.length > 128 ||
    !identifier.test(request.installId) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(request.browserNonce)
  ) {
    throw new Error("Forge native owner request is malformed or unbounded.");
  }
  const origin = new URL(request.browserOrigin);
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      origin.hostname.toLowerCase()
    ) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.origin !== request.browserOrigin
  ) {
    throw new Error(
      "Forge native owner request requires an exact loopback browser origin."
    );
  }
}

function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string | (() => string)
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(typeof message === "function" ? message() : message)),
      milliseconds
    );
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function brokerEvents(child: ChildProcessWithoutNullStreams) {
  const diagnostic = new BoundedBrokerDiagnostic();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    diagnostic.append(chunk);
  });
  let readyResolve!: (event: BrokerEvent & { event: "ready" }) => void;
  let readyReject!: (error: Error) => void;
  let verifiedResolve!: (event: BrokerEvent & { event: "verified" }) => void;
  let verifiedReject!: (error: Error) => void;
  const ready = new Promise<BrokerEvent & { event: "ready" }>(
    (resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    }
  );
  const verified = new Promise<BrokerEvent & { event: "verified" }>(
    (resolve, reject) => {
      verifiedResolve = resolve;
      verifiedReject = reject;
    }
  );
  let settledReady = false;
  let settledVerified = false;
  const withDiagnostic = (error: Error) =>
    new Error(`${error.message}${diagnostic.suffix()}`, { cause: error });
  const fail = (error: Error) => {
    if (!settledReady) {
      settledReady = true;
      readyReject(error);
    }
    if (!settledVerified) {
      settledVerified = true;
      verifiedReject(error);
    }
  };
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (line.length > 1_024) {
      fail(
        withDiagnostic(
          new Error("Forge native owner broker emitted an oversized event.")
        )
      );
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      fail(
        withDiagnostic(
          new Error("Forge native owner broker emitted invalid JSON.")
        )
      );
      return;
    }
    if (typeof event !== "object" || event === null || !("event" in event)) {
      fail(
        withDiagnostic(
          new Error("Forge native owner broker event is malformed.")
        )
      );
      return;
    }
    if (
      event.event === "ready" &&
      "protocol" in event &&
      event.protocol === NATIVE_OWNER_BROKER_PROTOCOL &&
      !settledReady
    ) {
      settledReady = true;
      readyResolve(event as BrokerEvent & { event: "ready" });
      return;
    }
    if (
      event.event === "verified" &&
      "requestId" in event &&
      typeof event.requestId === "string" &&
      "peerUid" in event &&
      Number.isSafeInteger(event.peerUid) &&
      !settledVerified
    ) {
      settledVerified = true;
      verifiedResolve(event as BrokerEvent & { event: "verified" });
      return;
    }
    fail(
      withDiagnostic(
        new Error("Forge native owner broker emitted an unexpected event.")
      )
    );
  });
  child.once("error", (error) => fail(withDiagnostic(error)));
  child.once("close", (code) => {
    if (code !== 0 || !settledVerified) {
      fail(
        withDiagnostic(
          new Error(
            `Forge native owner broker exited before verification (${code === null ? "signal" : `code ${code}`}).`
          )
        )
      );
    }
  });
  void ready.catch(() => undefined);
  void verified.catch(() => undefined);
  return {
    ready,
    verified,
    diagnosticSuffix: () => diagnostic.suffix(),
    withDiagnostic
  };
}

export class NativeOwnerBroker {
  private readonly unusedReceipts = new WeakSet<object>();
  private activeChild: ChildProcessWithoutNullStreams | null = null;

  constructor(
    readonly binaryPath: string,
    readonly socketPath: string,
    private readonly clock: SecurityClock,
    private readonly timeoutMilliseconds = 15_000,
    private readonly metadataReader: NativeOwnerBrokerMetadataReader = lstat,
    private readonly expectedBinarySha256: string | null = null
  ) {}

  async authenticate(
    request: NativeOwnerBrokerRequest,
    launchOwnerHelper: NativeOwnerHelperLauncher
  ) {
    validateNativeOwnerRequest(request);
    await this.verifyBinary();
    if (this.activeChild) {
      throw new Error("Forge native owner broker is already active.");
    }
    const child = spawn(
      this.binaryPath,
      ["serve", "--socket", this.socketPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {}
      }
    );
    this.activeChild = child;
    const events = brokerEvents(child);
    try {
      child.stdin.end(JSON.stringify(request));
      await within(
        events.ready,
        this.timeoutMilliseconds,
        () =>
          `Forge native owner broker did not become ready.${events.diagnosticSuffix()}`
      );
      try {
        await within(
          launchOwnerHelper({
            binaryPath: this.binaryPath,
            socketPath: this.socketPath,
            request
          }),
          this.timeoutMilliseconds,
          "Forge local owner helper did not complete."
        );
      } catch (error) {
        throw events.withDiagnostic(
          error instanceof Error
            ? error
            : new Error("Forge local owner helper failed.")
        );
      }
      const verified = await within(
        events.verified,
        this.timeoutMilliseconds,
        () =>
          `Forge native owner verification timed out.${events.diagnosticSuffix()}`
      );
      if (verified.requestId !== request.requestId) {
        throw new Error(
          "Forge native owner broker verified another local transaction."
        );
      }
      const receipt = {
        requestId: verified.requestId,
        peerUid: verified.peerUid,
        verifiedAt: this.clock.now().toISOString()
      } as NativeOwnerBrokerReceipt;
      this.unusedReceipts.add(receipt);
      return receipt;
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
      if (this.activeChild === child) {
        this.activeChild = null;
      }
    }
  }

  close() {
    if (this.activeChild?.exitCode === null) {
      this.activeChild.kill("SIGTERM");
    }
    this.activeChild = null;
  }

  consume(
    receipt: NativeOwnerBrokerReceipt,
    expectedRequestId: string,
    expectedOwnerUid: number
  ) {
    if (
      !this.unusedReceipts.delete(receipt) ||
      receipt.requestId !== expectedRequestId ||
      receipt.peerUid !== expectedOwnerUid
    ) {
      throw new Error(
        "Forge native owner evidence is forged, replayed, or belongs to another OS account."
      );
    }
    return receipt;
  }

  private async verifyBinary() {
    if (!this.binaryPath.startsWith("/") || !this.socketPath.startsWith("/")) {
      throw new Error(
        "Forge native owner broker requires absolute binary and socket paths."
      );
    }
    const metadata = await this.metadataReader(this.binaryPath);
    const currentUid = process.getuid?.();
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o022) !== 0 ||
      (metadata.mode & 0o111) === 0 ||
      (currentUid !== undefined &&
        metadata.uid !== currentUid &&
        metadata.uid !== 0)
    ) {
      throw new Error(
        "Forge native owner broker binary is not a trusted, non-writable executable."
      );
    }
    let ancestor = path.dirname(this.binaryPath);
    while (true) {
      const ancestorMetadata = await this.metadataReader(ancestor);
      if (
        !ancestorMetadata.isDirectory() ||
        ancestorMetadata.isSymbolicLink() ||
        (ancestorMetadata.mode & 0o022) !== 0 ||
        (currentUid !== undefined &&
          ancestorMetadata.uid !== currentUid &&
          ancestorMetadata.uid !== 0)
      ) {
        throw new Error(
          "Forge native owner broker path traverses an unsafe writable, untrusted-owner, or symlinked directory."
        );
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        break;
      }
      ancestor = parent;
    }
    if (this.expectedBinarySha256) {
      if (!/^[0-9a-f]{64}$/.test(this.expectedBinarySha256)) {
        throw new Error(
          "Forge native owner broker has an invalid expected digest."
        );
      }
      const digest = createHash("sha256")
        .update(await readFile(this.binaryPath))
        .digest("hex");
      if (digest !== this.expectedBinarySha256) {
        throw new Error(
          "Forge native owner broker does not match its verified installer receipt."
        );
      }
    }
  }
}

export class OwnerChannelAuthority {
  private readonly issuedEvidence = new WeakSet<object>();

  constructor(
    private readonly clock: SecurityClock,
    readonly ownerUserId: string,
    readonly ownerUid: number = process.getuid?.() ?? Number(ownerUserId)
  ) {}

  assertVerified(evidence: VerifiedOwnerChannel) {
    if (
      !this.issuedEvidence.delete(evidence) ||
      evidence.ownerUserId !== this.ownerUserId
    ) {
      throw new Error(
        "Forge owner-channel evidence was not issued by the trusted OS boundary or was replayed."
      );
    }
    const verifiedAt = Date.parse(evidence.verifiedAt);
    if (
      !Number.isFinite(verifiedAt) ||
      Math.abs(this.clock.now().getTime() - verifiedAt) > 60_000
    ) {
      throw new Error("Forge owner-channel evidence is stale.");
    }
  }

  async authenticateWithPlatform(
    adapter: PlatformOwnerAuthenticationAdapter
  ): Promise<VerifiedOwnerChannel> {
    const result = await adapter.authenticate(this.ownerUserId);
    if (
      result.ownerUserId !== this.ownerUserId ||
      Math.abs(this.clock.now().getTime() - result.authenticatedAt.getTime()) >
        60_000
    ) {
      throw new Error(
        "Forge platform authentication did not verify the owner."
      );
    }
    return this.issue("platform_os_auth", result.authenticatedAt);
  }

  async authenticateWithNativeBroker(
    broker: NativeOwnerBroker,
    request: NativeOwnerBrokerRequest,
    launchOwnerHelper: NativeOwnerHelperLauncher
  ) {
    if (!Number.isSafeInteger(this.ownerUid) || this.ownerUid < 0) {
      throw new Error(
        "Forge owner authority has no valid expected OS user identifier."
      );
    }
    const receipt = await broker.authenticate(request, launchOwnerHelper);
    broker.consume(receipt, request.requestId, this.ownerUid);
    return this.issue("native_owner_broker", new Date(receipt.verifiedAt));
  }

  private issue(
    transport: VerifiedOwnerChannel["transport"],
    verifiedAt: Date
  ): VerifiedOwnerChannel {
    const evidence = {
      ownerUserId: this.ownerUserId,
      transport,
      verifiedAt: verifiedAt.toISOString()
    } as VerifiedOwnerChannel;
    this.issuedEvidence.add(evidence);
    return evidence;
  }
}
