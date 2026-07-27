import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export class PermissionMaintenanceError extends Error {
  readonly code = "permission_maintenance_refused";

  constructor(message: string) {
    super(message);
    this.name = "PermissionMaintenanceError";
  }
}

export type PermissionFinding = {
  path: string;
  pathSha256: string;
  kind: "ancestor" | "directory" | "file";
  mode: number;
  uid: number;
  symbolicLink: boolean;
  extendedAcl: boolean | null;
  compliant: boolean;
  reasons: readonly string[];
};

type PermissionJournalEntry = {
  path: string;
  pathSha256: string;
  dev: number;
  ino: number;
  originalMode: number;
  targetMode: number;
  applied: boolean;
};

type PermissionJournal = {
  version: 1;
  root: string;
  expectedUid: number | null;
  state: "prepared" | "applying" | "complete" | "rolled_back";
  createdAt: string;
  updatedAt: string;
  entries: PermissionJournalEntry[];
};

type AclReader = (targetPath: string) => Promise<boolean | null>;

function pathHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pathWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function defaultAclReader(targetPath: string) {
  if (process.platform !== "darwin") return null;
  const { stdout } = await execFile("/bin/ls", ["-lde", targetPath], {
    timeout: 2_000,
    maxBuffer: 64 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C"
    }
  });
  const firstToken = stdout.trimStart().split(/\s+/, 1)[0] ?? "";
  return firstToken.includes("+") || /\n\s*\d+:\s/.test(stdout);
}

