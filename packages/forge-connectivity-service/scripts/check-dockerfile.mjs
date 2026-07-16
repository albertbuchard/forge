import { readFile } from "node:fs/promises";

const [dockerfile, dockerignore, packageJson] = await Promise.all([
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse)
]);

const nodeImageMatch = dockerfile.match(
  /^ARG NODE_IMAGE=(node:24\.\d+\.\d+-bookworm-slim@sha256:[a-f0-9]{64})$/m
);
const requiredPatterns = [
  [nodeImageMatch, "immutable patch-level Node 24 base image"],
  [
    (dockerfile.match(/^FROM \$\{NODE_IMAGE\} AS /gm) ?? []).length === 3,
    "the same immutable image in all three stages"
  ],
  [
    /npm ci --omit=dev --ignore-scripts/,
    "script-disabled production npm install"
  ],
  [/npm ci --ignore-scripts/, "script-disabled build npm install"],
  [/^USER node$/m, "non-root runtime user"],
  [
    /mkdir -p \/data && chown node:node \/data && chmod 0700 \/data/,
    "private writable data directory"
  ],
  [/^STOPSIGNAL SIGTERM$/m, "explicit graceful-stop signal"],
  [/^HEALTHCHECK /m, "container healthcheck"],
  [/^CMD \["node", "dist\/main\.js"\]$/m, "exec-form service command"],
  [
    new RegExp(`^ARG SERVICE_VERSION=${packageJson.version}$`, "m"),
    "container version matching package version"
  ],
  [
    /org\.opencontainers\.image\.version="\$\{SERVICE_VERSION\}"/,
    "OCI version label"
  ],
  [
    /org\.opencontainers\.image\.revision="\$\{VCS_REF\}"/,
    "OCI revision label"
  ],
  [
    /org\.opencontainers\.image\.created="\$\{BUILD_DATE\}"/,
    "OCI creation label"
  ],
  [
    /org\.opencontainers\.image\.source="https:\/\/github\.com\/albertbuchard\/forge"/,
    "OCI source label"
  ],
  [/org\.opencontainers\.image\.documentation=/, "OCI documentation label"],
  [
    /org\.opencontainers\.image\.base\.name="\$\{NODE_IMAGE\}"/,
    "OCI base-image label"
  ]
];

const failures = requiredPatterns
  .filter(([condition]) =>
    condition instanceof RegExp ? !condition.test(dockerfile) : !condition
  )
  .map(([, label]) => label);

if (/FROM\s+\S+:latest/.test(dockerfile)) {
  failures.push("no latest base-image tag");
}
if (/COPY\s+\.\s+\./.test(dockerfile)) {
  failures.push("no broad build-context copy");
}
if (/^COPY[^\n]*--chown=node:node/m.test(dockerfile)) {
  failures.push("root-owned application files");
}
const ignoredBuildContext = new Set(
  dockerignore
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"))
);
for (const sensitiveEntry of [
  ".env",
  ".env.*",
  ".git",
  ".npmrc",
  "*.key",
  "*.pem",
  "*.sqlite",
  "data",
  "node_modules"
]) {
  if (!ignoredBuildContext.has(sensitiveEntry)) {
    failures.push(`build-context exclusion ${sensitiveEntry}`);
  }
}
if (failures.length > 0) {
  throw new Error(`Dockerfile policy failures: ${failures.join(", ")}`);
}

process.stdout.write(
  `Dockerfile build contract passed for ${nodeImageMatch[1]}.\n`
);
