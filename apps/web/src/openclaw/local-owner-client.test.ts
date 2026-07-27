import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveDescriptorOwnerBroker } from "./local-owner-client";

const temporaryRoots: string[] = [];

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function writeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "forge-owner-client-"));
  temporaryRoots.push(root);
  const binaryPath = path.join(root, "forge-owner-broker");
  const receiptPath = path.join(root, "receipt.json");
  const descriptorPath = path.join(root, "owner-broker.json");
  const binary = "#!/bin/sh\nexit 0\n";
  const binarySha256 = sha256(binary);
  writeFileSync(binaryPath, binary, { mode: 0o700 });
  writeFileSync(
    receiptPath,
    `${JSON.stringify({ ownerBrokerBinarySha256: binarySha256 })}\n`,
    { mode: 0o600 }
  );
  writeFileSync(
    descriptorPath,
    `${JSON.stringify({
      schemaVersion: 1,
      binaryPath,
      binarySha256,
      receiptPath
    })}\n`,
    { mode: 0o600 }
  );
  return { root, binaryPath, receiptPath, descriptorPath };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("local owner broker descriptor", () => {
  it("accepts an owner-only descriptor, receipt, and matching binary", () => {
    const fixture = writeFixture();
    expect(resolveDescriptorOwnerBroker(fixture.descriptorPath)).toBe(
      fixture.binaryPath
    );
  });

  it("rejects a receipt readable by another local account", () => {
    const fixture = writeFixture();
    chmodSync(fixture.receiptPath, 0o644);
    expect(resolveDescriptorOwnerBroker(fixture.descriptorPath)).toBeNull();
  });

  it("rejects a symlinked or multiply linked receipt", () => {
    const symlinkFixture = writeFixture();
    const realReceipt = path.join(symlinkFixture.root, "real-receipt.json");
    writeFileSync(
      realReceipt,
      `${JSON.stringify({
        ownerBrokerBinarySha256: sha256("#!/bin/sh\nexit 0\n")
      })}\n`,
      { mode: 0o600 }
    );
    rmSync(symlinkFixture.receiptPath);
    symlinkSync(realReceipt, symlinkFixture.receiptPath);
    expect(
      resolveDescriptorOwnerBroker(symlinkFixture.descriptorPath)
    ).toBeNull();

    const hardlinkFixture = writeFixture();
    mkdirSync(path.join(hardlinkFixture.root, "links"));
    linkSync(
      hardlinkFixture.receiptPath,
      path.join(hardlinkFixture.root, "links", "receipt.json")
    );
    expect(
      resolveDescriptorOwnerBroker(hardlinkFixture.descriptorPath)
    ).toBeNull();
  });
});
