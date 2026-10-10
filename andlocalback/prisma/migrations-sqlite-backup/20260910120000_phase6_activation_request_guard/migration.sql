-- Active activation requests use a nullable unique key because SQLite does not
-- support partial unique indexes through Prisma's schema language. Resolved
-- requests keep this field NULL and therefore do not block future requests.
ALTER TABLE "CampaignActivationRequest" ADD COLUMN "activeRequestKey" TEXT;

-- A legacy database may already contain more than one unresolved request for
-- the same client/platform. Backfill only the oldest one so the migration is
-- deployable without deleting or silently resolving historical records. From
-- this migration onward the unique key prevents any new duplicate.
UPDATE "CampaignActivationRequest" AS "request"
SET "activeRequestKey" = "request"."clientId" || ':' || "request"."platform"
WHERE "request"."status" IN ('PENDING', 'IN_REVIEW')
  AND "request"."id" = (
    SELECT "candidate"."id"
    FROM "CampaignActivationRequest" AS "candidate"
    WHERE "candidate"."clientId" = "request"."clientId"
      AND "candidate"."platform" = "request"."platform"
      AND "candidate"."status" IN ('PENDING', 'IN_REVIEW')
    ORDER BY "candidate"."createdAt" ASC, "candidate"."id" ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX "CampaignActivationRequest_activeRequestKey_key"
ON "CampaignActivationRequest"("activeRequestKey");
