import { AbstractAuditedManager } from "../base.js";
import { recordEventLog } from "../../repositories/event-log.js";
export class AuditManager extends AbstractAuditedManager {
    name = "AuditManager";
    record(eventKind, entityType, entityId, context, metadata = {}) {
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
