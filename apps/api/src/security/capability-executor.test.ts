import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ForgePrincipal } from "./contracts.js";
import {
  CapabilityDeniedError,
  CapabilityExecutor,
  createMachineCapabilitySession,
  runBoundedProcess,
  type RemoteCodeRequest,
  type RemoteCodeWorker
} from "./capability-executor.js";

function principal(
  kind: ForgePrincipal["kind"],
  profile: ForgePrincipal["profile"]
): ForgePrincipal {
  return {
    kind,
    subjectId: "capability-test-subject",
    ownerId: "capability-test-owner",
    clientId: kind === "paired_client" ? "capability-test-client" : null,
    installationId:
      kind === "paired_client" ? "capability-test-installation" : null,
    audience: "urn:forge:capability-test",
    scopes: ["machine.exec"],
    profile,
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: kind === "paired_client" ? 1 : null,
    authenticatedAt: "2026-07-26T20:00:00.000Z"
  };
}

test("file capabilities stay inside canonical roots and reject symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-capability-files-"));
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "forge-capability-outside-")
  );
  try {
    await writeFile(path.join(root, "read.txt"), "bounded", { mode: 0o600 });
    await writeFile(path.join(outside, "secret.txt"), "sentinel", {
      mode: 0o600
    });
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(root, "link.txt")
    );
    const executor = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 32,
        maximumWriteBytes: 32
      }
    });
    assert.equal(
      await executor.readFile(path.join(root, "read.txt")),
      "bounded"
    );
    await assert.rejects(
      executor.readFile(path.join(root, "link.txt")),
      CapabilityDeniedError
    );
    await assert.rejects(
      executor.readFile(path.join(outside, "secret.txt")),
      CapabilityDeniedError
    );
    const written = await executor.writeFile(
      path.join(root, "written.txt"),
      "safe"
    );
    assert.equal(written.bytesWritten, 4);
    await assert.rejects(
      executor.writeFile(path.join(root, "too-large.txt"), "x".repeat(33)),
      CapabilityDeniedError
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("legacy host execution requires a direct, explicitly enabled owner channel", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-capability-owner-"));
  try {
    const executor = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      }
    });
    const request = {
      command: "printf owner",
      cwd: root,
      maximumRuntimeMilliseconds: 2_000,
      maximumOutputBytes: 128
    };
    const directOperator = {
      principal: principal("operator_session", "operator"),
      directOwnerChannel: true,
      localOwnerLegacyExecutionEnabled: true
    };
    assert.equal(
      (await executor.executeLocalOwnerLegacy(directOperator, request)).stdout,
      "owner"
    );

    const directLegacyAgent = {
      principal: principal("legacy_agent_token", "executor"),
      directOwnerChannel: true,
      localOwnerLegacyExecutionEnabled: true
    };
    assert.equal(
      (await executor.executeLocalOwnerLegacy(directLegacyAgent, request))
        .stdout,
      "owner"
    );

    await assert.rejects(
      executor.executeLocalOwnerLegacy(
        { ...directOperator, directOwnerChannel: false },
        request
      ),
      CapabilityDeniedError
    );
    await assert.rejects(
      executor.executeLocalOwnerLegacy(
        {
          ...directLegacyAgent,
          principal: principal("paired_client", "executor")
        },
        request
      ),
      CapabilityDeniedError
    );
    await assert.rejects(
      executor.executeLocalOwnerLegacy(directOperator, {
        ...request,
        cwd: os.tmpdir()
      }),
      CapabilityDeniedError
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("machine sessions enforce each explicit capability scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-capability-scope-"));
  try {
    await writeFile(path.join(root, "read.txt"), "scoped", { mode: 0o600 });
    const executor = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      }
    });
    const readOnlyPrincipal = {
      ...principal("paired_client", "custom"),
      scopes: ["machine.read"]
    };
    const session = createMachineCapabilitySession({
      executor,
      authority: {
        principal: readOnlyPrincipal,
        directOwnerChannel: false,
        localOwnerLegacyExecutionEnabled: false
      },
      executionBoundary: "remote_isolated",
      workspaceRoot: root,
      remoteRoots: {
        readableRoots: [root],
        writableRoots: []
      }
    });
    await assert.rejects(
      session.readTextFile("read.txt"),
      CapabilityDeniedError
    );
    await assert.rejects(
      session.writeTextFile("write.txt", "denied"),
      CapabilityDeniedError
    );
    await assert.rejects(
      session.executeCommand({
        command: "printf denied",
        cwd: ".",
        maximumRuntimeMilliseconds: 2_000,
        maximumOutputBytes: 128
      }),
      CapabilityDeniedError
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local file access rejects writable directory chains", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-capability-mode-"));
  try {
    const target = path.join(root, "read.txt");
    await writeFile(target, "private", { mode: 0o600 });
    await chmod(root, 0o777);
    const executor = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      }
    });
    await assert.rejects(executor.readFile(target), CapabilityDeniedError);
  } finally {
    await chmod(root, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("process output has one combined budget and runtime overruns terminate", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-capability-bounds-")
  );
  try {
    const bounded = await runBoundedProcess({
      executable: "/bin/sh",
      arguments: ["-c", "printf 12345678; printf 12345678 >&2"],
      cwd: root,
      environment: { PATH: "/usr/bin:/bin" },
      maximumRuntimeMilliseconds: 2_000,
      maximumOutputBytes: 10
    });
    assert.equal(bounded.truncated, true);
    assert.ok(
      Buffer.byteLength(bounded.stdout, "utf8") +
        Buffer.byteLength(bounded.stderr, "utf8") <=
        10
    );
    await assert.rejects(
      runBoundedProcess({
        executable: "/bin/sh",
        arguments: ["-c", "sleep 2"],
        cwd: root,
        environment: { PATH: "/usr/bin:/bin" },
        maximumRuntimeMilliseconds: 30,
        maximumOutputBytes: 128
      }),
      CapabilityDeniedError
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declarative commands use exact arguments, a sanitized environment, and bounded output", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-capability-command-")
  );
  try {
    const executable = path.join(root, "fixture.sh");
    await writeFile(
      executable,
      [
        "#!/bin/sh",
        'printf "%s|%s|%s" "$1" "${FORGE_SECRET_SENTINEL-unset}" "$HOME"'
      ].join("\n"),
      { mode: 0o700 }
    );
    await chmod(executable, 0o700);
    const executor = new CapabilityExecutor({
      commands: [
        {
          id: "fixture.echo",
          executable,
          allowedArguments: (arguments_) =>
            arguments_.length === 1 && arguments_[0] === "allowed",
          allowedRoots: [root],
          maximumRuntimeMilliseconds: 2_000,
          maximumOutputBytes: 128
        }
      ],
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      }
    });
    process.env.FORGE_SECRET_SENTINEL = "must-not-inherit";
    const result = await executor.executeDeclarative({
      policyId: "fixture.echo",
      arguments: ["allowed"],
      cwd: root
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "allowed|unset|/var/empty");
    await assert.rejects(
      executor.executeDeclarative({
        policyId: "fixture.echo",
        arguments: ["not-allowed"],
        cwd: root
      }),
      CapabilityDeniedError
    );
  } finally {
    delete process.env.FORGE_SECRET_SENTINEL;
    await rm(root, { recursive: true, force: true });
  }
});

