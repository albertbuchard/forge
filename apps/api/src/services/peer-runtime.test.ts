import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type {
  PeerCoreGateway,
  PeerLocalIdentity
} from "./peer-core-gateway.js";
import type { PeerDaemonSupervisorSnapshot } from "./peer-daemon-supervisor.js";
import type { PeerDaemonSupervisorConfig } from "./peer-daemon-supervisor.js";
import type { PeerCommandAuthorizer } from "./peer-command-authorization.js";
import {
  DelegatingPeerCoreGateway,
  PeerRuntimeStartupError,
  resolvePeerRuntimeConfiguration,
  startPeerRuntime,
  type PeerRuntimeLaunchDependencies,
  type PeerRuntimeSupervisor
} from "./peer-runtime.js";

const ownerUserId = "user_peer_runtime_test";
const dataDir = "/var/lib/forge-test";
const authorityKeyId = "A".repeat(43);

function fakeCommandAuthorizer(
  input?: Parameters<
    NonNullable<PeerRuntimeLaunchDependencies["createCommandAuthorizer"]>
  >[0]
): PeerCommandAuthorizer {
  const authorizerOwnerUserId = input?.ownerUserId ?? ownerUserId;
  return {
    publicKeyBase64Url: Buffer.alloc(32, 7).toString("base64url"),
    authorityKeyId,
    async initialize() {
      return {
        protocol: "forge-peer-command-authority-state/v1",
        authorityKeyId,
        ownerUserId: authorizerOwnerUserId,
        epoch: "0",
        invalidatedBefore: "1970-01-01T00:00:00.000Z",
        revokedAuthorizationIds: [],
        revokedSessionIds: [],
        revokedDeviceIds: [],
        signature: "S".repeat(86)
      };
    },
    async authorize(input) {
      return {
        protocol: "forge-peer-command-authorization/v1",
        authorityKeyId,
        authorizationId: `pca_${input.commandId}`,
        ownerUserId: input.ownerUserId,
        actor: {
          class: input.approval.actorClass,
          actorId: input.approval.actorId,
          sessionId: input.approval.sessionId,
          deviceId: input.approval.deviceId
        },
        capability: {
          kind: "human_approval",
          capabilityId: input.approval.capabilityId,
          actionDigest: input.approval.actionDigest,
          state: "consumed",
          issuedAt: input.approval.capabilityIssuedAt,
          expiresAt: input.approval.capabilityExpiresAt
        },
        action: input.action,
        commandId: input.commandId,
        commandDigest: input.commandDigest,
        approvalDeadline: input.approvalDeadline,
        issuedAt: input.approval.authorizationIssuedAt,
        invalidationEpoch: "0",
        signature: "S".repeat(86)
      };
    }
  };
}

function readySnapshot(): PeerDaemonSupervisorSnapshot {
  return {
    enabled: true,
    state: "ready",
    pid: 123,
    restartCount: 0,
    restartsInWindow: 0,
    circuitOpen: false,
    startedAt: "2026-07-15T10:00:00.000Z",
    readyAt: "2026-07-15T10:00:01.000Z",
    nextRestartAt: null,
    lastExit: null,
    lastError: null,
    stderrTail: null
  };
}

function stoppedSnapshot(): PeerDaemonSupervisorSnapshot {
  return { ...readySnapshot(), state: "stopped", pid: null };
}

function localIdentity(identityOwnerUserId = ownerUserId): PeerLocalIdentity {
  return {
    principal: {
      id: "a".repeat(64),
      rootPublicKey: Buffer.alloc(32, 1).toString("base64url"),
      trustState: "verified",
      certificateHash: "b".repeat(64)
    },
    device: {
      id: "c".repeat(64),
      principalId: "a".repeat(64),
      signingPublicKey: Buffer.alloc(32, 2).toString("base64url"),
      keyAgreementPublicKey: Buffer.alloc(32, 3).toString("base64url"),
      certificateSerial: "1",
      certificate: Buffer.alloc(96, 4).toString("base64url"),
      certificateHash: "b".repeat(64),
      capabilities: ["direct_stream", "query", "projection"],
      transportEndpoints: [
        { kind: "local_direct", host: "100.64.0.4", port: 4318 }
      ],
      status: "approved"
    },
    provenance: {
      protocolVersion: "forge-peer/1",
      ownerUserId: identityOwnerUserId,
      relationshipId: null,
      localPrincipalId: "a".repeat(64),
      localDeviceId: "c".repeat(64),
      remotePrincipalId: null,
      remoteDeviceId: null,
      evidenceHash: "d".repeat(64),
      authenticatedAt: "2026-07-15T10:00:01.000Z"
    }
  };
}

