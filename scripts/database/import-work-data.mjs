#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

function usage() {
  return [
    "Forge Work private-data importer",
    "",
    "Usage:",
    "  node scripts/database/import-work-data.mjs preview <manifest.json> [options]",
    "  node scripts/database/import-work-data.mjs apply <manifest.json> --expected-preview-digest <sha256> --idempotency-key <key> --apply [options]",
    "  node scripts/database/import-work-data.mjs rollback-preview <receipt-id> [options]",
    "  node scripts/database/import-work-data.mjs rollback <receipt-id> --expected-rollback-preview-digest <sha256> --idempotency-key <key> --apply [options]",
    "",
    "Options:",
    "  --base-url <url>          Forge API origin; defaults to FORGE_API_URL or http://127.0.0.1:4317",
    "  --operator-session <file> JSON file containing cookie and csrfToken; must not be group/world-readable",
    "  --allow-remote            Permit an HTTPS non-loopback Forge origin",
    "  --apply                   Required for either mutating command",
    "",
    "Alternatively provide FORGE_OPERATOR_COOKIE and FORGE_CSRF_TOKEN in the environment.",
    "The command never obtains, persists, or prints operator credentials."
  ].join("\n");
}

function fail(message) {
  throw new Error(`${message}\n\n${usage()}`);
}

function parseArgs(argv) {
  const [command, target, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    return { help: true };
  }
  if (!target) fail(`${command} requires a manifest path or import receipt id.`);
  const options = {
    command,
    target,
    apply: false,
    allowRemote: false,
    baseUrl: process.env.FORGE_API_URL || "http://127.0.0.1:4317",
    operatorSessionPath: null,
    expectedPreviewDigest: null,
    expectedRollbackPreviewDigest: null,
    idempotencyKey: null
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (argument === "--allow-remote") {
      options.allowRemote = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value.`);
    index += 1;
    if (argument === "--base-url") options.baseUrl = value;
    else if (argument === "--operator-session") options.operatorSessionPath = value;
    else if (argument === "--expected-preview-digest") options.expectedPreviewDigest = value;
    else if (argument === "--expected-rollback-preview-digest") options.expectedRollbackPreviewDigest = value;
    else if (argument === "--idempotency-key") options.idempotencyKey = value;
    else fail(`Unknown option: ${argument}`);
  }
  return options;
}

function assertBaseUrl(value, allowRemote) {
  const url = new URL(value);
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (!loopback && !allowRemote) {
    fail("A non-loopback Forge origin requires --allow-remote.");
  }
  if (!loopback && url.protocol !== "https:") {
    fail("A remote Forge origin must use HTTPS.");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    fail("The Forge API origin must use HTTP or HTTPS.");
  }
  return url.origin;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readOperatorSession(path) {
  if (path) {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      fail("The operator-session file must not be readable or writable by group or other users. Run chmod 600 on it first.");
    }
    const session = readJson(path, "Operator-session file");
    if (typeof session.cookie !== "string" || typeof session.csrfToken !== "string") {
      fail("The operator-session file must contain string cookie and csrfToken fields.");
    }
    return { cookie: session.cookie, csrfToken: session.csrfToken };
  }
  const cookie = process.env.FORGE_OPERATOR_COOKIE;
  const csrfToken = process.env.FORGE_CSRF_TOKEN;
  if (!cookie || !csrfToken) {
    fail("Provide --operator-session or both FORGE_OPERATOR_COOKIE and FORGE_CSRF_TOKEN.");
  }
  return { cookie, csrfToken };
}

function requireDigest(value, label) {
  if (!value || !DIGEST_PATTERN.test(value)) {
    fail(`${label} must be the exact 64-character lowercase SHA-256 digest returned by its preview.`);
  }
  return value;
}

function requireIdempotencyKey(value) {
  if (!value || value.length > 200) {
    fail("--idempotency-key is required and must contain at most 200 characters.");
  }
  return value;
}

async function requestJson({ baseUrl, session, method, path, body }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      cookie: session.cookie,
      "content-type": "application/json",
      "x-forge-csrf": session.csrfToken,
      "x-forge-actor": "Work private-data importer",
      "x-forge-source": "system"
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error"
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Forge returned non-JSON HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const error = payload?.error;
    throw new Error(
      `Forge rejected the request with HTTP ${response.status}${typeof error?.code === "string" ? ` (${error.code})` : ""}: ${typeof error?.message === "string" ? error.message : "Unknown error"}`
    );
  }
  return payload;
}

export async function runWorkImportCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    return { help: usage() };
  }
  if (!new Set(["preview", "apply", "rollback-preview", "rollback"]).has(options.command)) {
    fail(`Unknown command: ${options.command}`);
  }
  if ((options.command === "apply" || options.command === "rollback") && !options.apply) {
    fail(`${options.command} changes Forge data and requires the explicit --apply flag.`);
  }
  if ((options.command === "preview" || options.command === "rollback-preview") && options.apply) {
    fail(`${options.command} is read-only and does not accept --apply.`);
  }

  const baseUrl = assertBaseUrl(options.baseUrl, options.allowRemote);
  const session = readOperatorSession(options.operatorSessionPath);
  if (options.command === "preview") {
    const manifest = readJson(options.target, "Work import manifest");
    return requestJson({
      baseUrl,
      session,
      method: "POST",
      path: "/api/v1/work/imports/preview",
      body: manifest
    });
  }
  if (options.command === "apply") {
    const manifest = readJson(options.target, "Work import manifest");
    return requestJson({
      baseUrl,
      session,
      method: "POST",
      path: "/api/v1/work/imports/apply",
      body: {
        manifest,
        expectedPreviewDigest: requireDigest(
          options.expectedPreviewDigest,
          "--expected-preview-digest"
        ),
        idempotencyKey: requireIdempotencyKey(options.idempotencyKey)
      }
    });
  }
  const receiptId = encodeURIComponent(options.target);
  if (options.command === "rollback-preview") {
    return requestJson({
      baseUrl,
      session,
      method: "GET",
      path: `/api/v1/work/imports/${receiptId}/rollback-preview`
    });
  }
  return requestJson({
    baseUrl,
    session,
    method: "POST",
    path: `/api/v1/work/imports/${receiptId}/rollback`,
    body: {
      expectedRollbackPreviewDigest: requireDigest(
        options.expectedRollbackPreviewDigest,
        "--expected-rollback-preview-digest"
      ),
      idempotencyKey: requireIdempotencyKey(options.idempotencyKey)
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorkImportCli()
    .then((result) => {
      if (result && typeof result === "object" && "help" in result) {
        process.stdout.write(`${result.help}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
