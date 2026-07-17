import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PEOPLE_PACKED_MIGRATIONS,
  assertIsolatedRoot,
  callMcpPeopleTool,
  exercisePeopleHttp,
  findFreePort,
  prepareNativeRuntime,
  resolveSurfaceSocketPath,
  runPackedSurfaceMatrix,
  stopIsolatedManagedRuntimes,
  stopTrackedChild,
  validatePackedSurfaceConfig,
  waitForForgeHealth
} from "./people-packed-surfaces.mjs";
import {
  createNativeSourceManifest,
  serializeNativeSourceManifest,
  serializeNativeSourceSignature,
  signNativeSourceManifest
} from "../../packages/forge-memory/lib/native-source-manifest.mjs";

const VERSION = "1.2.3";

test("packed surface sockets stay below the portable Unix path limit", () => {
  const evidenceRoot =
    "/private/tmp/forge-people-release-artifacts-29552760903-1/people-packed-surfaces-evidence";
  const socketPath = resolveSurfaceSocketPath(evidenceRoot, "openclaw");
  assert.equal(path.dirname(socketPath), realpathSync(os.tmpdir()));
  assert.match(path.basename(socketPath), /^fp-[0-9a-f]{12}-openclaw\.sock$/);
  assert.equal(path.normalize(socketPath), socketPath);
  assert.ok(Buffer.byteLength(socketPath) <= 100);
});

const FAKE_SERVER_SOURCE = String.raw`
import http from "node:http";
const port = Number(process.argv[2]);
const dataRoot = process.argv[3];
let person = null;
const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};
const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/api/v1/health") {
    send(response, 200, { ok: true, app: "forge", backend: "forge-node-runtime", runtime: { pid: process.pid, storageRoot: dataRoot, basePath: "/forge/" } });
    return;
  }
  if (url.pathname === "/api/v1/auth/operator-session") {
    send(response, 200, { session: { actorLabel: "Operator" } }, { "set-cookie": "forge_session=test; Path=/; HttpOnly" });
    return;
  }
  if (url.pathname === "/api/v1/entities/create" && request.method === "POST") {
    const body = await readBody(request);
    person = { id: "person_fixture", ...body.operations[0].data };
    send(response, 200, { results: [{ ok: true, entity: person }] });
    return;
  }
  if (url.pathname === "/api/v1/people") {
    send(response, 200, { people: person ? [person] : [], page: { hasMore: false } });
    return;
  }
  if (url.pathname === "/api/v1/settings/tokens" && request.method === "POST") {
    send(response, 201, { token: { token: "fg_fixture_token", tokenSummary: { id: "token_fixture" } } });
    return;
  }
  send(response, 404, { error: "not found" });
});
server.listen(port, "127.0.0.1");
`;

const FAKE_MCP_SOURCE = String.raw`
import readline from "node:readline";
const lines = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "notifications/initialized") return;
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "forge_call_people_route", description: "fixture", inputSchema: { type: "object" } }] } });
    return;
  }
  if (message.method === "tools/call") {
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify({ people: [{ id: "person_fixture", displayName: process.env.PACKED_PERSON_NAME }] }) }] } });
  }
});
`;

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function write(filePath, value = "fixture\n") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`
  );
  return result;
}

function archiveTar(parent, directoryName, output) {
  run("tar", ["-czf", output, "-C", parent, directoryName]);
}

function archiveZip(sourceRoot, output) {
  const script = String.raw`
import pathlib, sys, zipfile
source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for item in sorted(source.rglob("*")):
        if item.is_file():
            archive.write(item, item.relative_to(source).as_posix())