function enabledEnvironment(
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    FORGE_PEER_ENABLED: "1",
    FORGE_PEER_BIN: "/opt/forge/bin/forge-peer",
    FORGE_PEER_ENABLE_IROH: "0",
    FORGE_PEER_DIRECT_ENDPOINTS: "100.64.0.4:4318,[fd7a:115c:a1e0::4]:4318",
    ...overrides
  };
}

function fakeGateway(identity = localIdentity()): PeerCoreGateway {
  return {
    health: async () => ({
      enabled: true,
      healthy: true,
      protocolVersion: "forge-peer/1",
      reason: null
    }),
    localIdentity: async () => identity,
    syncCommandAuthorizationState: async () => ({
      commandId: "authority-state-0-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorityKeyId,
      invalidationEpoch: "0",
      stateHash: "a".repeat(64),
      committedAt: "2026-07-15T10:00:00.000Z",
      authorization: {
        authorityKeyId,
        authorizationId: null,
        actorClass: null,
        actorId: null,
        actorDeviceId: null,
        sessionId: null,
        capabilityId: null,
        actionDigest: null,
        invalidationEpoch: "0",
        authorityStateHash: "a".repeat(64),
        verifiedAt: "2026-07-15T10:00:00.000Z"
      },
      provenance: identity.provenance
    })
  } as unknown as PeerCoreGateway;
}

function fakeSupervisor(
  input: {
    startError?: Error;
    onStart?: () => void;
    onStop?: () => void;
  } = {}
): PeerRuntimeSupervisor {
  return {
    async start() {
      input.onStart?.();
      if (input.startError) throw input.startError;
      return readySnapshot();
    },
    async stop() {
      input.onStop?.();
      return stoppedSnapshot();
    }
  };
}

test("peer runtime is disabled unless the operator enables it explicitly", async () => {
  let factoryCalls = 0;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: {},
      createSupervisor: () => {
        factoryCalls += 1;
        return fakeSupervisor();
      },
      createGateway: () => {
        factoryCalls += 1;
        return fakeGateway();
      }
    }
  });

  assert.equal(runtime.configured, false);
  assert.equal(runtime.required, false);
  assert.equal(runtime.failure, null);
  assert.equal(factoryCalls, 0);
  assert.deepEqual(await runtime.gateway.health(), {
    enabled: false,
    healthy: false,
    protocolVersion: null,
    reason: "The forge-peer daemon is not configured."
  });
  await runtime.stop();
});

test("delegating gateway activates exactly one runtime after route construction", async () => {
  const identity = localIdentity();
  const delegate = new DelegatingPeerCoreGateway();
  assert.equal((await delegate.health()).enabled, false);

  delegate.activate(fakeGateway(identity));
  assert.equal((await delegate.health()).healthy, true);
  assert.deepEqual(await delegate.localIdentity({ ownerUserId }), identity);
  assert.throws(
    () => delegate.activate(fakeGateway()),
    /already been activated/
  );
});

