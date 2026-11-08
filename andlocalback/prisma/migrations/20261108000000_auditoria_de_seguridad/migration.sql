-- CreateTable
CREATE TABLE "SecurityAuditEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorUserId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "detail" JSONB,

    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_occurredAt_idx" ON "SecurityAuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_actorUserId_occurredAt_idx" ON "SecurityAuditEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_action_occurredAt_idx" ON "SecurityAuditEvent"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_targetType_targetId_occurredAt_idx" ON "SecurityAuditEvent"("targetType", "targetId", "occurredAt");


-- Solo inserción. La app se conecta con el rol dueño de la tabla, así que un
-- REVOKE no le quitaría nada: lo impide un trigger, que salta con cualquier
-- rol. Borrarlo exige un cambio de esquema (DDL) y deja rastro en una
-- migración. La futura purga por retención (fase 3.6) tendrá que hacerse así.
CREATE FUNCTION "security_audit_event_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SecurityAuditEvent es de solo inserción (% bloqueado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "SecurityAuditEvent_no_update_delete"
  BEFORE UPDATE OR DELETE ON "SecurityAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "security_audit_event_append_only"();

CREATE TRIGGER "SecurityAuditEvent_no_truncate"
  BEFORE TRUNCATE ON "SecurityAuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "security_audit_event_append_only"();
