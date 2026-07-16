import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const sbom = JSON.parse(
  execFileSync(
    "npm",
    [
      "sbom",
      "--package-lock-only",
      "--omit=dev",
      "--sbom-format=cyclonedx",
      "--sbom-type=application"
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" }
  )
);

const failures = [];
if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.5") {
  failures.push("CycloneDX 1.5 format");
}
if (sbom.metadata?.component?.type !== "application") {
  failures.push("application component type");
}
if (sbom.metadata?.component?.name !== packageJson.name) {
  failures.push("root component name");
}
if (sbom.metadata?.component?.version !== packageJson.version) {
  failures.push("root component version");
}
if (
  (sbom.components ?? []).some(
    (component) => component.scope && component.scope !== "required"
  )
) {
  failures.push("production-only component scope");
}
if (failures.length > 0) {
  throw new Error(`SBOM contract failures: ${failures.join(", ")}`);
}

process.stdout.write(
  `CycloneDX application SBOM passed (${sbom.components?.length ?? 0} production components).\n`
);
