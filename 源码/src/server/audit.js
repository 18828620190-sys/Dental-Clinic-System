import crypto from 'node:crypto';

export async function writeAudit(connection, actorUserId, actionType, entityType, entityId, options = {}) {
  await connection.execute(
    `INSERT INTO audit_log
      (actor_user_id, action_type, entity_type, entity_id, related_entity_id,
       correlation_id, before_status, after_status, reason, details_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorUserId || null,
      actionType,
      entityType,
      entityId === null || entityId === undefined ? null : String(entityId),
      options.relatedEntityId === null || options.relatedEntityId === undefined ? null : String(options.relatedEntityId),
      options.correlationId || crypto.randomUUID(),
      options.beforeStatus || null,
      options.afterStatus || null,
      options.reason || null,
      options.details ? JSON.stringify(options.details) : null,
      options.ipAddress || null
    ]
  );
}
