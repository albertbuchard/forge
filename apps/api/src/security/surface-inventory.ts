import type {
  CapabilityContract,
  PersistentTransportContract
} from "./contracts.js";

export const PERSISTENT_TRANSPORT_INVENTORY = [
  {
    id: "fastify-http",
    kind: "http",
    sourceLocations: ["apps/api/src/app.ts", "apps/api/src/routes"],
    requiredBoundary: "access_gateway"
  },
  {
    id: "event-stream",
    kind: "sse",
    sourceLocations: ["apps/api/src/app.ts"],
    requiredBoundary: "access_gateway"
  },
  {
    id: "development-web-upgrade",
    kind: "websocket",
    sourceLocations: ["apps/api/src/web.ts"],
    requiredBoundary: "access_gateway"
  },
  {
    id: "codex-mcp",
    kind: "mcp",
    sourceLocations: ["plugins/codex/scripts/forge-codex-mcp.mjs"],
    requiredBoundary: "access_gateway"
  },
  {
    id: "background-jobs",
    kind: "background",
    sourceLocations: [
      "apps/api/src/managers/platform/background-job-manager.ts",
      "apps/api/src/app.ts"
    ],
    requiredBoundary: "principal_persisted_and_reauthorized"
  },
  {
    id: "peer-runtime",
    kind: "peer",
    sourceLocations: [
      "apps/api/src/routes/peer-sharing.ts",
      "apps/api/src/services/peer-runtime.ts",
      "packages/forge-peer"
    ],
    requiredBoundary: "verified_protocol_then_access_gateway"
  },
  {
    id: "companion-runtime",
    kind: "companion",
    sourceLocations: [
      "apps/api/src/app.ts",
      "apps/api/src/services/companion-iroh.ts",
      "packages/companion-iroh"
    ],
    requiredBoundary: "verified_protocol_then_access_gateway"
  }
] as const satisfies readonly PersistentTransportContract[];

export const CAPABILITY_INVENTORY = [
  {
    id: "machine.read",
    risk: "host_file",
    sourceLocations: ["apps/api/src/repositories/ai-processors.ts"],
    remoteBoundary: "policy_broker"
  },
  {
    id: "machine.write",
    risk: "host_file",
    sourceLocations: ["apps/api/src/repositories/ai-processors.ts"],
    remoteBoundary: "os_isolated_worker"
  },
  {
    id: "machine.exec",
    risk: "host_code_execution",
    sourceLocations: [
      "apps/api/src/repositories/ai-processors.ts",
      "apps/api/src/repositories/ai-connectors.ts"
    ],
    remoteBoundary: "os_isolated_worker"
  },
  {
    id: "network.fetch",
    risk: "network_egress",
    sourceLocations: [
      "apps/api/src/services/wiki-url-fetch.ts",
      "apps/api/src/repositories/model-settings.ts",
      "apps/api/src/repositories/calendar.ts"
    ],
    remoteBoundary: "policy_broker"
  },
  {
    id: "secret.release",
    risk: "secret_release",
    sourceLocations: ["apps/api/src/managers/platform/secrets-manager.ts"],
    remoteBoundary: "operator_step_up"
  },
  {
    id: "data.export",
    risk: "data_administration",
    sourceLocations: ["apps/api/src/services/data-management.ts"],
    remoteBoundary: "operator_step_up"
  },
  {
    id: "data.restore",
    risk: "data_administration",
    sourceLocations: ["apps/api/src/services/data-management.ts"],
    remoteBoundary: "operator_step_up"
  }
] as const satisfies readonly CapabilityContract[];