test("remote code fails closed without an attested isolated worker", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-capability-remote-")
  );
  const outputRoot = path.join(root, "output");
  await mkdir(outputRoot, { mode: 0o700 });
  const request: RemoteCodeRequest = {
    command: "printf safe",
    cwd: root,
    maximumRuntimeMilliseconds: 1_000,
    maximumOutputBytes: 1_024,
    readableRoots: [root],
    writableRoots: [outputRoot],
    networkPolicy: "deny_all"
  };
  try {
    const withoutWorker = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      }
    });
    await assert.rejects(
      withoutWorker.executeRemoteCode(request),
      CapabilityDeniedError
    );

    const untrustedWorker: RemoteCodeWorker = {
      attest: () => ({
        boundary: "os_isolated_worker/v1",
        workerId: "untrusted-worker",
        unprivilegedIdentity: "forge-worker",
        networkPolicy: "deny_all",
        readableRoots: [root],
        writableRoots: [outputRoot],
        inheritedEnvironment: false,
        hostSocketsMounted: true,
        hostHomeMounted: false
      }),
      execute: async () => {
        assert.fail("an invalid worker attestation must prevent execution");
      }
    };
    const rejectedWorker = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      },
      remoteWorker: untrustedWorker
    });
    await assert.rejects(
      rejectedWorker.executeRemoteCode(request),
      CapabilityDeniedError
    );

    const oversizedWorker: RemoteCodeWorker = {
      attest: () => ({
        boundary: "os_isolated_worker/v1",
        workerId: "bounded-worker",
        unprivilegedIdentity: "forge-worker",
        networkPolicy: "deny_all",
        readableRoots: [root],
        writableRoots: [outputRoot],
        inheritedEnvironment: false,
        hostSocketsMounted: false,
        hostHomeMounted: false
      }),
      execute: async () => ({
        exitCode: 0,
        stdout: "a".repeat(700),
        stderr: "b".repeat(700),
        truncated: false
      })
    };
    const boundedWorker = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      },
      remoteWorker: oversizedWorker
    });
    await assert.rejects(
      boundedWorker.executeRemoteCode(request),
      CapabilityDeniedError
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only an explicitly enabled direct owner session retains legacy host execution", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-capability-local-owner-")
  );
  try {
    const executor = new CapabilityExecutor({
      files: {
        readableRoots: [root],
        writableRoots: [root],
        maximumReadBytes: 128,
        maximumWriteBytes: 128
      }
    });
    const input = {
      command: "printf local-owner",
      cwd: root,
      maximumRuntimeMilliseconds: 1_000,
      maximumOutputBytes: 1_024
    };
    await assert.rejects(
      executor.executeLocalOwnerLegacy(
        {
          principal: principal("paired_client", "operator"),
          directOwnerChannel: true,
          localOwnerLegacyExecutionEnabled: true
        },
        input
      ),
      CapabilityDeniedError
    );
    const result = await executor.executeLocalOwnerLegacy(
      {
        principal: principal("operator_session", "operator"),
        directOwnerChannel: true,
        localOwnerLegacyExecutionEnabled: true
      },
      input
    );
    assert.equal(result.stdout, "local-owner");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
