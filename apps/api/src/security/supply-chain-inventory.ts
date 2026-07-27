export type SupplyChainInventoryEntry = {
  id: string;
  ecosystem: "node" | "rust" | "python" | "ruby" | "swift" | "generated";
  canonicalManifests: readonly string[];
  lockfiles: readonly string[];
  generatedMirrors: readonly string[];
  auditCommands: readonly string[];
  lockRequiredBeforeRelease: boolean;
};

export type SupplyChainSecurityException = {
  advisoryId: string;
  severity: "moderate" | "high" | "critical";
  owner: string;
  scope: string;
  packages: readonly string[];
  affectedCapability: string;
  nonReachabilityEvidence: readonly string[];
  compensatingControls: readonly string[];
  incompatibleRemediation: string;
  expiresAt: string;
};

export const SUPPLY_CHAIN_INVENTORY = [
  {
    id: "root-node",
    ecosystem: "node",
    canonicalManifests: ["package.json"],
    lockfiles: ["package-lock.json"],
    generatedMirrors: [],
    auditCommands: [
      "npm audit --omit=dev --json",
      "npm sbom --omit=dev --sbom-format spdx"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "forge-memory-node",
    ecosystem: "node",
    canonicalManifests: ["packages/forge-memory/package.json"],
    lockfiles: ["packages/forge-memory/package-lock.json"],
    generatedMirrors: [],
    auditCommands: [
      "npm --prefix packages/forge-memory audit --omit=dev --json"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "connectivity-service-node",
    ecosystem: "node",
    canonicalManifests: ["packages/forge-connectivity-service/package.json"],
    lockfiles: ["packages/forge-connectivity-service/package-lock.json"],
    generatedMirrors: [],
    auditCommands: [
      "npm --prefix packages/forge-connectivity-service audit --omit=dev --json"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "openclaw-node",
    ecosystem: "node",
    canonicalManifests: ["plugins/openclaw/package.json"],
    lockfiles: ["plugins/openclaw/package-lock.json"],
    generatedMirrors: [],
    auditCommands: [
      "npm --prefix plugins/openclaw audit --omit=dev --omit=peer --json"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "course-kit-node",
    ecosystem: "node",
    canonicalManifests: ["packages/course-kit/package.json"],
    lockfiles: ["package-lock.json"],
    generatedMirrors: [],
    auditCommands: ["npm audit --omit=dev --json"],
    lockRequiredBeforeRelease: true
  },
  {
    id: "forge-peer-rust",
    ecosystem: "rust",
    canonicalManifests: ["packages/forge-peer/Cargo.toml"],
    lockfiles: ["packages/forge-peer/Cargo.lock"],
    generatedMirrors: ["plugins/openclaw/dist/forge-peer-src"],
    auditCommands: [
      "cargo audit --file packages/forge-peer/Cargo.lock",
      "cargo deny --manifest-path packages/forge-peer/Cargo.toml check"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "forge-peer-fuzz-rust",
    ecosystem: "rust",
    canonicalManifests: ["packages/forge-peer/fuzz/Cargo.toml"],
    lockfiles: ["packages/forge-peer/fuzz/Cargo.lock"],
    generatedMirrors: [
      "plugins/codex/runtime/dist/forge-peer-src/fuzz",
      "plugins/hermes/forge_hermes/runtime/dist/forge-peer-src/fuzz",
      "plugins/openclaw/dist/forge-peer-src/fuzz"
    ],
    auditCommands: ["cargo audit --file packages/forge-peer/fuzz/Cargo.lock"],
    lockRequiredBeforeRelease: true
  },
  {
    id: "companion-iroh-rust",
    ecosystem: "rust",
    canonicalManifests: ["packages/companion-iroh/Cargo.toml"],
    lockfiles: ["packages/companion-iroh/Cargo.lock"],
    generatedMirrors: ["plugins/openclaw/dist/companion-iroh-src"],
    auditCommands: [
      "cargo audit --file packages/companion-iroh/Cargo.lock",
      "cargo deny --manifest-path packages/companion-iroh/Cargo.toml check"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "desktop-tauri-rust",
    ecosystem: "rust",
    canonicalManifests: ["apps/desktop-tauri/Cargo.toml"],
    lockfiles: ["apps/desktop-tauri/Cargo.lock"],
    generatedMirrors: [],
    auditCommands: [
      "cargo audit --manifest-path apps/desktop-tauri/Cargo.toml",
      "cargo tree --locked --manifest-path apps/desktop-tauri/Cargo.toml --target all -i rsa",
      "cargo deny --config apps/desktop-tauri/deny.toml --manifest-path apps/desktop-tauri/Cargo.toml check"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "hermes-python",
    ecosystem: "python",
    canonicalManifests: ["plugins/hermes/pyproject.toml"],
    lockfiles: ["plugins/hermes/uv.lock"],
    generatedMirrors: ["plugins/hermes/forge_hermes/runtime"],
    auditCommands: [
      "uv export --project plugins/hermes --locked --no-emit-project | uvx --python 3.13 pip-audit -r /dev/stdin --no-deps --disable-pip --format json"
    ],
    lockRequiredBeforeRelease: true
  },
  {
    id: "ios-ruby",
    ecosystem: "ruby",
    canonicalManifests: ["apps/ios-companion/Gemfile"],
    lockfiles: ["apps/ios-companion/Gemfile.lock"],
    generatedMirrors: [],
    auditCommands: ["(cd apps/ios-companion && bundle-audit check --update)"],
    lockRequiredBeforeRelease: true
  },
  {
    id: "ios-swift",
    ecosystem: "swift",
    canonicalManifests: ["apps/ios-companion/project.yml"],
    lockfiles: [],
    generatedMirrors: [],
    auditCommands: [
      "verify apps/ios-companion/project.yml declares only Apple SDK frameworks and local targets"
    ],
    lockRequiredBeforeRelease: false
  },
  {
    id: "generated-adapters",
    ecosystem: "generated",
    canonicalManifests: [
      "package-lock.json",
      "packages/forge-peer/Cargo.lock",
      "packages/companion-iroh/Cargo.lock",
      "plugins/hermes/uv.lock"
    ],
    lockfiles: [],
    generatedMirrors: [
      "plugins/codex/runtime",
      "plugins/hermes/forge_hermes/runtime",
      "plugins/openclaw/dist"
    ],
    auditCommands: ["node scripts/ci/check-security-mirror-receipts.mjs"],
    lockRequiredBeforeRelease: false
  }
] as const satisfies readonly SupplyChainInventoryEntry[];

export const SUPPLY_CHAIN_SECURITY_EXCEPTIONS = [
  {
    advisoryId: "GHSA-qwww-vcr4-c8h2",
    severity: "high",
    owner: "Forge security maintainers",
    scope: "root and OpenClaw production Node graphs",
    packages: ["react-router", "react-router-dom"],
    affectedCapability:
      "React Router server-side React Server Components action handling",
    nonReachabilityEvidence: [
      "Forge builds a client-side Vite single-page application.",
      "Forge imports BrowserRouter, Routes, and navigation APIs from react-router-dom.",
      "Forge does not install @react-router/dev or a React Router server adapter.",
      "Forge has no entry.rsc.tsx, RSC route action, or React Router framework-mode server."
    ],
    compensatingControls: [
      "Forge's Fastify API handles server actions instead of React Router.",
      "The release test rejects any React Router server adapter or RSC entrypoint."
    ],
    incompatibleRemediation:
      "React Router 8.3 removes react-router-dom and requires React 19.2.7 plus Vite 7; Forge currently uses React 19.1 and Vite 6. A 7.11 downgrade was rejected because it breaks the existing typed Location.mask route-handoff contract.",
    expiresAt: "2026-08-09T00:00:00.000Z"
  },
  {
    advisoryId: "RUSTSEC-2023-0071",
    severity: "moderate",
    owner: "Forge security maintainers",
    scope: "apps/desktop-tauri/Cargo.lock",
    packages: ["rsa"],
    affectedCapability: "RSA private-key operations in the Forge desktop shell",
    nonReachabilityEvidence: [
      "rsa 0.9.10 is an orphan optional lock entry.",
      "cargo tree --locked --manifest-path apps/desktop-tauri/Cargo.toml --target all -i rsa prints no dependency path.",
      "cargo deny evaluates the reachable all-feature desktop graph without matching the advisory."
    ],
    compensatingControls: [
      "The release gate reruns the locked all-target reverse dependency query.",
      "The desktop source does not perform RSA private-key operations."
    ],
    incompatibleRemediation:
      "There is no reachable dependency edge to upgrade. Regenerating the lock without optional target metadata would weaken cross-target reproducibility.",
    expiresAt: "2026-08-09T00:00:00.000Z"
  }
] as const satisfies readonly SupplyChainSecurityException[];

export function assertActiveSupplyChainSecurityExceptions(
  now: Date = new Date()
) {
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new Error("Supply-chain exception evaluation time is invalid.");
  }
  for (const exception of SUPPLY_CHAIN_SECURITY_EXCEPTIONS) {
    if (Date.parse(exception.expiresAt) <= nowMilliseconds) {
      throw new Error(
        `Supply-chain security exception ${exception.advisoryId} expired at ${exception.expiresAt}.`
      );
    }
  }
}
