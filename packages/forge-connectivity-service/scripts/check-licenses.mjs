import { readFile } from "node:fs/promises";

const lock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8")
);
const packages = Object.entries(lock.packages ?? {}).filter(
  ([packagePath]) => packagePath !== ""
);
const forbidden =
  /(?:^|[^A-Z])(?:A?GPL|SSPL|BUSL|Commons-Clause|UNLICENSED|SEE LICENSE|UNKNOWN)(?:$|[^A-Z])/i;
const missing = [];
const rejected = [];

for (const [packagePath, metadata] of packages) {
  const license =
    typeof metadata.license === "string" ? metadata.license.trim() : "";
  if (license.length === 0) {
    missing.push(packagePath);
  } else if (forbidden.test(license)) {
    rejected.push(`${packagePath}: ${license}`);
  }
}

if (missing.length > 0 || rejected.length > 0) {
  throw new Error(
    JSON.stringify(
      {
        error: "LICENSE_POLICY_FAILED",
        missing,
        rejected
      },
      null,
      2
    )
  );
}

process.stdout.write(
  `${JSON.stringify({ checkedPackages: packages.length, policy: "no missing, GPL/AGPL/SSPL/BUSL/Commons-Clause licenses" })}\n`
);
