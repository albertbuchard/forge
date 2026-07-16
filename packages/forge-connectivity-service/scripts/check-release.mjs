import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const readText = (path) => readFile(new URL(path, root), "utf8");
const [
  packageText,
  lockText,
  versionSource,
  openapiText,
  dockerfile,
  main,
  releaseWorkflow,
  rootPackageText
] = await Promise.all([
  readText("package.json"),
  readText("package-lock.json"),
  readText("src/version.ts"),
  readText("openapi/openapi.json"),
  readText("Dockerfile"),
  readText("dist/main.js"),
  readText("../../.github/workflows/release-connectivity-service.yml"),
  readText("../../package.json")
]);
const packageJson = JSON.parse(packageText);
const packageLock = JSON.parse(lockText);
const openapi = JSON.parse(openapiText);
const rootPackage = JSON.parse(rootPackageText);
const failures = [];
const requireValue = (condition, label) => {
  if (!condition) failures.push(label);
};

requireValue(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version),
  "semantic package version"
);
requireValue(packageLock.name === packageJson.name, "lockfile package name");
requireValue(packageLock.lockfileVersion === 3, "npm lockfile version 3");
requireValue(
  packageLock.version === packageJson.version &&
    packageLock.packages?.[""]?.version === packageJson.version,
  "lockfile package version"
);
for (const [packagePath, metadata] of Object.entries(
  packageLock.packages ?? {}
)) {
  if (packagePath === "") continue;
  requireValue(
    typeof metadata.resolved === "string" &&
      metadata.resolved.startsWith("https://registry.npmjs.org/"),
    `registry-pinned dependency ${packagePath}`
  );
  requireValue(
    typeof metadata.integrity === "string" &&
      /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.integrity),
    `SHA-512 dependency integrity ${packagePath}`
  );
  requireValue(metadata.link !== true, `non-link dependency ${packagePath}`);
}
requireValue(
  versionSource.includes(`SERVICE_VERSION = "${packageJson.version}"`),
  "runtime package version"
);
requireValue(
  openapi.info?.version === packageJson.version,
  "OpenAPI package version"
);
requireValue(
  dockerfile.includes(`ARG SERVICE_VERSION=${packageJson.version}`),
  "container package version"
);
requireValue(
  packageJson.repository?.directory === "packages/forge-connectivity-service",
  "repository package directory"
);
requireValue(
  packageJson.publishConfig?.access === "public" &&
    packageJson.publishConfig?.provenance === true,
  "public provenance-enabled publish configuration"
);
requireValue(
  /^npm@11\.\d+\.\d+$/.test(packageJson.packageManager),
  "npm 11 package-manager pin"
);
for (const requiredFile of [
  "dist",
  "docs",
  "openapi",
  "scripts/healthcheck.mjs",
  "LICENSE",
  "README.md"
]) {
  requireValue(
    packageJson.files?.includes(requiredFile),
    `packed ${requiredFile}`
  );
}
requireValue(
  main.startsWith("#!/usr/bin/env node\n"),
  "executable CLI shebang"
);
for (const sourceOnlyFile of [
  ".dockerignore",
  "Dockerfile",
  "package-lock.json",
  "src",
  "tsconfig.build.json",
  "tsconfig.json"
]) {
  requireValue(
    !packageJson.files?.includes(sourceOnlyFile),
    `source-only ${sourceOnlyFile} excluded from npm files`
  );
}
for (const [pattern, label] of [
  [/connectivity-v\*/, "dedicated connectivity release tag"],
  [
    /npm pack \.\/packages\/forge-connectivity-service/,
    "package-scoped npm archive"
  ],
  [
    /tar -xOf[\s\S]*package\/package\.json[\s\S]*manifest\.name !==\s*"forge-connectivity-service"/,
    "packed manifest identity assertion"
  ],
  [/actions\/attest@v4/, "GitHub artifact attestation"],
  [/sigstore\/cosign-installer@v4\.1\.2/, "Sigstore release signing"],
  [/docker\/build-push-action@v7\.2\.0/, "current BuildKit release action"],
  [/platforms: linux\/amd64,linux\/arm64/, "multi-architecture image"],
  [/gh release create/, "immutable GitHub release"],
  [/subject-digest:/, "image digest attestation"]
]) {
  requireValue(pattern.test(releaseWorkflow), label);
}
requireValue(
  !/\bnpm publish\b/.test(releaseWorkflow),
  "release does not require an npm registry"
);
requireValue(
  rootPackage.scripts?.["pack:connectivity-service"] ===
    "cd packages/forge-connectivity-service && npm pack",
  "root connectivity pack helper uses the package directory"
);

if (failures.length > 0) {
  throw new Error(`Release metadata failures: ${failures.join(", ")}`);
}

process.stdout.write(
  `Release metadata passed for ${packageJson.name}@${packageJson.version}.\n`
);
