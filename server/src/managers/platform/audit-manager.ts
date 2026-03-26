import { AbstractAuditedManager } from "../base.js";
import { recordEventLog } from "../../repositories/event-log.js";
import type { AuthContext } from "../contracts.js";

type AuditMetadataValue = string | number | boolean | null;

export class AuditManager extends AbstractAuditedManager {
  readonly name = "AuditManager";

  record(eventKind: string, entityType: string, entityId: string, context: AuthContext, metadata: Record<string, AuditMetadataValue> = {}) {
    recordEventLog({
      eventKind,
      entityType,
      entityId,
      actor: context.actor ?? null,
      source: context.source,
      metadata
    });
  }
}