test("runtime configuration derives bounded private defaults and exact endpoints", async () => {
  const configuration = await resolvePeerRuntimeConfiguration({
    ownerUserId,
    dataDir,
    environment: enabledEnvironment({
      FORGE_PEER_ALLOW_LOOPBACK_DIRECT: "1"
    }),
    resolveTemporaryDirectory: async () => "/private/tmp"
  });

  assert.equal(configuration.enabled, true);
  assert.equal(configuration.required, false);
  assert.equal(configuration.supervisor.enabled, true);
  if (!configuration.supervisor.enabled) assert.fail("runtime must be enabled");
  assert.equal(
    configuration.supervisor.binaryPath,
    "/opt/forge/bin/forge-peer"
  );
  assert.match(
    configuration.supervisor.stateDir,
    new RegExp(`^${path.join(dataDir, "peer")}/[a-f0-9]{16}$`)
  );
  assert.match(
    configuration.supervisor.socketPath,
    /^\/private\/tmp\/forge-peer-\d+-[a-f0-9]{16}\/control\.sock$/
  );
  assert.ok(Buffer.byteLength(configuration.supervisor.socketPath) <= 103);
  assert.deepEqual(configuration.supervisor.directEndpoints, [
    "100.64.0.4:4318",
    "[fd7a:115c:a1e0::4]:4318"
  ]);
  assert.equal(configuration.supervisor.irohEnabled, false);
  assert.deepEqual(configuration.supervisor.tor, { enabled: false });
  assert.deepEqual(configuration.supervisor.httpMailbox, { enabled: false });
  assert.equal(configuration.supervisor.allowLoopbackDirect, true);
});

test("runtime configuration exposes an owner-routed Tor-only provider", async () => {
  const configuration = await resolvePeerRuntimeConfiguration({
    ownerUserId,
    dataDir,
    environment: enabledEnvironment({
      FORGE_PEER_DIRECT_ENDPOINTS: "",
      FORGE_PEER_ENABLE_TOR: "1",
      FORGE_PEER_TOR_BIN: "/opt/tor/bin/tor",
      FORGE_PEER_TOR_DATA_DIR: "/var/lib/forge-tor",
      FORGE_PEER_TOR_SOCKS_ENDPOINT: "127.0.0.1:9050",
      FORGE_PEER_TOR_VIRTUAL_PORT: "8443",
      FORGE_PEER_TOR_RESTART_LIMIT: "4",
      FORGE_PEER_TOR_MINIMUM_RESTART_BACKOFF_MS: "500",
      FORGE_PEER_TOR_MAXIMUM_RESTART_BACKOFF_MS: "5000"
    }),
    resolveTemporaryDirectory: async () => "/private/tmp"
  });

  assert.equal(configuration.supervisor.enabled, true);
  if (!configuration.supervisor.enabled) assert.fail("runtime must be enabled");
  assert.deepEqual(configuration.supervisor.directEndpoints, []);
  assert.equal(configuration.supervisor.irohEnabled, false);
  const tor = configuration.supervisor.tor;
  assert.equal(tor?.enabled, true);
  if (!tor?.enabled) assert.fail("Tor must be enabled");
  assert.equal(tor.executablePath, "/opt/tor/bin/tor");
  assert.equal(tor.socksEndpoint, "127.0.0.1:9050");
  assert.equal(tor.virtualPort, 8443);
  assert.match(tor.dataDir, /^\/var\/lib\/forge-tor\/[a-f0-9]{16}$/);
  assert.deepEqual(configuration.supervisor.httpMailbox, { enabled: false });
});

test("runtime configuration exposes an optional mailbox-only provider", async () => {
  const configuration = await resolvePeerRuntimeConfiguration({
    ownerUserId,
    dataDir,
    environment: enabledEnvironment({
      FORGE_PEER_DIRECT_ENDPOINTS: "",
      FORGE_PEER_ENABLE_HTTP_MAILBOX: "1",
      FORGE_PEER_HTTP_MAILBOX_ORIGIN: "https://mailbox.example",
      FORGE_PEER_HTTP_MAILBOX_POLL_INTERVAL_MS: "2000"
    }),
    resolveTemporaryDirectory: async () => "/private/tmp"
  });

  assert.equal(configuration.supervisor.enabled, true);
  if (!configuration.supervisor.enabled) assert.fail("runtime must be enabled");
  assert.deepEqual(configuration.supervisor.directEndpoints, []);
  const httpMailbox = configuration.supervisor.httpMailbox;
  assert.equal(httpMailbox?.enabled, true);
  if (!httpMailbox?.enabled) {
    assert.fail("HTTP mailbox must be enabled");
  }
  assert.equal(httpMailbox.origin, "https://mailbox.example");
  assert.equal(httpMailbox.pollIntervalMs, 2_000);
  assert.equal(httpMailbox.caFile, undefined);
});

