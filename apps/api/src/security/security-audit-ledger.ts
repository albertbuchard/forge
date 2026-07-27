import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
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
const RETENTION_FILE = ".forge-security-audit-retention.json";

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
  version: 1;
  throughSequence: number;
  throughMac: string;
  priorReceiptMac: string;
  receiptMac: string;
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

  constructor(
    private readonly database: DatabaseSync,
    private readonly key: Uint8Array,
    private readonly dataDirectory: string,
    private readonly options: {
      checkpointInterval?: number;
      maximumRows?: number;
      now?: () => Date;
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

  private writeAnchor(anchor: AuditAnchor) {
    const anchorPath = this.anchorPath();
    const temporaryPath = `${anchorPath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(anchor)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    chmodSync(temporaryPath, 0o600);
    const handle = openSync(temporaryPath, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporaryPath, anchorPath);
    const directory = openSync(this.dataDirectory, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }

  private writePrivateJson(filePath: string, value: object) {
    const temporaryPath = `${filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    chmodSync(temporaryPath, 0o600);
    const handle = openSync(temporaryPath, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporaryPath, filePath);
    const directory = openSync(this.dataDirectory, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
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
    const metadata = lstatSync(filePath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (process.getuid && metadata.uid !== process.getuid())
    ) {
      throw new Error(
        "The Forge security audit retention receipt is not owner-only."
      );
    }
    const value = JSON.parse(
      readFileSync(filePath, "utf8")
    ) as Partial<RetentionReceipt>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.throughSequence) ||
      typeof value.throughMac !== "string" ||
      typeof value.priorReceiptMac !== "string" ||
      typeof value.receiptMac !== "string"
    ) {
      throw new Error("The Forge security audit retention receipt is invalid.");
    }
    const expected = this.mac(
      `retention-receipt/v1\u0000${value.throughSequence}\u0000${value.throughMac}\u0000${value.priorReceiptMac}`
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

  private readAnchor() {
    const anchorPath = this.anchorPath();
    if (!existsSync(anchorPath)) return null;
    const metadata = lstatSync(anchorPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (process.getuid && metadata.uid !== process.getuid())
    ) {
      throw new Error("The Forge security audit anchor is not owner-only.");
    }
    const value = JSON.parse(
      readFileSync(anchorPath, "utf8")
    ) as Partial<AuditAnchor>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.sequence) ||
      Number(value.sequence) < 1 ||
      typeof value.eventMac !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.eventMac)
    ) {
      throw new Error("The Forge security audit anchor is invalid.");
    }
    return value as AuditAnchor;
  }

  verify() {
    const rows = this.database
      .prepare(
        `SELECT sequence, event_id, occurred_at, principal_kind, subject_id,
                client_id, action, resource, outcome, reason, policy_version,
                request_id, connection_id, job_id, detail_json, previous_mac,
                event_mac, checkpoint
           FROM security_audit_events
          ORDER BY sequence ASC`
      )
      .all() as AuditRow[];
    const retainedBase = this.readRetentionState();
    let previousMac = retainedBase.eventMac;
    let previousSequence = retainedBase.sequence;
    for (const row of rows) {
      if (
        row.sequence !== previousSequence + 1 ||
        !secureHexEqual(row.previous_mac, previousMac) ||
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
      previousSequence = row.sequence;
      previousMac = row.event_mac;
    }
    const anchor = this.readAnchor();
    if (anchor) {
      const anchored = rows.find((row) => row.sequence === anchor.sequence);
      if (
        !anchored ||
        anchored.checkpoint !== 1 ||
        !secureHexEqual(anchored.event_mac, anchor.eventMac)
      ) {
        throw new Error(
          "Forge detected security audit checkpoint truncation or mismatch."
        );
      }
    }
    this.lastSequence = previousSequence;
    this.lastMac = previousMac;
    return { entries: rows.length, lastSequence: previousSequence };
  }

  private enforceRetention() {
    const count = Number(
      (
        this.database
          .prepare("SELECT COUNT(*) AS count FROM security_audit_events")
          .get() as { count: number }
      ).count
    );
    if (count <= this.maximumRows()) return;
    const excess = count - this.maximumRows();
    const cutoff = this.database
      .prepare(
        `SELECT sequence, event_mac
           FROM security_audit_events
          WHERE checkpoint = 1
            AND sequence <= (
              SELECT sequence
                FROM security_audit_events
               ORDER BY sequence ASC
               LIMIT 1 OFFSET ?
            )
          ORDER BY sequence DESC
          LIMIT 1`
      )
      .get(excess - 1) as { sequence: number; event_mac: string } | undefined;
    if (!cutoff) return;
    const updatedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const stateMac = this.retentionStateMac(cutoff.sequence, cutoff.event_mac);
    const priorReceiptMac =
      this.readRetentionReceipt()?.receiptMac ?? GENESIS_MAC;
    const receiptMac = this.mac(
      `retention-receipt/v1\u0000${cutoff.sequence}\u0000${cutoff.event_mac}\u0000${priorReceiptMac}`
    );
    this.writePrivateJson(this.retentionPendingPath(), {
      version: 1,
      throughSequence: cutoff.sequence,
      throughMac: cutoff.event_mac,
      priorReceiptMac,
      receiptMac
    } satisfies RetentionReceipt);
    let committed = false;
    this.database.exec("BEGIN IMMEDIATE");
    try {
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
      this.database.exec("COMMIT");
      committed = true;
      renameSync(this.retentionPendingPath(), this.retentionPath());
      const directory = openSync(this.dataDirectory, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      if (!committed) {
        try {
          this.database.exec("ROLLBACK");
        } finally {
          if (existsSync(this.retentionPendingPath())) {
            unlinkSync(this.retentionPendingPath());
          }
        }
      }
      throw error;
    }
  }

  record(event: GatewayAuditEvent) {
    const occurredAt = (this.options.now ?? (() => new Date()))().toISOString();
    const eventId = `security_audit_${randomUUID()}`;
    const sequence = this.lastSequence + 1;
    const checkpoint = sequence % this.checkpointInterval() === 0 ? 1 : 0;
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
    const eventMac = this.mac(canonicalPayload(row));
    this.database
      .prepare(
        `INSERT INTO security_audit_events (
          event_id, occurred_at, principal_kind, subject_id, client_id, action,
          resource, outcome, reason, policy_version, request_id, connection_id,
          job_id, detail_json, previous_mac, event_mac, checkpoint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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
    this.lastSequence = sequence;
    this.lastMac = eventMac;
    if (checkpoint) {
      this.writeAnchor({ version: 1, sequence, eventMac });
      this.enforceRetention();
    }
  }
}
