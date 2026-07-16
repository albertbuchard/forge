import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { InjectOptions } from "fastify";

import { createChannelAuthorization } from "../src/auth.js";
import {
  createConnectivityService,
  type ConnectivityService
} from "../src/app.js";
import { loadConfig, type ConnectivityConfig } from "../src/config.js";
import { encodeBase64Url } from "../src/encoding.js";
import { SafeLogger } from "../src/logger.js";

export class TestClock {
  #nowMs: number;

  public constructor(nowMs = Date.UTC(2026, 6, 15, 12, 0, 0)) {
    this.#nowMs = nowMs;
  }

  public readonly now = (): number => this.#nowMs;

  public advance(milliseconds: number): void {
    this.#nowMs += milliseconds;
  }
}

export interface TestHarness {
  cleanup: () => Promise<void>;
  clock: TestClock;
  config: ConnectivityConfig;
  databasePath: string;
  directory: string;
  keyPair: { privateKey: KeyObject; publicKey: KeyObject };
  logs: string[];
  service: ConnectivityService;
}

export async function createTestHarness(
  environment: NodeJS.ProcessEnv = {},
  clock = new TestClock()
): Promise<TestHarness> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "forge-connectivity-test-")
  );
  const databasePath = path.join(directory, "connectivity.sqlite");
  const config = loadConfig({
    FORGE_CONNECTIVITY_DATABASE_PATH: databasePath,
    FORGE_CONNECTIVITY_LOG_LEVEL: "info",
    FORGE_CONNECTIVITY_CLEANUP_INTERVAL_SECONDS: "3600",
    ...environment
  });
  const logs: string[] = [];
  const logger = new SafeLogger("info", (line) => logs.push(line), clock.now);
  const service = await createConnectivityService({
    clock: clock.now,
    config,
    logger
  });
  const keyPair = generateKeyPairSync("ed25519");
  let closed = false;

  return {
    cleanup: async () => {
      if (!closed) {
        await service.close();
        closed = true;
      }
      await rm(directory, { force: true, recursive: true });
    },
    clock,
    config,
    databasePath,
    directory,
    keyPair,
    logs,
    service
  };
}

export interface SignedInjectInput {
  body?: unknown;
  idempotencyKey?: string;
  keyPair?: { privateKey: KeyObject; publicKey: KeyObject };
  method: "DELETE" | "GET" | "POST" | "PUT";
  nonce?: Uint8Array;
  url: string;
}

export function signedInject(harness: TestHarness, input: SignedInjectInput) {
  const headers = signedHeaders(harness, input);
  const options: InjectOptions = {
    method: input.method,
    url: input.url,
    headers
  };
  if (input.body === undefined) {
    return harness.service.app.inject(options);
  }
  return harness.service.app.inject({
    ...options,
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(input.body)
  });
}

export function signedHeaders(
  harness: TestHarness,
  input: SignedInjectInput
): Record<string, string> {
  const keyPair = input.keyPair ?? harness.keyPair;
  const signed = createChannelAuthorization({
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
    method: input.method,
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
    nowMs: harness.clock.now(),
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    url: input.url
  });
  return {
    authorization: signed.authorization,
    ...(input.idempotencyKey === undefined
      ? {}
      : { "idempotency-key": input.idempotencyKey })
  };
}

export function opaqueId(label: string): string {
  return createHash("sha256").update(label).digest("base64url");
}

export function ciphertextFixture(label: string, byteLength = 64): string {
  const chunks: Buffer[] = [];
  let counter = 0;
  while (Buffer.concat(chunks).length < byteLength) {
    chunks.push(createHash("sha256").update(`${label}:${counter}`).digest());
    counter += 1;
  }
  return encodeBase64Url(Buffer.concat(chunks).subarray(0, byteLength));
}

export async function waitForTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}
