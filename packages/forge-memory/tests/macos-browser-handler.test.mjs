import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildMacosBrowserHandlerAppleScript,
  ensureMacosBrowserHandler
} from "../lib/macos-browser-handler.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fakeMacosCommands(calls) {
  return async (command, args) => {
    calls.push({ command, args });
    if (command === "/usr/bin/osacompile") {
      const appPath = args[args.indexOf("-o") + 1];
      await mkdir(path.join(appPath, "Contents", "MacOS"), {
        recursive: true,
        mode: 0o700
      });
      await writeFile(
        path.join(appPath, "Contents", "MacOS", "applet"),
        "compiled Forge handler\n",
        { mode: 0o700 }
      );
      await writeFile(
        path.join(appPath, "Contents", "Info.plist"),
        "<plist/>\n",
        { mode: 0o600 }
      );
      return { ok: true, stdout: "", stderr: "" };
    }
    if (
      command === "/usr/bin/plutil" &&
      args.includes("json") &&
      args.includes("-")
    ) {
      return {
        ok: true,
        stdout: JSON.stringify({
          CFBundleExecutable: "applet",
          CFBundlePackageType: "APPL"
        }),
        stderr: ""
      };
    }
    if (command === "/usr/bin/plutil" && args.includes("xml1")) {
      const outputPath = args[args.indexOf("-o") + 1];
      const inputPath = args.at(-1);
      const input = JSON.parse(await readFile(inputPath, "utf8"));
      await writeFile(outputPath, `<plist>${JSON.stringify(input)}</plist>\n`, {
        mode: 0o600
      });
      return { ok: true, stdout: "", stderr: "" };
    }
    if (command === "/usr/bin/codesign") {
      const appPath = args.at(-1);
      await mkdir(path.join(appPath, "Contents", "_CodeSignature"), {
        recursive: true,
        mode: 0o700
      });
      await writeFile(
        path.join(appPath, "Contents", "_CodeSignature", "CodeResources"),
        "ad-hoc signature fixture\n",
        { mode: 0o600 }
      );
      return { ok: true, stdout: "", stderr: "" };
    }
    if (command.endsWith("/lsregister")) {
      return { ok: true, stdout: "", stderr: "" };
    }
    return { ok: false, stdout: "", stderr: `unexpected ${command}` };
  };
}

test(
  "the macOS handler contains no credential and installs under an owner-only verified receipt",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "forge-macos-handler-test-")
    );
    t.after(async () => await rm(root, { recursive: true, force: true }));
    const nativeRoot = path.join(root, "native");
    const brokerPath = path.join(root, "forge-owner-broker");
    const brokerBody = "verified owner broker fixture\n";
    await writeFile(brokerPath, brokerBody, { mode: 0o700 });
    await chmod(brokerPath, 0o700);
    const calls = [];
    const runCommand = fakeMacosCommands(calls);

    const source = buildMacosBrowserHandlerAppleScript(brokerPath);
    assert.match(source, /approve-url --url/);
    assert.doesNotMatch(source, /fg_(?:session|browser|token|csrf)_/);

    const installed = await ensureMacosBrowserHandler({
      nativeRoot,
      ownerBrokerBinaryPath: brokerPath,
      ownerBrokerBinarySha256: sha256(brokerBody),
      runCommand,
      now: new Date("2026-07-26T12:00:00.000Z")
    });
    assert.equal(installed.enabled, true);
    assert.equal(installed.handlerScheme, "forge");
    assert.equal(installed.reused, false);
    assert.equal((await lstat(installed.appPath)).mode & 0o077, 0);
    assert.equal((await lstat(installed.receiptPath)).mode & 0o077, 0);
    const receipt = JSON.parse(await readFile(installed.receiptPath, "utf8"));
    assert.equal(receipt.ownerBrokerBinarySha256, sha256(brokerBody));
    assert.equal(receipt.handlerScheme, "forge");
    const infoPlist = await readFile(
      path.join(installed.appPath, "Contents", "Info.plist"),
      "utf8"
    );
    assert.match(infoPlist, /CFBundleTypeRole/);
    assert.match(infoPlist, /Viewer/);
    assert.match(infoPlist, /forge/);
    assert.equal(
      calls.filter((entry) => entry.command.endsWith("/lsregister")).length,
      1
    );

    const reusedCalls = [];
    const reused = await ensureMacosBrowserHandler({
      nativeRoot,
      ownerBrokerBinaryPath: brokerPath,
      ownerBrokerBinarySha256: sha256(brokerBody),
      runCommand: fakeMacosCommands(reusedCalls)
    });
    assert.equal(reused.reused, true);
    assert.deepEqual(reusedCalls, []);
  }
);

test(
  "an altered macOS handler is quarantined and rebuilt without deleting it",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "forge-macos-handler-repair-test-")
    );
    t.after(async () => await rm(root, { recursive: true, force: true }));
    const nativeRoot = path.join(root, "native");
    const brokerPath = path.join(root, "forge-owner-broker");
    const brokerBody = "verified owner broker fixture\n";
    await writeFile(brokerPath, brokerBody, { mode: 0o700 });
    const input = {
      nativeRoot,
      ownerBrokerBinaryPath: brokerPath,
      ownerBrokerBinarySha256: sha256(brokerBody)
    };
    await ensureMacosBrowserHandler({
      ...input,
      runCommand: fakeMacosCommands([])
    });
    const appletPath = path.join(
      nativeRoot,
      "macos-browser-owner",
      "Forge Local Owner.app",
      "Contents",
      "MacOS",
      "applet"
    );
    await writeFile(appletPath, "altered\n", { mode: 0o700 });

    const repaired = await ensureMacosBrowserHandler({
      ...input,
      runCommand: fakeMacosCommands([]),
      now: new Date("2026-07-26T13:00:00.000Z")
    });
    assert.equal(repaired.reused, false);
    const entries = await readdir(path.join(nativeRoot, "macos-browser-owner"));
    assert.ok(
      entries.some((entry) => entry.startsWith("Forge Local Owner.quarantine-"))
    );
  }
);
