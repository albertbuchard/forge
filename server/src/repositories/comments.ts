import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { filterDeletedEntities, isEntityDeleted } from "./deleted-entities.js";
import { recordActivityEvent } from "./activity-events.js";
import { recordEventLog } from "./event-log.js";
import {
  commentSchema,
  commentsListQuerySchema,
  createCommentSchema,
  updateCommentSchema,
  type Comment,
  type CommentsListQuery,
  type CreateCommentInput,
  type UpdateCommentInput
} from "../psyche-types.js";
import { activityEntityTypeSchema, type ActivitySource } from "../types.js";

type CommentRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  anchor_key: string | null;
  body: string;
  author: string | null;
  source: ActivitySource;
  created_at: string;
  updated_at: string;
};

type CommentContext = {
  source: ActivitySource;
  actor?: string | null;
};

function mapComment(row: CommentRow): Comment {
  return commentSchema.parse({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    anchorKey: row.anchor_key,
    body: row.body,
    author: row.author,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function getCommentRow(commentId: string): CommentRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT id, entity_type, entity_id, anchor_key, body, author, source, created_at, updated_at
       FROM entity_comments
       WHERE id = ?`
    )
    .get(commentId) as CommentRow | undefined;
}

export function getCommentById(commentId: string): Comment | undefined {
  if (isEntityDeleted("comment", commentId)) {
    return undefined;
  }
  const row = getCommentRow(commentId);
  return row ? mapComment(row) : undefined;
}

export function listComments(query: CommentsListQuery = {}): Comment[] {
  const parsed = commentsListQuerySchema.parse(query);
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];
  if (parsed.entityType) {
    whereClauses.push("entity_type = ?");
    params.push(parsed.entityType);
  }
  if (parsed.entityId) {
    whereClauses.push("entity_id = ?");
    params.push(parsed.entityId);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limitSql = parsed.limit ? "LIMIT ?" : "";
  if (parsed.limit) {
    params.push(parsed.limit);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT id, entity_type, entity_id, anchor_key, body, author, source, created_at, updated_at
       FROM entity_comments
       ${whereSql}
       ORDER BY created_at DESC
       ${limitSql}`
    )
    .all(...params) as CommentRow[];
  return filterDeletedEntities("comment", rows.map(mapComment));
}

export function createComment(input: CreateCommentInput, context: CommentContext): Comment {
  const parsed = createCommentSchema.parse(input);
  const now = new Date().toISOString();
  const comment = commentSchema.parse({
    id: `cmt_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    anchorKey: parsed.anchorKey,
    body: parsed.body,
    author: parsed.author ?? context.actor ?? null,
    source: context.source,
    createdAt: now,
    updatedAt: now
  });
  const entityType = activityEntityTypeSchema.parse(comment.entityType);

  getDatabase()
    .prepare(
      `INSERT INTO entity_comments (id, entity_type, entity_id, anchor_key, body, author, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      comment.id,
      comment.entityType,
      comment.entityId,
      comment.anchorKey,
      comment.body,
      comment.author,
      comment.source,
      comment.createdAt,
      comment.updatedAt
    );

  recordActivityEvent({
    entityType,
    entityId: comment.entityId,
    eventType: "comment.created",
    title: "Comment added",
    description: comment.body,
    actor: comment.author ?? null,
    source: context.source,
    metadata: {
      commentId: comment.id,
      anchorKey: comment.anchorKey ?? ""
    }
  });

  recordEventLog({
    eventKind: "comment.created",
    entityType,
    entityId: comment.entityId,
    actor: comment.author ?? null,
    source: context.source,
    metadata: {
      commentId: comment.id,
      anchorKey: comment.anchorKey ?? ""
    }
  });

  return comment;
}

export function updateComment(commentId: string, input: UpdateCommentInput, context: CommentContext): Comment | undefined {
  const existing = getCommentRow(commentId);
  if (!existing) {
    return undefined;
  }
  const patch = updateCommentSchema.parse(input);
  const updatedAt = new Date().toISOString();
  const author = patch.author ?? existing.author ?? context.actor ?? null;
  const entityType = activityEntityTypeSchema.parse(existing.entity_type);

  getDatabase()
    .prepare(
      `UPDATE entity_comments
       SET body = ?, author = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(patch.body, author, updatedAt, commentId);

  recordActivityEvent({
    entityType,
    entityId: existing.entity_id,
    eventType: "comment.updated",
    title: "Comment updated",
    description: patch.body,
    actor: author,
    source: context.source,
    metadata: {
      commentId
    }
  });

  recordEventLog({
    eventKind: "comment.updated",
    entityType,
    entityId: existing.entity_id,
    actor: author,
    source: context.source,
    metadata: {
      commentId
    }
  });

  return mapComment(getCommentRow(commentId)!);
}

export function deleteComment(commentId: string, context: CommentContext): Comment | undefined {
  const existing = getCommentRow(commentId);
  if (!existing) {
    return undefined;
  }
  const entityType = activityEntityTypeSchema.parse(existing.entity_type);

  getDatabase()
    .prepare(`DELETE FROM entity_comments WHERE id = ?`)
    .run(commentId);

  recordActivityEvent({
    entityType,
    entityId: existing.entity_id,
    eventType: "comment.deleted",
    title: "Comment deleted",
    description: existing.body,
    actor: context.actor ?? existing.author ?? null,
    source: context.source,
    metadata: {
      commentId
    }
  });

  recordEventLog({
    eventKind: "comment.deleted",
    entityType,
    entityId: existing.entity_id,
    actor: context.actor ?? existing.author ?? null,
    source: context.source,
    metadata: {
      commentId
    }
  });

  return mapComment(existing);
}
