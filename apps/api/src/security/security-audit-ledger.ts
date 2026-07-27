import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { GatewayAuditEvent, GatewayAuditSink } from "./access-gateway.js";

export function isClosedSecurityAuditStorageError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ERR_INVALID_STATE" &&
    /database is not open/iu.test(error.message)
  );
}

const GENESIS_MAC = "0".repeat(64);
const ANCHOR_FILE = ".forge-security-audit-anchor.json";
const ANCHOR_PENDING_FILE = `${ANCHOR_FILE}.pending`;
const RETENTION_FILE = ".forge-security-audit-retention.json";
const FORK_RECOVERY_FILE = ".forge-security-audit-fork-recovery.json";

type AuditRow = {
  sequence: number;
  event_id: string;
  occurred_at: string;
  principal_kind: string;
  subject_id: string | null;
  client_id: string | null;
  action: string;
  resource: string;
  outcome: string;
  reason: string;
  policy_version: string;
  request_id: string | null;
  connection_id: string | null;
  job_id: string | null;
  detail_json: string;
  previous_mac: string;
  event_mac: string;
  checkpoint: number;
};

type AuditAnchor = {
  version: 1;
  sequence: number;
  eventMac: string;
};

type RetentionState = {
  base_sequence: number;
  base_mac: string;
  state_mac: string;
  updated_at: string;
};

type RetentionReceipt = {
  version: 1 | 2;
  throughSequence: number;
  throughMac: string;
  priorReceiptMac: string;
  forkRecoveryReceiptMac?: string;
  receiptMac: string;
};

type ForkRecoveryReceipt = {
  version: 1;
  baseSequence: number;
  baseMac: string;
  anchorSequence: number | null;
  anchorEventMac: string | null;
  throughSequence: number;
  throughEventMac: string;
  rowSetSha256: string;
  createdAt: string;
  receiptMac: string;
};

export type SecurityAuditForkInspection = {
  entries: number;
  lastSequence: number;
  forkSequences: number[];
  recoveryRequired: boolean;
  recoveryReceiptExists: boolean;
  recoveryReceiptPath: string;
};

function canonicalPayload(
  row: Omit<AuditRow, "sequence" | "event_mac" | "checkpoint">
) {
  if (row.connection_id === null && row.job_id === null) {
    return JSON.stringify([
      row.event_id,
      row.occurred_at,
      row.principal_kind,
      row.subject_id,
      row.client_id,
      row.action,
      row.resource,
      row.outcome,
      row.reason,
      row.policy_version,
      row.request_id,
      row.detail_json,
      row.previous_mac
    ]);
  }
  return JSON.stringify([
    "security-audit-event/v2",
    row.event_id,
    row.occurred_at,
    row.principal_kind,
    row.subject_id,
    row.client_id,
    row.action,
    row.resource,
    row.outcome,
    row.reason,
    row.policy_version,
    row.request_id,
    row.connection_id,
    row.job_id,
    row.detail_json,
    row.previous_mac
  ]);
}