async function atomicOwnerOnlyJson(targetPath: string, value: unknown) {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`
  );
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, targetPath);
    await chmod(targetPath, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function ancestorPaths(targetPath: string) {
  const absolute = path.resolve(targetPath);
  const parsed = path.parse(absolute);
  const relative = absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  const ancestors = [parsed.root];
  for (const segment of relative) {
    ancestors.push(path.join(ancestors.at(-1)!, segment));
  }
  return ancestors;
}

export async function inspectPermissionTree(input: {
  root: string;
  sensitivePaths: readonly string[];
  expectedUid?: number | null;
  aclReader?: AclReader;
}) {
  const requestedRootMetadata = await lstat(input.root);
  if (requestedRootMetadata.isSymbolicLink()) {
    throw new PermissionMaintenanceError(
      "The permission root cannot be a symbolic link."
    );
  }
  const root = await realpath(input.root);
  const expectedUid = input.expectedUid ?? process.getuid?.() ?? null;
  const aclReader = input.aclReader ?? defaultAclReader;
  const targets = [
    ...ancestorPaths(root).map((targetPath) => ({
      targetPath,
      kind: "ancestor" as const,
      enforceMode: false
    })),
    ...input.sensitivePaths.map((requestedPath) => ({
      targetPath: path.resolve(root, requestedPath),
      kind: null,
      enforceMode: true
    }))
  ];
  const findings: PermissionFinding[] = [];
  for (const target of targets) {
    if (target.enforceMode && !pathWithin(root, target.targetPath)) {
      throw new PermissionMaintenanceError(
        "A sensitive path is outside the permission root."
      );
    }
    if (target.enforceMode) {
      const relative = path.relative(root, target.targetPath);
      let current = root;
      for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        const component = await lstat(current);
        if (current !== target.targetPath && component.isSymbolicLink()) {
          throw new PermissionMaintenanceError(
            "Sensitive permission paths cannot traverse symbolic links."
          );
        }
      }
    }
    const metadata = await lstat(target.targetPath);
    const symbolicLink = metadata.isSymbolicLink();
    const kind = target.kind ?? (metadata.isDirectory() ? "directory" : "file");
    const mode = Number(metadata.mode) & 0o777;
    const extendedAcl = await aclReader(target.targetPath);
    const reasons: string[] = [];
    if (symbolicLink) reasons.push("symbolic_link");
    if (expectedUid !== null && metadata.uid !== expectedUid) {
      reasons.push("unexpected_owner");
    }
    if (target.enforceMode) {
      const requiredMode = kind === "directory" ? 0o700 : 0o600;
      if (mode !== requiredMode) reasons.push("excess_permissions");
      if (extendedAcl === true) reasons.push("extended_acl");
    }
    findings.push({
      path: target.targetPath,
      pathSha256: pathHash(target.targetPath),
      kind,
      mode,
      uid: metadata.uid,
      symbolicLink,
      extendedAcl,
      compliant: reasons.length === 0,
      reasons: Object.freeze(reasons)
    });
  }
  return Object.freeze({
    root,
    expectedUid,
    compliant: findings
      .filter((finding) => finding.kind !== "ancestor" || finding.path === root)
      .every((finding) => finding.compliant),
    findings: Object.freeze(findings)
  });
}

export class PermissionMaintenance {
  constructor(
    private readonly input: {
      root: string;
      sensitivePaths: readonly string[];
      journalPath: string;
      receiptPath: string;
      expectedUid?: number | null;
      aclReader?: AclReader;
      now?: () => Date;
      afterApply?: (entryIndex: number) => Promise<void> | void;
    }
  ) {}

  private now() {
    return (this.input.now ?? (() => new Date()))().toISOString();
  }

  private async readJournal(): Promise<PermissionJournal | null> {
    try {
      return JSON.parse(
        await readFile(this.input.journalPath, "utf8")
      ) as PermissionJournal;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  private async prepare() {
    const inspection = await inspectPermissionTree({
      root: this.input.root,
      sensitivePaths: this.input.sensitivePaths,
      expectedUid: this.input.expectedUid,
      aclReader: this.input.aclReader
    });
    const entries: PermissionJournalEntry[] = [];
    for (const finding of inspection.findings.filter(
      (entry) => entry.path === inspection.root || entry.kind !== "ancestor"
    )) {
      if (
        finding.symbolicLink ||
        (inspection.expectedUid !== null &&
          finding.uid !== inspection.expectedUid) ||
        finding.extendedAcl === true
      ) {
        throw new PermissionMaintenanceError(
          "Permission repair refuses symbolic links, unexpected owners, and extended access-control lists."
        );
      }
      const metadata = await lstat(finding.path);
      if (!metadata.isDirectory() && !metadata.isFile()) {
        throw new PermissionMaintenanceError(
          "Permission repair supports regular files and directories only."
        );
      }
      entries.push({
        path: finding.path,
        pathSha256: finding.pathSha256,
        dev: Number(metadata.dev),
        ino: Number(metadata.ino),
        originalMode: finding.mode,
        targetMode: metadata.isDirectory() ? 0o700 : 0o600,
        applied: finding.mode === (metadata.isDirectory() ? 0o700 : 0o600)
      });
    }
    const timestamp = this.now();
    const journal: PermissionJournal = {
      version: 1,
      root: inspection.root,
      expectedUid: inspection.expectedUid,
      state: "prepared",
      createdAt: timestamp,
      updatedAt: timestamp,
      entries
    };
    await atomicOwnerOnlyJson(this.input.journalPath, journal);
    await atomicOwnerOnlyJson(this.input.receiptPath, {
      version: 1,
      state: "prepared",
      rootSha256: pathHash(inspection.root),
      createdAt: timestamp,
      entries: entries.map((entry) => ({
        pathSha256: entry.pathSha256,
        originalMode: entry.originalMode,
        targetMode: entry.targetMode
      }))
    });
    return journal;
  }

  async repair() {
    const journal = (await this.readJournal()) ?? (await this.prepare());
    if (journal.state === "rolled_back") {
      throw new PermissionMaintenanceError(
        "A rolled-back permission journal cannot be resumed."
      );
    }
    if (journal.state === "complete") return journal;
    journal.state = "applying";
    for (const [index, entry] of journal.entries.entries()) {
      if (entry.applied) continue;
      const metadata = await lstat(entry.path);
      if (
        metadata.isSymbolicLink() ||
        Number(metadata.dev) !== entry.dev ||
        Number(metadata.ino) !== entry.ino ||
        (journal.expectedUid !== null && metadata.uid !== journal.expectedUid)
      ) {
        throw new PermissionMaintenanceError(
          "A repair target changed after the maintenance receipt was created."
        );
      }
      await chmod(entry.path, entry.targetMode);
      entry.applied = true;
      journal.updatedAt = this.now();
      await atomicOwnerOnlyJson(this.input.journalPath, journal);
      await this.input.afterApply?.(index);
    }
    journal.state = "complete";
    journal.updatedAt = this.now();
    await atomicOwnerOnlyJson(this.input.journalPath, journal);
    await atomicOwnerOnlyJson(this.input.receiptPath, {
      version: 1,
      state: "complete",
      rootSha256: pathHash(journal.root),
      completedAt: journal.updatedAt,
      entries: journal.entries.map((entry) => ({
        pathSha256: entry.pathSha256,
        originalMode: entry.originalMode,
        targetMode: entry.targetMode
      }))
    });
    return journal;
  }

  async rollback() {
    const journal = await this.readJournal();
    if (!journal) {
      throw new PermissionMaintenanceError(
        "Permission rollback requires an existing maintenance journal."
      );
    }
    for (const entry of [...journal.entries].reverse()) {
      if (!entry.applied) continue;
      const metadata = await lstat(entry.path);
      if (
        metadata.isSymbolicLink() ||
        Number(metadata.dev) !== entry.dev ||
        Number(metadata.ino) !== entry.ino
      ) {
        throw new PermissionMaintenanceError(
          "A rollback target changed after the maintenance receipt was created."
        );
      }
      await chmod(entry.path, entry.originalMode);
      entry.applied = false;
    }
    journal.state = "rolled_back";
    journal.updatedAt = this.now();
    await atomicOwnerOnlyJson(this.input.journalPath, journal);
    await atomicOwnerOnlyJson(this.input.receiptPath, {
      version: 1,
      state: "rolled_back",
      rootSha256: pathHash(journal.root),
      rolledBackAt: journal.updatedAt
    });
    return journal;
  }
}
