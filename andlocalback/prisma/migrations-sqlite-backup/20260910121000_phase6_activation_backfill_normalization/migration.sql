-- Normalize the exceptional legacy case where multiple unresolved requests
-- existed before the uniqueness guard. Preserve every row for audit, keep the
-- oldest request open, and close later duplicates explicitly.
UPDATE "CampaignActivationRequest" AS "request"
SET "status" = 'REJECTED',
    "activeRequestKey" = NULL,
    "rejectionReason" = COALESCE(
      "request"."rejectionReason",
      'Solicitud duplicada normalizada durante migracion de activaciones'
    ),
    "reviewedAt" = COALESCE("request"."reviewedAt", CURRENT_TIMESTAMP),
    "version" = "request"."version" + 1
WHERE "request"."status" IN ('PENDING', 'IN_REVIEW')
  AND "request"."id" <> (
    SELECT "candidate"."id"
    FROM "CampaignActivationRequest" AS "candidate"
    WHERE "candidate"."clientId" = "request"."clientId"
      AND "candidate"."platform" = "request"."platform"
      AND "candidate"."status" IN ('PENDING', 'IN_REVIEW')
    ORDER BY "candidate"."createdAt" ASC, "candidate"."id" ASC
    LIMIT 1
  );

UPDATE "CampaignActivationRequest"
SET "activeRequestKey" = "clientId" || ':' || "platform"
WHERE "status" IN ('PENDING', 'IN_REVIEW');