test("provider options fail closed when disabled or malformed", async () => {
  await assert.rejects(
    resolvePeerRuntimeConfiguration({
      ownerUserId,
      dataDir,
      environment: enabledEnvironment({
        FORGE_PEER_TOR_SOCKS_ENDPOINT: "127.0.0.1:9050"
      })
    }),
    /Tor options require its explicit enable flag/
  );
  await assert.rejects(
    resolvePeerRuntimeConfiguration({
      ownerUserId,
      dataDir,
      environment: enabledEnvironment({
        FORGE_PEER_ENABLE_TOR: "1",
        FORGE_PEER_TOR_BIN: "/opt/tor/bin/tor",
        FORGE_PEER_TOR_SOCKS_ENDPOINT: "192.0.2.20:9050"
      })
    }),
    /loopback IP socket/
  );
  await assert.rejects(
    resolvePeerRuntimeConfiguration({
      ownerUserId,
      dataDir,
      environment: enabledEnvironment({
        FORGE_PEER_ENABLE_HTTP_MAILBOX: "1",
        FORGE_PEER_HTTP_MAILBOX_ORIGIN:
          "https://credential:secret@mailbox.example"
      })
    }),
    /canonical HTTPS origin/
  );
  await assert.rejects(
    resolvePeerRuntimeConfiguration({
      ownerUserId,
      dataDir,
      environment: enabledEnvironment({
        FORGE_PEER_ENABLE_HTTP_MAILBOX: "1",
        FORGE_PEER_HTTP_MAILBOX_ORIGIN: "https://127.0.0.1:9443",
        FORGE_PEER_HTTP_MAILBOX_ALLOW_LOOPBACK_ORIGIN: "1"
      })
    }),
    /requires FORGE_PEER_HTTP_MAILBOX_CA_FILE/
  );
  await assert.rejects(
    resolvePeerRuntimeConfiguration({
      ownerUserId,
      dataDir,
      environment: {
        FORGE_PEER_ENABLED: "0",
        FORGE_PEER_ENABLE_TOR: "1"
      }
    }),
    /cannot be enabled while forge-peer is disabled/
  );
});

test("runtime configuration accepts enabled Iroh without a direct endpoint", async () => {
  const configuration = await resolvePeerRuntimeConfiguration({
    ownerUserId,
    dataDir,
    environment: enabledEnvironment({
      FORGE_PEER_ENABLE_IROH: "1",
      FORGE_PEER_DIRECT_ENDPOINTS: ""
    }),
    resolveTemporaryDirectory: async () => "/private/tmp"
  });

  assert.equal(configuration.supervisor.enabled, true);
  if (!configuration.supervisor.enabled) assert.fail("runtime must be enabled");
  assert.equal(configuration.supervisor.irohEnabled, true);
  assert.deepEqual(configuration.supervisor.directEndpoints, []);
});

test("Iroh enablement rejects non-binary values", async () => {
  await assert.rejects(
    resolvePeerRuntimeConfiguration({
      ownerUserId,
      dataDir,
      environment: enabledEnvironment({ FORGE_PEER_ENABLE_IROH: "true" }),
      resolveTemporaryDirectory: async () => "/private/tmp"
    }),
    (error: unknown) =>
      error instanceof PeerRuntimeStartupError &&
      error.code === "configuration" &&
      /FORGE_PEER_ENABLE_IROH must be exactly 0 or 1/.test(error.message)
  );
});

test("Iroh readiness requires the authenticated daemon identity to expose Iroh", async () => {
  let stops = 0;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: enabledEnvironment({
        FORGE_PEER_ENABLE_IROH: "1",
        FORGE_PEER_DIRECT_ENDPOINTS: ""
      }),
      resolveTemporaryDirectory: async () => "/private/tmp",
      createCommandAuthorizer: fakeCommandAuthorizer,
      createSupervisor: () =>
        fakeSupervisor({
          onStop: () => {
            stops += 1;
          }
        }),
      createGateway: () => fakeGateway()
    }
  });

  assert.equal(runtime.failure, "startup");
  assert.equal(stops, 1);
  assert.equal((await runtime.gateway.health()).healthy, false);
});