`;
  run("python3", ["-c", script, sourceRoot, output]);
}

function writeMigrations(root, migrationBytes) {
  for (const [name, bytes] of Object.entries(migrationBytes)) {
    write(path.join(root, name), bytes);
  }
}

function createFixtureArtifacts(root, version = VERSION) {
  const migrationBytes = Object.fromEntries(
    PEOPLE_PACKED_MIGRATIONS.map((name) => [
      name,
      `-- ${name}\nSELECT '${name}';\n`
    ])
  );
  const canonical = path.join(root, "canonical");
  writeMigrations(canonical, migrationBytes);

  const openclawParent = path.join(root, "openclaw-source");
  const openclaw = path.join(openclawParent, "package");
  writeJson(path.join(openclaw, "package.json"), {
    name: "forge-openclaw-plugin",
    version,
    type: "module"
  });
  writeJson(path.join(openclaw, "openclaw.plugin.json"), {
    id: "forge-openclaw-plugin",
    version,
    contracts: { tools: ["forge_call_people_route"] }
  });
  write(path.join(openclaw, "server", "index.js"), "export {};\n");
  write(path.join(openclaw, "dist", "openclaw", "tools.js"), "export {};\n");
  write(path.join(openclaw, "dist", "forge-peer-src", "Cargo.toml"));
  writeMigrations(path.join(openclaw, "server", "migrations"), migrationBytes);
  writeMigrations(
    path.join(openclaw, "dist", "server", "apps", "api", "migrations"),
    migrationBytes
  );
  const openclawArchive = path.join(root, "forge-openclaw-plugin.tgz");
  archiveTar(openclawParent, "package", openclawArchive);

  const hermes = path.join(root, "hermes-wheel");
  write(
    path.join(hermes, "forge_hermes", "version.py"),
    `__version__ = "${version}"\n`
  );
  write(
    path.join(hermes, "forge_hermes", "__init__.py"),
    "from .version import __version__\n"
  );
  write(
    path.join(hermes, "forge_hermes", "catalog.py"),
    'TOOL_CATALOG = [{"name": "forge_call_people_route"}]\n'
  );
  writeJson(path.join(hermes, "forge_hermes", "runtime", "package.json"), {
    name: "forge-hermes-runtime",
    version,
    type: "module"
  });
  write(
    path.join(
      hermes,
      "forge_hermes",
      "runtime",
      "dist",
      "forge-peer-src",
      "Cargo.toml"
    )
  );
  writeMigrations(
    path.join(hermes, "forge_hermes", "runtime", "apps", "api", "migrations"),
    migrationBytes
  );
  writeMigrations(
    path.join(
      hermes,
      "forge_hermes",
      "runtime",
      "dist",
      "server",
      "apps",
      "api",
      "migrations"
    ),
    migrationBytes
  );
  write(
    path.join(hermes, "forge_hermes_plugin-1.2.3.dist-info", "METADATA"),
    `Metadata-Version: 2.1\nName: forge-hermes-plugin\nVersion: ${version}\n`
  );
  write(
    path.join(hermes, "pyproject.toml"),
    `[build-system]\nrequires = ["setuptools>=69", "wheel"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "forge-hermes-plugin"\nversion = "${version}"\n\n[tool.setuptools.packages.find]\ninclude = ["forge_hermes*"]\n\n[tool.setuptools.package-data]\n"forge_hermes" = ["runtime/**/*"]\n`
  );
  write(
    path.join(hermes, "setup.py"),
    `from setuptools import find_packages, setup\nsetup(name="forge-hermes-plugin", version="${version}", packages=find_packages(), include_package_data=True, package_data={"forge_hermes": ["runtime/package.json", "runtime/apps/api/migrations/*.sql", "runtime/dist/forge-peer-src/*", "runtime/dist/server/apps/api/migrations/*.sql"]})\n`
  );
  const hermesArchive = path.join(
    root,
    "forge_hermes_plugin-1.2.3-py3-none-any.whl"
  );
  archiveZip(hermes, hermesArchive);

  const codexParent = path.join(root, "codex-source");
  const codex = path.join(codexParent, "package");
  writeJson(path.join(codex, "package.json"), {
    name: "forge-codex-runtime",
    version,
    private: true,
    type: "module"
  });
  write(
    path.join(codex, "dist", "openclaw", "local-runtime.js"),
    "export {};\n"
  );
  write(
    path.join(codex, "dist", "openclaw", "tools.js"),
    'export const name = "forge_call_people_route";\n'
  );
  write(path.join(codex, "dist", "forge-peer-src", "Cargo.toml"));
  writeMigrations(path.join(codex, "server", "migrations"), migrationBytes);
  writeMigrations(
    path.join(codex, "dist", "server", "apps", "api", "migrations"),
    migrationBytes
  );
  const codexArchive = path.join(root, "forge-codex-runtime.tgz");
  archiveTar(codexParent, "package", codexArchive);

  const memoryParent = path.join(root, "memory-source");
  const memory = path.join(memoryParent, "package");
  writeJson(path.join(memory, "package.json"), {
    name: "forge-memory",
    version,
    type: "module",
    bin: { "forge-memory": "bin/forge-memory.mjs" }
  });
  write(
    path.join(memory, "bin", "forge-memory.mjs"),
    [
      'const RUNTIME_PACKAGE = "forge-openclaw-plugin";',
      "const VERSION = '1.2.3';",
      "const RUNTIME_PACKAGE_VERSION = VERSION;",
      'const block = \'args = ["forge-memory", "mcp"]\';'
    ].join("\n")
  );
  write(path.join(memory, "lib", "peer-runtime-install.mjs"));
  write(path.join(memory, "lib", "native-source-manifest.mjs"));
  const memoryArchive = path.join(root, "forge-memory.tgz");
  archiveTar(memoryParent, "package", memoryArchive);

  return {
    migrationBytes,
    canonical,
    sourceRoots: { openclaw, hermes, codex, forgeMemory: memory },
    archives: {
      openclaw: openclawArchive,
      hermes: hermesArchive,
      codex: codexArchive,
      forgeMemory: memoryArchive
    }
  };
}

function createConfig(root, fixtures, suffix = "run") {
  const protectedRoot = path.join(root, "protected-data");
  mkdirSync(protectedRoot, { recursive: true });
  return {
    schemaVersion: 1,
    expectedVersion: VERSION,
    evidenceRoot: path.join(root, `evidence-${suffix}`),
    protectedRoots: [protectedRoot],
    migrationFiles: Object.fromEntries(
      PEOPLE_PACKED_MIGRATIONS.map((name) => [
        name,
        path.join(fixtures.canonical, name)
      ])
    ),
    artifacts: Object.fromEntries(
      Object.entries(fixtures.archives).map(([surface, archive]) => [
        surface,
        { archive }
      ])
    ),
    timeouts: { commandMs: 20_000, runtimeMs: 10_000, stopMs: 2_000 }
  };
}

function fakeNative(evidenceRoot) {
  const binaryPath = path.join(evidenceRoot, "fixture-forge-peer");
  write(binaryPath, "fixture binary\n");
  return {
    sourceVerified: true,
    signatureVerified: true,
    runtimePackageVersion: VERSION,
    packageVersion: VERSION,
    commitSha: "0".repeat(40),
    signingKeyId: "0".repeat(32),
    manifestSha256: "0".repeat(64),
    binaryPath,
    binarySha256: "0".repeat(64),
    built: false
  };
}

function createFixtureExecutor(pids, mutateEvidence = null) {
  return async (context) => {
    context.port = await findFreePort();
    const serverPath = path.join(context.root, "fixture-server.mjs");
    const mcpPath = path.join(context.root, "fixture-mcp.mjs");
    write(serverPath, FAKE_SERVER_SOURCE);
    write(mcpPath, FAKE_MCP_SOURCE);
    const child = spawn(
      process.execPath,
      [serverPath, String(context.port), context.dataRoot],
      {
        cwd: context.root,
        env: { ...process.env, HOME: context.homeRoot },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    pids.push(child.pid);
    try {
      const baseUrl = `http://127.0.0.1:${context.port}`;
      const health = await waitForForgeHealth({
        baseUrl,
        dataRoot: context.dataRoot,
        timeoutMs: 5_000,
        child
      });
      const people = await exercisePeopleHttp({
        baseUrl,
        surface: context.surface
      });
      const peopleTool = await callMcpPeopleTool({
        command: process.execPath,
        args: [mcpPath],
        cwd: context.root,
        env: {
          ...process.env,
          HOME: context.homeRoot,
          PACKED_PERSON_NAME: people.displayName
        },
        displayName: people.displayName,
        logPath: path.join(context.root, "fixture-mcp.log"),
        timeoutMs: 5_000
      });
      const evidence = {
        runtimeResolution: {
          kind: "synthetic_process_fixture",
          version: VERSION,
          packageRoot: context.root,
          targetArtifactRegistryFallbackAllowed: false,
          ...(context.surface === "codex"
            ? {
                codexRuntimeSnapshotRoot: context.root,
                codexRuntimeSnapshotExecuted: false
              }
            : {})
        },
        health: {
          ok: health.ok === true,
          backend: health.backend,
          storageRoot: health.runtime.storageRoot
        },
        native: {
          sourceVerified: true,
          signatureVerified: true,
          runtimeProbe: { healthy: true, protocolVersion: "forge-peer/1" }
        },
        person: {
          created: people.created,
          listed: people.listed,
          idPresent: true
        },
        peopleTool,
        cleanup: { allChildrenStopped: true, evidenceRootPreserved: true }
      };
      return mutateEvidence
        ? mutateEvidence(context.surface, evidence)
        : evidence;
    } finally {
      const stopped = await stopTrackedChild(child, 2_000);
      assert.equal(stopped.stopped, true);
    }
  };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("packed matrix verifies all four artifacts and executes isolated People paths", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-matrix-pass-"));
  const fixtures = createFixtureArtifacts(root);
  const config = createConfig(root, fixtures, "pass");
  const pids = [];
  const result = await runPackedSurfaceMatrix(config, {
    prepareNativeRuntime: async ({ evidenceRoot }) => fakeNative(evidenceRoot),
    executeSurface: createFixtureExecutor(pids)
  });

  assert.equal(result.status, "passed", JSON.stringify(result, null, 2));
  assert.deepEqual(result.failedSurfaces, []);
  for (const surface of ["openclaw", "hermes", "codex", "forgeMemory"]) {
    assert.equal(result.surfaces[surface].status, "passed");
    assert.equal(
      result.surfaces[surface].execution.peopleTool.returnedCreatedPerson,
      true
    );
  }
  assert.ok(
    readFileSync(result.resultPath, "utf8").includes('"status": "passed"')
  );
  assert.ok(
    pids.every((pid) => !processExists(pid)),
    "every fixture server must stop"
  );
});

