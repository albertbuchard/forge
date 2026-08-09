export type MutationReceiptOperation =
  | "entity_update"
  | "entity_soft_delete"
  | "entity_hard_delete"
  | "task_update"
  | "attention_state";

export type MutationReceiptStatus =
  | "available"
  | "undone"
  | "expired"
  | "conflicted"
  | "not_reversible";

export type MutationReceipt = {
  id: string;
  operation: MutationReceiptOperation;
  targetType: string;
  targetId: string;
  targetLabel: string;
  ownerUserId: string | null;
  summary: string;
  status: MutationReceiptStatus;
  reversible: boolean;
  explanation: string;
  expiresAt: string | null;
  createdAt: string;
  undoneAt: string | null;
};

export type MutationReceiptList = {
  receipts: MutationReceipt[];
  limit: number;
};

export type MutationReceiptUndoResult = {
  receipt: MutationReceipt;
  replayed: boolean;
  result: Record<string, unknown>;
};
