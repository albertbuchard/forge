import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildGamificationAssetDownloadHeaders,
  replaceGamificationAssetDirectoryAtomically
} from "./services/gamification-assets.js";

async function setupExistingPack(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const target = path.join(root, "style-pack");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "state.txt"), "existing-pack", "utf8");
  return { root, target };
}

test("asset staging failure leaves the existing validated pack untouched", async () => {
  const { root, target } = await setupExistingPack("forge-game-assets-write-");
  try {
    await assert.rejects(
      replaceGamificationAssetDirectoryAtomically(
        target,
        async (stagingRoot, operations) => {
          await operations.mkdir(stagingRoot, { recursive: true });
          await operations.writeFile(
            path.join(stagingRoot, "partial.txt"),
            "partial",
            "utf8"
          );
          throw new Error("injected sprite write failure");
        }
      ),
      /injected sprite write failure/
    );

    assert.equal(
      await readFile(path.join(target, "state.txt"), "utf8"),
      "existing-pack"
    );
    assert.deepEqual(
      (await readdir(root)).filter((entry) => entry.includes(".staging-")),
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed atomic swap restores the previous pack before returning", async () => {
  const { root, target } = await setupExistingPack("forge-game-assets-swap-");
  let injected = false;
  try {
    await assert.rejects(
      replaceGamificationAssetDirectoryAtomically(
        target,
        async (stagingRoot, operations) => {
          await operations.mkdir(stagingRoot, { recursive: true });
          await operations.writeFile(
            path.join(stagingRoot, "state.txt"),
            "replacement-pack",
            "utf8"
          );
        },
        {
          rename: async (source, destination) => {
            if (
              !injected &&
              String(source).includes(".staging-") &&
              String(destination) === target
            ) {
              injected = true;
              throw new Error("injected atomic swap failure");
            }
            await rename(source, destination);
          }
        }
      ),
      /injected atomic swap failure/
    );

    assert.equal(
      await readFile(path.join(target, "state.txt"), "utf8"),
      "existing-pack"
    );
    assert.deepEqual(
      (await readdir(root)).filter(
        (entry) => entry.includes(".staging-") || entry.endsWith(".backup")
      ),
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a retry restores a pre-commit crash backup before staging new work", async () => {
  const { root, target } = await setupExistingPack("forge-game-assets-crash-");
  const backup = `${target}.backup`;
  try {
    await rename(target, backup);
    await assert.rejects(
      replaceGamificationAssetDirectoryAtomically(target, async () => {
        throw new Error("injected retry staging failure");
      }),
      /injected retry staging failure/
    );
    assert.equal(
      await readFile(path.join(target, "state.txt"), "utf8"),
      "existing-pack"
    );
    assert.equal(existsSync(backup), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent replacements for one style are serialized", async () => {
  const { root, target } = await setupExistingPack(
    "forge-game-assets-concurrent-"
  );
  let releaseFirst: () => void = () => undefined;
  let markFirstStarted: () => void = () => undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const order: string[] = [];
  try {
    const first = replaceGamificationAssetDirectoryAtomically(
      target,
      async (stagingRoot, operations) => {
        order.push("first");
        await operations.mkdir(stagingRoot, { recursive: true });
        await operations.writeFile(
          path.join(stagingRoot, "state.txt"),
          "first-pack",
          "utf8"
        );
        markFirstStarted();
        await firstMayFinish;
      }
    );
    await firstStarted;
    const second = replaceGamificationAssetDirectoryAtomically(
      target,
      async (stagingRoot, operations) => {
        order.push("second");
        await operations.mkdir(stagingRoot, { recursive: true });
        await operations.writeFile(
          path.join(stagingRoot, "state.txt"),
          "second-pack",
          "utf8"
        );
      }
    );
    await Promise.resolve();
    assert.deepEqual(order, ["first"]);
    releaseFirst();
    await Promise.all([first, second]);

    assert.deepEqual(order, ["first", "second"]);
    assert.equal(
      await readFile(path.join(target, "state.txt"), "utf8"),
      "second-pack"
    );
    assert.deepEqual(
      (await readdir(root)).filter(
        (entry) => entry.includes(".staging-") || entry.endsWith(".backup")
      ),
      []
    );
  } finally {
    releaseFirst();
    await rm(root, { recursive: true, force: true });
  }
});

test("post-commit cleanup failure keeps the replacement active and is recovered on retry", async () => {
  const { root, target } = await setupExistingPack(
    "forge-game-assets-cleanup-"
  );
  try {
    await replaceGamificationAssetDirectoryAtomically(
      target,
      async (stagingRoot, operations) => {
        await operations.mkdir(stagingRoot, { recursive: true });
        await operations.writeFile(
          path.join(stagingRoot, "state.txt"),
          "replacement-pack",
          "utf8"
        );
      },
      {
        rm: async (targetPath, options) => {
          if (
            String(targetPath).endsWith(".backup") &&
            existsSync(String(targetPath))
          ) {
            throw new Error("injected backup cleanup failure");
          }
          await rm(targetPath, options);
        }
      }
    );

    assert.equal(
      await readFile(path.join(target, "state.txt"), "utf8"),
      "replacement-pack"
    );
    assert.ok((await readdir(root)).some((entry) => entry.endsWith(".backup")));

    await replaceGamificationAssetDirectoryAtomically(
      target,
      async (stagingRoot, operations) => {
        await operations.mkdir(stagingRoot, { recursive: true });
        await operations.writeFile(
          path.join(stagingRoot, "state.txt"),
          "retried-pack",
          "utf8"
        );
      }
    );
    assert.equal(
      await readFile(path.join(target, "state.txt"), "utf8"),
      "retried-pack"
    );
    assert.deepEqual(
      (await readdir(root)).filter(
        (entry) => entry.includes(".staging-") || entry.endsWith(".backup")
      ),
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub credentials are sent only to the exact trusted HTTPS origin", () => {
  const previousForgeToken = process.env.FORGE_GAMIFICATION_GITHUB_TOKEN;
  const previousGithubToken = process.env.GITHUB_TOKEN;
  process.env.FORGE_GAMIFICATION_GITHUB_TOKEN = "gamification-test-token";
  delete process.env.GITHUB_TOKEN;
  try {
    assert.equal(
      buildGamificationAssetDownloadHeaders(
        "https://github.com/albertbuchard/forge/releases/download/assets/style.zip"
      ).Authorization,
      "Bearer gamification-test-token"
    );
    for (const adversarialUrl of [
      "https://attacker.example/github.com/releases/style.zip",
      "https://github.com.attacker.example/releases/style.zip",
      "http://github.com/albertbuchard/forge/releases/style.zip"
    ]) {
      assert.equal(
        buildGamificationAssetDownloadHeaders(adversarialUrl).Authorization,
        undefined,
        adversarialUrl
      );
    }
  } finally {
    if (previousForgeToken === undefined) {
      delete process.env.FORGE_GAMIFICATION_GITHUB_TOKEN;
    } else {
      process.env.FORGE_GAMIFICATION_GITHUB_TOKEN = previousForgeToken;
    }
    if (previousGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousGithubToken;
    }
  }
});

test("an interrupted install cleans only old bounded staging directories", async () => {
  const { root, target } = await setupExistingPack(
    "forge-game-assets-interrupted-"
  );
  const oldStaging = `${target}.staging-deadbeefcafe`;
  const activeStaging = `${target}.staging-123456abcdef`;
  const unknownStaging = `${target}.staging-recovery-not-owned`;
  try {
    for (const stagingRoot of [oldStaging, activeStaging, unknownStaging]) {
      await mkdir(stagingRoot, { recursive: true });
      await writeFile(path.join(stagingRoot, "state.txt"), stagingRoot, "utf8");
    }
    const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(oldStaging, oldTimestamp, oldTimestamp);

    await replaceGamificationAssetDirectoryAtomically(
      target,
      async (stagingRoot, operations) => {
        await operations.mkdir(stagingRoot, { recursive: true });
        await operations.writeFile(
          path.join(stagingRoot, "state.txt"),
          "recovered-pack",
          "utf8"
        );
      }
    );

    assert.equal(existsSync(oldStaging), false);
    assert.equal(
      await readFile(path.join(activeStaging, "state.txt"), "utf8"),
      activeStaging
    );
    assert.equal(
      await readFile(path.join(unknownStaging, "state.txt"), "utf8"),
      unknownStaging
    );
    assert.equal(
      await readFile(path.join(target, "state.txt"), "utf8"),
      "recovered-pack"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