test("enabled Iroh with no direct endpoint passes authenticated readiness", async () => {
  const identity = localIdentity();
  identity.device.capabilities = [
    "direct_stream",
    "iroh",
    "http_mailbox",
    "query",
    "projection"
  ];
  identity.device.transportEndpoints = [
    {
      kind: "iroh",
      endpointId: Buffer.alloc(32, 7).toString("base64url"),
      relayOrigin: null
    }
  ];
  let persisted = false;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: enabledEnvironment({
        FORGE_PEER_ENABLE_IROH: "1",
        FORGE_PEER_DIRECT_ENDPOINTS: ""
      }),
      resolveTemporaryDirectory: async () => "/private/tmp",
      createCommandAuthorizer: fakeCommandAuthorizer,
      createSupervisor: () => fakeSupervisor(),
      createGateway: () => fakeGateway(identity),
      persistIdentity: () => {
        persisted = true;
        return {
          principalId: identity.principal.id,
          deviceId: identity.device.id
        };
      }
    }
  });

  try {
    assert.equal(runtime.failure, null);
    assert.equal(persisted, true);
  } finally {
    await runtime.stop();
  }
});

test("invalid enable flags fail instead of silently changing the trust boundary", async () => {
  await assert.rejects(
    startPeerRuntime({
      ownerUserId,
      dataDir,
      dependencies: { environment: { FORGE_PEER_ENABLED: "true" } }
    }),
    (error: unknown) =>
      error instanceof PeerRuntimeStartupError &&
      error.code === "configuration" &&
      /exactly 0 or 1/.test(error.message)
  );
});

test("required cannot be enabled behind a disabled runtime", async () => {
  await assert.rejects(
    startPeerRuntime({
      ownerUserId,
      dataDir,
      dependencies: {
        environment: {
          FORGE_PEER_ENABLED: "0",
          FORGE_PEER_REQUIRED: "1"
        }
      }
    }),
    (error: unknown) =>
      error instanceof PeerRuntimeStartupError && error.code === "configuration"
  );
});

test("optional malformed configuration is observable but does not start anything", async () => {
  let factoryCalls = 0;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: { FORGE_PEER_ENABLED: "1" },
      createSupervisor: () => {
        factoryCalls += 1;
        return fakeSupervisor();
      }
    }
  });

  assert.equal(runtime.configured, true);
  assert.equal(runtime.failure, "configuration");
  assert.equal(factoryCalls, 0);
  assert.deepEqual(await runtime.gateway.health(), {
    enabled: true,
    healthy: false,
    protocolVersion: null,
    reason: "The forge-peer daemon configuration is invalid."
  });
});

test("required malformed configuration stops server construction", async () => {
  await assert.rejects(
    startPeerRuntime({
      ownerUserId,
      dataDir,
      dependencies: {
        environment: {
          FORGE_PEER_ENABLED: "1",
          FORGE_PEER_REQUIRED: "1"
        }
      }
    }),
    (error: unknown) =>
      error instanceof PeerRuntimeStartupError && error.code === "configuration"
  );
});