function secureHexEqual(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/u.test(left) || !/^[0-9a-f]{64}$/u.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export class TamperEvidentGatewayAuditLedger implements GatewayAuditSink {
  private lastSequence = 0;
  private lastMac = GENESIS_MAC;
  private forkInspection: SecurityAuditForkInspection | null = null;

  constructor(
    private readonly database: DatabaseSync,
    private readonly key: Uint8Array,
    private readonly dataDirectory: string,
    private readonly options: {
      checkpointInterval?: number;
      maximumRows?: number;
      now?: () => Date;
      forkRecoveryMode?: "inspect" | "apply";
    } = {}
  ) {
    if (key.byteLength < 32) {
      throw new Error("The security audit key must contain at least 32 bytes.");
    }
    const interval = this.checkpointInterval();
    if (!Number.isSafeInteger(interval) || interval < 1) {
      throw new Error(
        "The security audit checkpoint interval must be a positive integer."
      );
    }
    if (
      !Number.isSafeInteger(this.maximumRows()) ||
      this.maximumRows() < interval * 2
    ) {
      throw new Error(
        "The security audit retention bound must cover at least two checkpoint intervals."
      );
    }
    this.verify();
  }

  getForkInspection() {
    return this.forkInspection;
  }

  private checkpointInterval() {
    return this.options.checkpointInterval ?? 100;
  }

  private maximumRows() {
    return this.options.maximumRows ?? 100_000;
  }

  private mac(payload: string) {
    return createHmac("sha256", this.key).update(payload, "utf8").digest("hex");
  }

  private anchorPath() {
    return path.join(this.dataDirectory, ANCHOR_FILE);
  }

  private retentionPath() {
    return path.join(this.dataDirectory, RETENTION_FILE);
  }

  private retentionPendingPath() {
    return `${this.retentionPath()}.pending`;
  }

  private anchorPendingPath() {
    return path.join(this.dataDirectory, ANCHOR_PENDING_FILE);
  }

  private forkRecoveryPath() {
    return path.join(this.dataDirectory, FORK_RECOVERY_FILE);
  }

  private forkRecoveryMac(payload: string) {
    const recoveryKey = createHmac("sha256", this.key)
      .update("security-audit-fork-recovery-key/v1", "utf8")
      .digest();
    return createHmac("sha256", recoveryKey)
      .update(payload, "utf8")
      .digest("hex");
  }

  private rowSetSha256(rows: readonly AuditRow[]) {
    return createHash("sha256")
      .update(
        JSON.stringify(
          rows.map((row) => [
            row.sequence,
            row.previous_mac,
            row.event_mac,
            row.checkpoint
          ])
        ),
        "utf8"
      )
      .digest("hex");
  }

  private writePrivateJson(filePath: string, value: object) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const handle = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(handle, `${JSON.stringify(value)}\n`, {
        encoding: "utf8"
      });
      chmodSync(temporaryPath, 0o600);
      fsyncSync(handle);
    } catch (error) {
      closeSync(handle);
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
      throw error;
    } finally {
      try {
        closeSync(handle);
      } catch {
        // The error path already closed the handle.
      }
    }
    try {
      renameSync(temporaryPath, filePath);
    } catch (error) {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
      throw error;
    }
    const directory = openSync(this.dataDirectory, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }

  private writePrivateJsonExclusive(filePath: string, value: object) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const handle = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(handle, `${JSON.stringify(value)}\n`, {
        encoding: "utf8"
      });
      chmodSync(temporaryPath, 0o600);
      fsyncSync(handle);
    } catch (error) {
      closeSync(handle);
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
      throw error;
    } finally {
      try {
        closeSync(handle);
      } catch {
        // The error path already closed the handle.
      }
    }
    try {
      linkSync(temporaryPath, filePath);
      unlinkSync(temporaryPath);
      const directory = openSync(this.dataDirectory, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
      throw error;
    }
  }

  private readPrivateJsonFile(filePath: string, label: string) {
    const metadata = lstatSync(filePath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (process.getuid && metadata.uid !== process.getuid())
    ) {
      throw new Error(`${label} is not an owner-only regular file.`);
    }
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  }

  private readAnchorFile(filePath: string, label: string): AuditAnchor {
    const value = this.readPrivateJsonFile(filePath, label);
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.sequence) ||
      Number(value.sequence) < 1 ||
      typeof value.eventMac !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.eventMac)
    ) {
      throw new Error(`${label} is invalid.`);
    }
    return value as AuditAnchor;
  }

  private recoverPendingAnchor() {
    const pendingPath = this.anchorPendingPath();
    if (!existsSync(pendingPath)) return;
    const pending = this.readAnchorFile(
      pendingPath,
      "The Forge security audit pending anchor"
    );
    const row = this.database
      .prepare(
        `SELECT sequence, event_mac, checkpoint
           FROM security_audit_events
          WHERE sequence = ?`
      )
      .get(pending.sequence) as
      | { sequence: number; event_mac: string; checkpoint: number }
      | undefined;
    if (
      !row ||
      row.checkpoint !== 1 ||
      !secureHexEqual(row.event_mac, pending.eventMac)
    ) {
      unlinkSync(pendingPath);
      return;
    }
    const current = this.readAnchorRaw();
    if (current && current.sequence > pending.sequence) {
      unlinkSync(pendingPath);
      return;
    }
    if (
      current &&
      current.sequence === pending.sequence &&
      !secureHexEqual(current.eventMac, pending.eventMac)
    ) {
      throw new Error("Forge detected conflicting security audit anchors.");
    }
    renameSync(pendingPath, this.anchorPath());
    const directory = openSync(this.dataDirectory, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }

  private recoverPendingArtifacts() {
    this.recoverPendingAnchor();
    this.recoverPendingRetentionReceipt();
  }

  private retentionStateMac(sequence: number, eventMac: string) {
    return this.mac(`retention-state/v1\u0000${sequence}\u0000${eventMac}`);
  }

  private recoverPendingRetentionReceipt() {
    const pendingPath = this.retentionPendingPath();
    if (!existsSync(pendingPath)) return;
    const pending = this.readRetentionReceiptFile(pendingPath);
    const row = this.database
      .prepare(
        `SELECT base_sequence, base_mac
           FROM security_audit_retention_state
          WHERE singleton = 1`
      )
      .get() as { base_sequence: number; base_mac: string } | undefined;
    if (
      row &&
      row.base_sequence === pending.throughSequence &&
      secureHexEqual(row.base_mac, pending.throughMac)
    ) {
      renameSync(pendingPath, this.retentionPath());
      const directory = openSync(this.dataDirectory, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      return;
    }
    unlinkSync(pendingPath);
  }

  private readRetentionState() {
    this.recoverPendingRetentionReceipt();
    const row = this.database
      .prepare(
        `SELECT base_sequence, base_mac, state_mac, updated_at
           FROM security_audit_retention_state
          WHERE singleton = 1`
      )
      .get() as RetentionState | undefined;
    const receipt = this.readRetentionReceipt();
    if (!row) {
      if (receipt) {
        throw new Error(
          "Forge detected a security audit retention receipt without matching state."
        );
      }
      return { sequence: 0, eventMac: GENESIS_MAC };
    }
    if (
      !Number.isSafeInteger(row.base_sequence) ||
      row.base_sequence < 1 ||
      !secureHexEqual(
        row.state_mac,
        this.retentionStateMac(row.base_sequence, row.base_mac)
      )
    ) {
      throw new Error(
        "Forge detected security audit retention-state corruption."
      );
    }
    if (
      !receipt ||
      receipt.throughSequence !== row.base_sequence ||
      !secureHexEqual(receipt.throughMac, row.base_mac)
    ) {
      throw new Error(
        "Forge detected security audit retention receipt/state mismatch."
      );
    }
    return { sequence: row.base_sequence, eventMac: row.base_mac };
  }

  private readRetentionReceiptFile(filePath: string): RetentionReceipt {
    const value = this.readPrivateJsonFile(
      filePath,
      "The Forge security audit retention receipt"
    ) as Partial<RetentionReceipt>;
    if (
      (value.version !== 1 && value.version !== 2) ||
      !Number.isSafeInteger(value.throughSequence) ||
      typeof value.throughMac !== "string" ||
      typeof value.priorReceiptMac !== "string" ||
      typeof value.receiptMac !== "string"
    ) {
      throw new Error("The Forge security audit retention receipt is invalid.");
    }
    if (
      value.version === 2 &&
      (typeof value.forkRecoveryReceiptMac !== "string" ||
        !/^[0-9a-f]{64}$/u.test(value.forkRecoveryReceiptMac))
    ) {
      throw new Error("The Forge security audit retention receipt is invalid.");
    }
    const expected =
      value.version === 1
        ? this.mac(
            `retention-receipt/v1\u0000${value.throughSequence}\u0000${value.throughMac}\u0000${value.priorReceiptMac}`
          )
        : this.mac(
            `retention-receipt/v2\u0000${value.throughSequence}\u0000${value.throughMac}\u0000${value.priorReceiptMac}\u0000${value.forkRecoveryReceiptMac}`
          );
    if (!secureHexEqual(value.receiptMac, expected)) {
      throw new Error("The Forge security audit retention receipt is corrupt.");
    }
    return value as RetentionReceipt;
  }

  private readRetentionReceipt(): RetentionReceipt | null {
    const filePath = this.retentionPath();
    return existsSync(filePath)
      ? this.readRetentionReceiptFile(filePath)
      : null;
  }

  private readAnchorRaw() {
    const anchorPath = this.anchorPath();
    if (!existsSync(anchorPath)) return null;
    return this.readAnchorFile(anchorPath, "The Forge security audit anchor");
  }

  private forkRecoveryReceiptPayload(
    value: Omit<ForkRecoveryReceipt, "receiptMac">
  ) {
    return [
      "security-audit-fork-recovery/v1",
      value.baseSequence,
      value.baseMac,
      value.anchorSequence ?? "",
      value.anchorEventMac ?? "",
      value.throughSequence,
      value.throughEventMac,
      value.rowSetSha256,
      value.createdAt
    ].join("\u0000");
  }

  private readForkRecoveryReceipt(): ForkRecoveryReceipt | null {
    const receiptPath = this.forkRecoveryPath();
    if (!existsSync(receiptPath)) return null;
    const value = this.readPrivateJsonFile(
      receiptPath,
      "The Forge security audit fork-recovery receipt"
    ) as Partial<ForkRecoveryReceipt>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.baseSequence) ||
      Number(value.baseSequence) < 0 ||
      typeof value.baseMac !== "string" ||
      (value.anchorSequence !== null &&
        (!Number.isSafeInteger(value.anchorSequence) ||
          Number(value.anchorSequence) < 1)) ||
      (value.anchorEventMac !== null &&
        typeof value.anchorEventMac !== "string") ||
      (value.anchorSequence === null) !== (value.anchorEventMac === null) ||
      !Number.isSafeInteger(value.throughSequence) ||
      Number(value.throughSequence) <= Number(value.baseSequence) ||
      typeof value.throughEventMac !== "string" ||
      typeof value.rowSetSha256 !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.receiptMac !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.baseMac) ||
      (typeof value.anchorEventMac === "string" &&
        !/^[0-9a-f]{64}$/u.test(value.anchorEventMac)) ||
      !/^[0-9a-f]{64}$/u.test(value.throughEventMac) ||
      !/^[0-9a-f]{64}$/u.test(value.rowSetSha256) ||
      !/^[0-9a-f]{64}$/u.test(value.receiptMac) ||
      !Number.isFinite(Date.parse(value.createdAt))
    ) {
      throw new Error(
        "The Forge security audit fork-recovery receipt is invalid."
      );
    }
    const receipt = value as ForkRecoveryReceipt;
    const expected = this.forkRecoveryMac(
      this.forkRecoveryReceiptPayload(receipt)
    );
    if (!secureHexEqual(receipt.receiptMac, expected)) {
      throw new Error(
        "The Forge security audit fork-recovery receipt is corrupt."
      );
    }
    return receipt;
  }

  private analyzeAuthenticatedRows(
    rows: readonly AuditRow[],
    base: { sequence: number; eventMac: string }
  ) {
    let previousSequence = base.sequence;
    let immediatelyPreviousMac = base.eventMac;
    const authenticatedMacs = new Set([base.eventMac]);
    const forkSequences: number[] = [];
    for (const row of rows) {
      if (row.sequence !== previousSequence + 1) {
        throw new Error(
          `Forge detected security audit sequence corruption at sequence ${row.sequence}.`
        );
      }
      if (!authenticatedMacs.has(row.previous_mac)) {
        throw new Error(
          `Forge detected unreachable security audit ancestry at sequence ${row.sequence}.`
        );
      }
      const expectedCheckpoint =
        row.sequence % this.checkpointInterval() === 0 ? 1 : 0;
      if (row.checkpoint !== expectedCheckpoint) {
        throw new Error(
          `Forge detected security audit checkpoint corruption at sequence ${row.sequence}.`
        );
      }
      if (
        !secureHexEqual(
          row.event_mac,
          this.mac(
            canonicalPayload({
              event_id: row.event_id,
              occurred_at: row.occurred_at,
              principal_kind: row.principal_kind,
              subject_id: row.subject_id,
              client_id: row.client_id,
              action: row.action,
              resource: row.resource,
              outcome: row.outcome,
              reason: row.reason,
              policy_version: row.policy_version,
              request_id: row.request_id,
              connection_id: row.connection_id,
              job_id: row.job_id,
              detail_json: row.detail_json,
              previous_mac: row.previous_mac
            })
          )
        ) ||
        authenticatedMacs.has(row.event_mac)
      ) {
        throw new Error(
          `Forge detected security audit chain corruption at sequence ${row.sequence}.`
        );
      }
      if (!secureHexEqual(row.previous_mac, immediatelyPreviousMac)) {
        forkSequences.push(row.sequence);
      }
      authenticatedMacs.add(row.event_mac);
      immediatelyPreviousMac = row.event_mac;
      previousSequence = row.sequence;
    }
    return {
      forkSequences,
      lastSequence: previousSequence,
      lastMac: immediatelyPreviousMac
    };
  }

  private writeForkRecoveryReceipt(
    rows: readonly AuditRow[],
    base: { sequence: number; eventMac: string },
    anchor: AuditAnchor | null
  ) {
    const last = rows.at(-1);
    if (!last) {
      throw new Error("Forge found no security audit fork to recover.");
    }
    const receiptWithoutMac = {
      version: 1 as const,
      baseSequence: base.sequence,
      baseMac: base.eventMac,
      anchorSequence: anchor?.sequence ?? null,
      anchorEventMac: anchor?.eventMac ?? null,
      throughSequence: last.sequence,
      throughEventMac: last.event_mac,
      rowSetSha256: this.rowSetSha256(rows),
      createdAt: (this.options.now ?? (() => new Date()))().toISOString()
    };
    const receipt: ForkRecoveryReceipt = {
      ...receiptWithoutMac,
      receiptMac: this.forkRecoveryMac(
        this.forkRecoveryReceiptPayload(receiptWithoutMac)
      )
    };
    this.writePrivateJsonExclusive(this.forkRecoveryPath(), receipt);
    return receipt;
  }

  private loadAuditRows() {
    return this.database
      .prepare(
        `SELECT sequence, event_id, occurred_at, principal_kind, subject_id,
                client_id, action, resource, outcome, reason, policy_version,
                request_id, connection_id, job_id, detail_json, previous_mac,
                event_mac, checkpoint
          FROM security_audit_events
         ORDER BY sequence ASC`
      )
      .all() as AuditRow[];
  }

  private expectedAnchor(
    rows: readonly AuditRow[],
    base: { sequence: number; eventMac: string },
    lastSequence: number
  ): AuditAnchor | null {
    const sequence =
      Math.floor(lastSequence / this.checkpointInterval()) *
      this.checkpointInterval();
    if (sequence === 0) return null;
    if (sequence === base.sequence) {
      return { version: 1, sequence, eventMac: base.eventMac };
    }
    const row = rows.find((candidate) => candidate.sequence === sequence);
    if (!row || row.checkpoint !== 1) {
      throw new Error(
        "Forge detected security audit checkpoint truncation or mismatch."
      );
    }
    return { version: 1, sequence, eventMac: row.event_mac };
  }

  private validateLatestAnchor(lastSequence: number) {
    const sequence =
      Math.floor(lastSequence / this.checkpointInterval()) *
      this.checkpointInterval();
    const anchor = this.readAnchorRaw();
    if (sequence === 0) {
      if (anchor) {
        throw new Error(
          "Forge detected security audit checkpoint truncation or mismatch."
        );
      }
      return;
    }
    const row = this.database
      .prepare(
        `SELECT event_mac, checkpoint
           FROM security_audit_events
          WHERE sequence = ?`
      )
      .get(sequence) as { event_mac: string; checkpoint: number } | undefined;
    if (
      !anchor ||
      anchor.sequence !== sequence ||
      !row ||
      row.checkpoint !== 1 ||
      !secureHexEqual(anchor.eventMac, row.event_mac)
    ) {
      throw new Error(
        "Forge detected security audit checkpoint truncation or mismatch."
      );
    }
  }

  private withImmediateTransaction<T>(operation: () => T) {
    if (this.database.isTransaction) {
      return operation();
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private withReadTransaction<T>(operation: () => T) {
    if (this.database.isTransaction) {
      return operation();
    }
    this.database.exec("BEGIN");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private verifyUnderLock() {
    const rows = this.loadAuditRows();
    const retainedBase = this.readRetentionState();
    const retentionReceipt = this.readRetentionReceipt();
    let recoveryReceipt = this.readForkRecoveryReceipt();
    if (
      !recoveryReceipt &&
      retentionReceipt?.version === 2 &&
      retentionReceipt.forkRecoveryReceiptMac
    ) {
      throw new Error(
        "Forge detected a missing security audit fork-recovery receipt after retention handoff."
      );
    }
    const analysis = this.analyzeAuthenticatedRows(rows, retainedBase);
    const expectedAnchor = this.expectedAnchor(
      rows,
      retainedBase,
      analysis.lastSequence
    );
    const anchor = this.readAnchorRaw();
    if (
      (expectedAnchor === null) !== (anchor === null) ||
      (expectedAnchor &&
        anchor &&
        (anchor.sequence !== expectedAnchor.sequence ||
          !secureHexEqual(anchor.eventMac, expectedAnchor.eventMac)))
    ) {
      throw new Error(
        "Forge detected security audit checkpoint truncation or mismatch."
      );
    }
    const unsealedForks = recoveryReceipt ? [] : analysis.forkSequences;
    if (
      this.options.forkRecoveryMode === "apply" &&
      unsealedForks.length === 0
    ) {
      throw new Error(
        "Forge refused an unnecessary security audit fork-recovery receipt."
      );
    }
    if (unsealedForks.length > 0) {
      if (!this.options.forkRecoveryMode) {
        throw new Error(
          `Forge detected security audit chain corruption at sequence ${unsealedForks[0]}.`
        );
      }
      if (this.options.forkRecoveryMode === "apply") {
        recoveryReceipt = this.writeForkRecoveryReceipt(
          rows,
          retainedBase,
          anchor
        );
      }
    }
    if (recoveryReceipt) {
      if (
        retainedBase.sequence < recoveryReceipt.baseSequence ||
        (retainedBase.sequence === recoveryReceipt.baseSequence &&
          !secureHexEqual(retainedBase.eventMac, recoveryReceipt.baseMac))
      ) {
        throw new Error(
          "Forge detected security audit fork-recovery base corruption."
        );
      }
      if (retainedBase.sequence > recoveryReceipt.baseSequence) {
        if (
          retentionReceipt?.version !== 2 ||
          !retentionReceipt.forkRecoveryReceiptMac ||
          !secureHexEqual(
            retentionReceipt.forkRecoveryReceiptMac,
            recoveryReceipt.receiptMac
          )
        ) {
          throw new Error(
            "Forge detected a missing security audit retention handoff for the recovered fork."
          );
        }
      }
      if (recoveryReceipt.anchorSequence !== null) {
        if (
          !anchor ||
          anchor.sequence < recoveryReceipt.anchorSequence ||
          (retainedBase.sequence < recoveryReceipt.anchorSequence &&
            !rows.some(
              (row) =>
                row.sequence === recoveryReceipt.anchorSequence &&
                secureHexEqual(
                  row.event_mac,
                  recoveryReceipt.anchorEventMac ?? ""
                )
            )) ||
          (retainedBase.sequence === recoveryReceipt.anchorSequence &&
            !secureHexEqual(
              retainedBase.eventMac,
              recoveryReceipt.anchorEventMac ?? ""
            ))
        ) {
          throw new Error(
            "Forge detected security audit fork-recovery anchor corruption."
          );
        }
      }
      const coveredRows = rows.filter(
        (row) => row.sequence <= recoveryReceipt.throughSequence
      );
      if (retainedBase.sequence < recoveryReceipt.throughSequence) {
        const throughRow = coveredRows.at(-1);
        if (
          !throughRow ||
          throughRow.sequence !== recoveryReceipt.throughSequence ||
          !secureHexEqual(throughRow.event_mac, recoveryReceipt.throughEventMac)
        ) {
          throw new Error(
            "Forge detected security audit fork-recovery truncation."
          );
        }
        if (
          retainedBase.sequence === recoveryReceipt.baseSequence &&
          this.rowSetSha256(coveredRows) !== recoveryReceipt.rowSetSha256
        ) {
          throw new Error(
            "Forge detected security audit fork-recovery row-set corruption."
          );
        }
      }
      const newFork = analysis.forkSequences.find(
        (sequence) => sequence > recoveryReceipt.throughSequence
      );
      if (newFork) {
        throw new Error(
          `Forge detected security audit chain corruption at sequence ${newFork}.`
        );
      }
    }
    this.lastSequence = analysis.lastSequence;
    this.lastMac = analysis.lastMac;
    this.forkInspection = {
      entries: rows.length,
      lastSequence: analysis.lastSequence,
      forkSequences: analysis.forkSequences,
      recoveryRequired:
        analysis.forkSequences.length > 0 && recoveryReceipt === null,
      recoveryReceiptExists: recoveryReceipt !== null,
      recoveryReceiptPath: this.forkRecoveryPath()
    };
    return { entries: rows.length, lastSequence: analysis.lastSequence };
  }

  verify() {
    const transaction = this.options.forkRecoveryMode
      ? this.withReadTransaction.bind(this)
      : this.withImmediateTransaction.bind(this);
    return transaction(() => {
      if (this.options.forkRecoveryMode) {
        if (
          existsSync(this.anchorPendingPath()) ||
          existsSync(this.retentionPendingPath())
        ) {
          throw new Error(
            "Forge audit recovery refused unresolved pending audit artifacts."
          );
        }
      } else {
        this.recoverPendingArtifacts();
      }
      return this.verifyUnderLock();
    });
  }

  private enforceRetentionUnderLock() {
    const count = Number(
      (
        this.database
          .prepare("SELECT COUNT(*) AS count FROM security_audit_events")
          .get() as { count: number }
      ).count
    );
    if (count <= this.maximumRows()) return false;
    const invalidCheckpoint = this.database
      .prepare(
        `SELECT sequence
           FROM security_audit_events
          WHERE checkpoint != CASE WHEN sequence % ? = 0 THEN 1 ELSE 0 END
          ORDER BY sequence ASC
          LIMIT 1`
      )
      .get(this.checkpointInterval()) as { sequence: number } | undefined;
    if (invalidCheckpoint) {
      throw new Error(
        `Forge detected security audit checkpoint corruption at sequence ${invalidCheckpoint.sequence}.`
      );
    }
    const excess = count - this.maximumRows();
    const cutoff = this.database
      .prepare(
        `SELECT sequence, event_mac
           FROM security_audit_events
          WHERE sequence % ? = 0
            AND sequence <= (
              SELECT sequence
                FROM security_audit_events
               ORDER BY sequence ASC
               LIMIT 1 OFFSET ?
            )
          ORDER BY sequence DESC
          LIMIT 1`
      )
      .get(this.checkpointInterval(), excess - 1) as
      | { sequence: number; event_mac: string }
      | undefined;
    if (!cutoff) return false;
    const recoveryReceipt = this.readForkRecoveryReceipt();
    if (recoveryReceipt && cutoff.sequence < recoveryReceipt.throughSequence) {
      return false;
    }
    const updatedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const stateMac = this.retentionStateMac(cutoff.sequence, cutoff.event_mac);
    const priorReceiptMac =
      this.readRetentionReceipt()?.receiptMac ?? GENESIS_MAC;
    const receipt: RetentionReceipt = recoveryReceipt
      ? {
          version: 2,
          throughSequence: cutoff.sequence,
          throughMac: cutoff.event_mac,
          priorReceiptMac,
          forkRecoveryReceiptMac: recoveryReceipt.receiptMac,
          receiptMac: this.mac(
            `retention-receipt/v2\u0000${cutoff.sequence}\u0000${cutoff.event_mac}\u0000${priorReceiptMac}\u0000${recoveryReceipt.receiptMac}`
          )
        }
      : {
          version: 1,
          throughSequence: cutoff.sequence,
          throughMac: cutoff.event_mac,
          priorReceiptMac,
          receiptMac: this.mac(
            `retention-receipt/v1\u0000${cutoff.sequence}\u0000${cutoff.event_mac}\u0000${priorReceiptMac}`
          )
        };
    this.writePrivateJson(this.retentionPendingPath(), receipt);
    this.database
      .prepare(
        `INSERT INTO security_audit_retention_state (
           singleton, base_sequence, base_mac, state_mac, updated_at
         ) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           base_sequence = excluded.base_sequence,
           base_mac = excluded.base_mac,
           state_mac = excluded.state_mac,
           updated_at = excluded.updated_at`
      )
      .run(cutoff.sequence, cutoff.event_mac, stateMac, updatedAt);
    this.database
      .prepare("DELETE FROM security_audit_events WHERE sequence <= ?")
      .run(cutoff.sequence);
    return true;
  }

  private synchronizeTailUnderLock() {
    const retainedBase = this.readRetentionState();
    const maximum = this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), ?) AS sequence FROM security_audit_events"
      )
      .get(retainedBase.sequence) as { sequence: number };
    if (
      retainedBase.sequence > this.lastSequence ||
      maximum.sequence < this.lastSequence
    ) {
      this.verifyUnderLock();
      return;
    }
    const rows = this.database
      .prepare(
        `SELECT sequence, event_id, occurred_at, principal_kind, subject_id,
                client_id, action, resource, outcome, reason, policy_version,
                request_id, connection_id, job_id, detail_json, previous_mac,
                event_mac, checkpoint
           FROM security_audit_events
          WHERE sequence > ?
          ORDER BY sequence ASC`
      )
      .all(this.lastSequence) as AuditRow[];
    let expectedSequence = this.lastSequence;
    let expectedMac = this.lastMac;
    for (const row of rows) {
      const expectedCheckpoint =
        row.sequence % this.checkpointInterval() === 0 ? 1 : 0;
      if (
        row.sequence !== expectedSequence + 1 ||
        row.checkpoint !== expectedCheckpoint ||
        !secureHexEqual(row.previous_mac, expectedMac) ||
        !secureHexEqual(
          row.event_mac,
          this.mac(
            canonicalPayload({
              event_id: row.event_id,
              occurred_at: row.occurred_at,
              principal_kind: row.principal_kind,
              subject_id: row.subject_id,
              client_id: row.client_id,
              action: row.action,
              resource: row.resource,
              outcome: row.outcome,
              reason: row.reason,
              policy_version: row.policy_version,
              request_id: row.request_id,
              connection_id: row.connection_id,
              job_id: row.job_id,
              detail_json: row.detail_json,
              previous_mac: row.previous_mac
            })
          )
        )
      ) {
        throw new Error(
          `Forge detected security audit chain corruption at sequence ${row.sequence}.`
        );
      }
      expectedSequence = row.sequence;
      expectedMac = row.event_mac;
    }
    this.validateLatestAnchor(expectedSequence);
    this.lastSequence = expectedSequence;
    this.lastMac = expectedMac;
  }

  record(event: GatewayAuditEvent) {
    if (this.database.isTransaction) {
      throw new Error(
        "Forge security audit records require their own serialized transaction."
      );
    }
    let sequence = 0;
    let eventMac = GENESIS_MAC;
    let checkpoint = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.recoverPendingArtifacts();
      this.synchronizeTailUnderLock();
      const occurredAt = (
        this.options.now ?? (() => new Date())
      )().toISOString();
      const eventId = `security_audit_${randomUUID()}`;
      sequence = this.lastSequence + 1;
      checkpoint = sequence % this.checkpointInterval() === 0 ? 1 : 0;
      const row = {
        event_id: eventId,
        occurred_at: occurredAt,
        principal_kind: event.principalKind,
        subject_id: event.subjectId,
        client_id: event.clientId,
        action: event.action,
        resource: event.resource,
        outcome: event.outcome,
        reason: event.reason,
        policy_version: event.policyVersion,
        request_id: event.requestId,
        connection_id: event.connectionId ?? null,
        job_id: event.jobId ?? null,
        detail_json: JSON.stringify({
          method: event.method,
          routePath: event.routePath
        }),
        previous_mac: this.lastMac
      };
      eventMac = this.mac(canonicalPayload(row));
      this.database
        .prepare(
          `INSERT INTO security_audit_events (
            sequence, event_id, occurred_at, principal_kind, subject_id,
            client_id, action, resource, outcome, reason, policy_version,
            request_id, connection_id, job_id, detail_json, previous_mac,
            event_mac, checkpoint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sequence,
          row.event_id,
          row.occurred_at,
          row.principal_kind,
          row.subject_id,
          row.client_id,
          row.action,
          row.resource,
          row.outcome,
          row.reason,
          row.policy_version,
          row.request_id,
          row.connection_id,
          row.job_id,
          row.detail_json,
          row.previous_mac,
          eventMac,
          checkpoint
        );
      if (checkpoint) {
        this.writePrivateJson(this.anchorPendingPath(), {
          version: 1,
          sequence,
          eventMac
        } satisfies AuditAnchor);
        this.enforceRetentionUnderLock();
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        if (this.database.isTransaction) {
          this.database.exec("ROLLBACK");
        }
      } finally {
        if (existsSync(this.anchorPendingPath())) {
          unlinkSync(this.anchorPendingPath());
        }
        if (existsSync(this.retentionPendingPath())) {
          unlinkSync(this.retentionPendingPath());
        }
      }
      throw error;
    }
    this.lastSequence = sequence;
    this.lastMac = eventMac;
    if (checkpoint) {
      this.withImmediateTransaction(() => this.recoverPendingArtifacts());
    }
  }
}
