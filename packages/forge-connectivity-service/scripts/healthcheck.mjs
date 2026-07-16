const host = process.env.FORGE_CONNECTIVITY_HEALTHCHECK_HOST ?? "127.0.0.1";
const port = process.env.FORGE_CONNECTIVITY_PORT ?? "8787";

try {
  const response = await fetch(`http://${host}:${port}/healthz`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(2_000)
  });
  const body = await response.json();
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("application/json") ||
    body?.status !== "ok" ||
    body?.service !== "forge-connectivity-service" ||
    typeof body?.version !== "string" ||
    body.version.length === 0 ||
    body?.storage?.status !== "ok" ||
    !Number.isInteger(body.storage.schemaVersion) ||
    body.storage.schemaVersion < 1
  ) {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