test("config fails closed when a surface is absent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-missing-"));
  const fixtures = createFixtureArtifacts(root);
  const config = createConfig(root, fixtures, "missing");
  delete config.artifacts.hermes;
  assert.throws(
    () => validatePackedSurfaceConfig(config),
    /artifacts\.hermes must be an object/
  );
  const trustOverride = createConfig(root, fixtures, "trust-override");
  trustOverride.trustedKeys = [];
  assert.throws(
    () => validatePackedSurfaceConfig(trustOverride),
    /unsupported keys: trustedKeys/
  );
});

test("CLI emits machine JSON and never overwrites a caller result path", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-cli-"));
  const fixtures = createFixtureArtifacts(root);
  const config = createConfig(root, fixtures, "cli");
  delete config.artifacts.hermes;
  const configPath = path.join(root, "matrix.json");
  const outputPath = path.join(root, "matrix-result.json");
  writeJson(configPath, config);
  const scriptPath = path.join(
    import.meta.dirname,
    "people-packed-surfaces.mjs"
  );
  const first = spawnSync(
    process.execPath,
    [scriptPath, "--config", configPath, "--output", outputPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  assert.equal(first.status, 1, first.stderr);
  const firstResult = JSON.parse(first.stdout);
  assert.equal(firstResult.status, "failed");
  assert.match(firstResult.error.message, /artifacts\.hermes/);
  const preserved = readFileSync(outputPath, "utf8");
  assert.deepEqual(JSON.parse(preserved), firstResult);

  const second = spawnSync(
    process.execPath,
    [scriptPath, "--config", configPath, "--output", outputPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  assert.equal(second.status, 1, second.stderr);
  const secondResult = JSON.parse(second.stdout);
  assert.equal(secondResult.error.code, "output_exists");
  assert.equal(readFileSync(outputPath, "utf8"), preserved);
});

test("isolated roots cannot overlap a protected or canonical root", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-protected-"));
  const protectedRoot = path.join(root, "canonical");
  mkdirSync(protectedRoot);
  assert.throws(
    () =>
      assertIsolatedRoot(path.join(protectedRoot, "evidence"), [protectedRoot]),
    /overlaps protected root/
  );
  assert.throws(
    () => assertIsolatedRoot(root, [protectedRoot]),
    /overlaps protected root/
  );
  if (process.platform !== "win32") {
    const alias = path.join(root, "protected-alias");
    symlinkSync(protectedRoot, alias, "dir");
    assert.throws(
      () => assertIsolatedRoot(path.join(alias, "evidence"), [protectedRoot]),
      /overlaps protected root/
    );
  }
});

test("migration byte drift blocks execution for every carrying surface", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-migration-"));
  const fixtures = createFixtureArtifacts(root);
  const config = createConfig(root, fixtures, "migration");
  write(
    config.migrationFiles[PEOPLE_PACKED_MIGRATIONS[0]],
    "-- canonical changed after packaging\n"
  );
  let executions = 0;
  const result = await runPackedSurfaceMatrix(config, {
    prepareNativeRuntime: async ({ evidenceRoot }) => fakeNative(evidenceRoot),
    executeSurface: async () => {
      executions += 1;
      return {};
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(
    executions,
    0,
    "no runtime may start after artifact parity fails"
  );
  assert.equal(result.surfaces.openclaw.error.code, "migration");
  assert.equal(result.surfaces.hermes.error.code, "migration");
  assert.equal(result.surfaces.codex.error.code, "migration");
});

test("cross-surface version mismatch fails before runtime execution", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-version-"));
  const fixtures = createFixtureArtifacts(root, "1.2.4");
  const config = createConfig(root, fixtures, "version");
  let executions = 0;
  const result = await runPackedSurfaceMatrix(config, {
    prepareNativeRuntime: async ({ evidenceRoot }) => fakeNative(evidenceRoot),
    executeSurface: async () => {
      executions += 1;
      return {};
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(executions, 0);
  assert.ok(
    Object.values(result.surfaces).every(
      (surface) => surface.error?.code === "version"
    )
  );
});

test("partial People tool evidence fails only the affected surface", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-partial-"));
  const fixtures = createFixtureArtifacts(root);
  const config = createConfig(root, fixtures, "partial");
  const result = await runPackedSurfaceMatrix(config, {
    prepareNativeRuntime: async ({ evidenceRoot }) => fakeNative(evidenceRoot),
    executeSurface: createFixtureExecutor([], (surface, evidence) => {
      if (surface === "hermes") delete evidence.peopleTool;
      return evidence;
    })
  });
  assert.equal(result.status, "failed");
  assert.equal(result.surfaces.hermes.error.code, "partial_evidence");
  assert.equal(result.surfaces.openclaw.status, "passed");
  assert.equal(result.surfaces.codex.status, "passed");
  assert.equal(result.surfaces.forgeMemory.status, "passed");
});

test("unsafe archive traversal is rejected without starting any surface", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-traversal-"));
  const fixtures = createFixtureArtifacts(root);
  const malicious = path.join(root, "malicious.tgz");
  const script = String.raw`
import io, tarfile, sys
with tarfile.open(sys.argv[1], "w:gz") as archive:
    info = tarfile.TarInfo("../escape")
    payload = b"bad"
    info.size = len(payload)
    archive.addfile(info, io.BytesIO(payload))
`;
  run("python3", ["-c", script, malicious]);
  const config = createConfig(root, fixtures, "traversal");
  config.artifacts.openclaw = { archive: malicious };
  let executions = 0;
  const result = await runPackedSurfaceMatrix(config, {
    prepareNativeRuntime: async ({ evidenceRoot }) => fakeNative(evidenceRoot),
    executeSurface: async () => {
      executions += 1;
      return {};
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.surfaces.openclaw.error.code, "command");
  assert.equal(executions, 0);
});

test(
  "symlinked artifact inputs are rejected before runtime execution",
  { skip: process.platform === "win32" },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-symlink-"));
    const fixtures = createFixtureArtifacts(root);
    const archiveAlias = path.join(root, "openclaw-alias.tgz");
    symlinkSync(fixtures.archives.openclaw, archiveAlias);
    const config = createConfig(root, fixtures, "symlink");
    config.artifacts.openclaw = { archive: archiveAlias };
    let executions = 0;
    const result = await runPackedSurfaceMatrix(config, {
      prepareNativeRuntime: async ({ evidenceRoot }) =>
        fakeNative(evidenceRoot),
      executeSurface: async () => {
        executions += 1;
        return {};
      }
    });
    assert.equal(result.status, "failed");
    assert.equal(result.surfaces.openclaw.error.code, "artifact");
    assert.equal(executions, 0);
  }
);

test("all source-root modes create exact artifacts only from caller sources", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-source-"));
  const fixtures = createFixtureArtifacts(root);
  const config = createConfig(root, fixtures, "source");
  config.artifacts = Object.fromEntries(
    Object.entries(fixtures.sourceRoots).map(([surface, sourceRoot]) => [
      surface,
      { sourceRoot }
    ])
  );
  const result = await runPackedSurfaceMatrix(config, {
    prepareNativeRuntime: async ({ evidenceRoot }) => fakeNative(evidenceRoot),
    executeSurface: createFixtureExecutor([])
  });
  assert.equal(result.status, "passed", JSON.stringify(result, null, 2));
  for (const surface of Object.keys(fixtures.sourceRoots)) {
    assert.equal(
      result.surfaces[surface].artifact.provenance,
      "caller_source_root"
    );
  }
  assert.equal(
    readFileSync(
      path.join(fixtures.sourceRoots.codex, "package.json"),
      "utf8"
    ).includes(VERSION),
    true
  );
});

test("native admission verifies signatures, builds once, and rejects cache tampering", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-native-"));
  const sourceRoot = path.join(root, "forge-peer-src");
  const evidenceRoot = path.join(root, "evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  write(
    path.join(sourceRoot, "Cargo.toml"),
    `[package]\nname = "forge-peer"\nversion = "${VERSION}"\nedition = "2024"\n\n[[bin]]\nname = "forge-peer"\npath = "src/main.rs"\n`
  );
  write(path.join(sourceRoot, "src", "main.rs"), "fn main() {}\n");
  run(
    "cargo",
    [
      "generate-lockfile",
      "--offline",
      "--manifest-path",
      path.join(sourceRoot, "Cargo.toml")
    ],
    { cwd: sourceRoot }
  );

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 32);
  const generatedAt = new Date(Date.now() - 1_000);
  const manifest = await createNativeSourceManifest({
    sourceRoot,
    packageVersion: VERSION,
    runtimePackageVersion: VERSION,
    commitSha: "a".repeat(40),
    generatedAt,
    signingKeyId: keyId
  });
  const signature = signNativeSourceManifest(manifest, privateKey);
  write(
    path.join(sourceRoot, "native-source.manifest.json"),
    serializeNativeSourceManifest(manifest)
  );
  write(
    path.join(sourceRoot, "native-source.signature.json"),
    serializeNativeSourceSignature(signature)
  );
  const trustedKeys = [
    {
      id: keyId,
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
      notBefore: "2020-01-01T00:00:00.000Z",
      notAfter: null,
      revokedAt: null
    }
  ];
  const input = {
    nativeRoot: sourceRoot,
    expectedVersion: VERSION,
    trustedKeys,
    evidenceRoot,
    timeoutMs: 60_000
  };
  const first = await prepareNativeRuntime(input);
  assert.equal(first.sourceVerified, true);
  assert.equal(first.signatureVerified, true);
  assert.equal(first.built, true);
  const second = await prepareNativeRuntime(input);
  assert.equal(second.built, false);
  assert.equal(second.binarySha256, first.binarySha256);

  write(first.binaryPath, "tampered binary\n");
  await assert.rejects(
    () => prepareNativeRuntime(input),
    (error) => error?.code === "native_cache_integrity"
  );
});

test(
  "managed cleanup stops only processes proven to belong to the isolated surface",
  { skip: process.platform === "win32" },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-cleanup-"));
    const homeRoot = path.join(root, "home");
    const surfaceRoot = path.join(root, "surface");
    const statePath = path.join(
      homeRoot,
      ".forge",
      "run",
      "forge-memory-runtime.json"
    );
    const ownedScript = path.join(surfaceRoot, "owned-process.mjs");
    write(ownedScript, "setInterval(() => {}, 1000);\n");
    const owned = spawn(process.execPath, [ownedScript], {
      stdio: "ignore"
    });
    writeJson(statePath, { children: [{ pid: owned.pid }] });
    const stopped = await stopIsolatedManagedRuntimes(
      homeRoot,
      surfaceRoot,
      2_000
    );
    assert.equal(stopped.allStopped, true);
    assert.equal(processExists(owned.pid), false);

    const unrelatedScript = path.join(root, "unrelated-process.mjs");
    write(unrelatedScript, "setInterval(() => {}, 1000);\n");
    const unrelated = spawn(process.execPath, [unrelatedScript], {
      stdio: "ignore"
    });
    try {
      writeJson(statePath, { children: [{ pid: unrelated.pid }] });
      const refused = await stopIsolatedManagedRuntimes(
        homeRoot,
        surfaceRoot,
        2_000
      );
      assert.equal(refused.allStopped, false);
      assert.equal(refused.processes[0]?.refused, true);
      assert.equal(processExists(unrelated.pid), true);
    } finally {
      const cleanup = await stopTrackedChild(unrelated, 2_000);
      assert.equal(cleanup.stopped, true);
    }
  }
);

test("MCP failure still terminates the process", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-packed-mcp-stop-"));
  const scriptPath = path.join(root, "bad-mcp.mjs");
  write(
    scriptPath,
    FAKE_MCP_SOURCE.replace(
      "process.env.PACKED_PERSON_NAME",
      '"Different Person"'
    )
  );
  let caught;
  try {
    await callMcpPeopleTool({
      command: process.execPath,
      args: [scriptPath],
      cwd: root,
      env: { ...process.env, PACKED_PERSON_NAME: "Expected Person" },
      displayName: "Expected Person",
      logPath: path.join(root, "bad-mcp.log"),
      timeoutMs: 3_000
    });
  } catch (error) {
    caught = error;
  }
  assert.match(caught?.message ?? "", /did not return the created Person/);
  assert.ok(
    readFileSync(path.join(root, "bad-mcp.log"), "utf8").includes("exit:")
  );
});