test("successful startup persists only the authenticated daemon identity", async () => {
  const identity = localIdentity();
  const commandAuthorizer = fakeCommandAuthorizer();
  let capturedSocketPath = "";
  let capturedGatewayInput: {
    socketPath: string;
    ownerUserId: string;
    commandAuthorizer: PeerCommandAuthorizer;
  } | null = null;
  let starts = 0;
  let stops = 0;
  let persistenceCalls = 0;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: enabledEnvironment(),
      resolveTemporaryDirectory: async () => "/private/tmp",
      createCommandAuthorizer: () => commandAuthorizer,
      createSupervisor: (config) => {
        assert.equal(config.enabled, true);
        if (!config.enabled) assert.fail("runtime must be enabled");
        assert.equal(
          config.commandAuthorityPublicKey,
          commandAuthorizer.publicKeyBase64Url
        );
        capturedSocketPath = config.socketPath;
        return fakeSupervisor({
          onStart: () => {
            starts += 1;
          },
          onStop: () => {
            stops += 1;
          }
        });
      },
      createGateway: (gatewayInput) => {
        capturedGatewayInput = gatewayInput;
        return fakeGateway(identity);
      },
      persistIdentity: async (input) => {
        persistenceCalls += 1;
        assert.equal(input.ownerUserId, ownerUserId);
        assert.deepEqual(input.identity, identity);
        return {
          principalId: identity.principal.id,
          deviceId: identity.device.id
        };
      }
    }
  });

  assert.equal(runtime.configured, true);
  assert.equal(runtime.failure, null);
  assert.equal(starts, 1);
  assert.equal(persistenceCalls, 1);
  assert.notEqual(capturedSocketPath, "");
  assert.deepEqual(capturedGatewayInput, {
    socketPath: capturedSocketPath,
    ownerUserId,
    commandAuthorizer
  });
  assert.deepEqual(
    await runtime.gateway.localIdentity({ ownerUserId }),
    identity
  );
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(stops, 1);
});

test("optional daemon failure stops the process and exposes no active gateway", async () => {
  let stops = 0;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: enabledEnvironment(),
      resolveTemporaryDirectory: async () => "/private/tmp",
      createCommandAuthorizer: fakeCommandAuthorizer,
      createSupervisor: () =>
        fakeSupervisor({
          startError: new Error("sensitive child detail"),
          onStop: () => {
            stops += 1;
          }
        }),
      createGateway: () => fakeGateway()
    }
  });

  assert.equal(runtime.failure, "startup");
  assert.equal(stops, 1);
  assert.equal(
    (await runtime.gateway.health()).reason,
    "The forge-peer daemon did not pass its startup checks."
  );
  await runtime.stop();
  assert.equal(stops, 1);
});

test("identity persistence failure stops an otherwise-ready daemon", async () => {
  let stops = 0;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: enabledEnvironment(),
      resolveTemporaryDirectory: async () => "/private/tmp",
      createCommandAuthorizer: fakeCommandAuthorizer,
      createSupervisor: () =>
        fakeSupervisor({
          onStop: () => {
            stops += 1;
          }
        }),
      createGateway: () => fakeGateway(),
      persistIdentity: () => {
        throw new Error("identity conflict detail");
      }
    }
  });

  assert.equal(runtime.failure, "startup");
  assert.equal(stops, 1);
});

test("required startup failure is fatal after bounded cleanup", async () => {
  let stops = 0;
  await assert.rejects(
    startPeerRuntime({
      ownerUserId,
      dataDir,
      dependencies: {
        environment: enabledEnvironment({ FORGE_PEER_REQUIRED: "1" }),
        resolveTemporaryDirectory: async () => "/private/tmp",
        createCommandAuthorizer: fakeCommandAuthorizer,
        createSupervisor: () =>
          fakeSupervisor({
            startError: new Error("sensitive child detail"),
            onStop: () => {
              stops += 1;
            }
          }),
        createGateway: () => fakeGateway()
      }
    }),
    (error: unknown) =>
      error instanceof PeerRuntimeStartupError &&
      error.code === "startup" &&
      error.message === "The forge-peer daemon did not pass its startup checks."
  );
  assert.equal(stops, 1);
});

test("runtime manager routes two owners into independent daemon state", async () => {
  const secondOwnerUserId = "user_peer_runtime_second";
  const supervisorConfigurations: Array<
    Extract<PeerDaemonSupervisorConfig, { enabled: true }>
  > = [];
  const authorizerStateByOwner = new Map<string, string>();
  const queryOwners: string[] = [];
  const startCountByOwner = new Map<string, number>();
  const stopCountByOwner = new Map<string, number>();
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: enabledEnvironment(),
      resolveTemporaryDirectory: async () => "/private/tmp",
      maximumOwners: 2,
      createCommandAuthorizer: (input) => {
        authorizerStateByOwner.set(input.ownerUserId, input.stateDir);
        return fakeCommandAuthorizer(input);
      },
      createSupervisor: (config) => {
        assert.equal(config.enabled, true);
        if (!config.enabled) assert.fail("runtime must be enabled");
        supervisorConfigurations.push(config);
        return fakeSupervisor({
          onStart: () => {
            startCountByOwner.set(
              config.ownerUserId,
              (startCountByOwner.get(config.ownerUserId) ?? 0) + 1
            );
          },
          onStop: () => {
            stopCountByOwner.set(
              config.ownerUserId,
              (stopCountByOwner.get(config.ownerUserId) ?? 0) + 1
            );
          }
        });
      },
      createGateway: ({ ownerUserId: gatewayOwnerUserId }) => {
        const identity = localIdentity(gatewayOwnerUserId);
        return {
          ...fakeGateway(identity),
          executeQuery: async (input) => {
            assert.equal(input.ownerUserId, gatewayOwnerUserId);
            queryOwners.push(gatewayOwnerUserId);
            return {
              state: "live" as const,
              payload: { ownerUserId: gatewayOwnerUserId },
              metadata: {}
            };
          }
        } as PeerCoreGateway;
      },
      persistIdentity: ({ ownerUserId: persistedOwnerUserId, identity }) => {
        assert.equal(identity.provenance.ownerUserId, persistedOwnerUserId);
        return {
          principalId: identity.principal.id,
          deviceId: identity.device.id
        };
      }
    }
  });

  const sharedRemoteQuery = {
    relationshipId: "1".repeat(32),
    personId: "shared_remote_person",
    query: { projectionId: "person.profile.v1" },
    timeoutMs: 1_000
  };
  const first = await runtime.gateway.executeQuery({
    ownerUserId,
    ...sharedRemoteQuery
  });
  const second = await runtime.gateway.executeQuery({
    ownerUserId: secondOwnerUserId,
    ...sharedRemoteQuery
  });
  await runtime.gateway.localIdentity({ ownerUserId: secondOwnerUserId });

  assert.deepEqual(first.payload, { ownerUserId });
  assert.deepEqual(second.payload, { ownerUserId: secondOwnerUserId });
  assert.deepEqual(queryOwners, [ownerUserId, secondOwnerUserId]);
  assert.equal(supervisorConfigurations.length, 2);
  assert.equal(startCountByOwner.get(ownerUserId), 1);
  assert.equal(startCountByOwner.get(secondOwnerUserId), 1);
  assert.notEqual(
    supervisorConfigurations[0]!.stateDir,
    supervisorConfigurations[1]!.stateDir
  );
  assert.notEqual(
    supervisorConfigurations[0]!.socketPath,
    supervisorConfigurations[1]!.socketPath
  );
  assert.equal(
    authorizerStateByOwner.get(ownerUserId),
    supervisorConfigurations.find((item) => item.ownerUserId === ownerUserId)!
      .stateDir
  );
  assert.equal(
    authorizerStateByOwner.get(secondOwnerUserId),
    supervisorConfigurations.find(
      (item) => item.ownerUserId === secondOwnerUserId
    )!.stateDir
  );

  await runtime.stop();
  assert.equal(stopCountByOwner.get(ownerUserId), 1);
  assert.equal(stopCountByOwner.get(secondOwnerUserId), 1);
});

test("runtime manager enforces its owner bound", async () => {
  let starts = 0;
  const runtime = await startPeerRuntime({
    ownerUserId,
    dataDir,
    dependencies: {
      environment: enabledEnvironment(),
      resolveTemporaryDirectory: async () => "/private/tmp",
      maximumOwners: 1,
      createCommandAuthorizer: fakeCommandAuthorizer,
      createSupervisor: () =>
        fakeSupervisor({
          onStart: () => {
            starts += 1;
          }
        }),
      createGateway: () => fakeGateway(),
      persistIdentity: () => ({
        principalId: "a".repeat(64),
        deviceId: "c".repeat(64)
      })
    }
  });
  try {
    await assert.rejects(
      runtime.gateway.localIdentity({ ownerUserId: "second_owner_over_limit" }),
      /owner runtime limit/
    );
    assert.equal(starts, 1);
  } finally {
    await runtime.stop();
  }
});
