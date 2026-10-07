-- Pauta is authoritative. Preserve Campaign identities and history; only
-- synchronize the legacy projection, including activations approved before this release.
UPDATE "Campaign"
SET "status" = (
  SELECT CASE WHEN p."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END
  FROM "Pauta" p JOIN "Account" a ON a."clientId" = p."clientId"
  WHERE a."id" = "Campaign"."accountId" AND p."platform" = "Campaign"."platform"
)
WHERE EXISTS (
  SELECT 1 FROM "Pauta" p JOIN "Account" a ON a."clientId" = p."clientId"
  WHERE a."id" = "Campaign"."accountId" AND p."platform" = "Campaign"."platform"
);

INSERT INTO "Campaign" ("id", "accountId", "platform", "status")
SELECT 'lifecycle-' || lower(hex(randomblob(16))), a."id", p."platform",
       CASE WHEN p."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END
FROM "Pauta" p JOIN "Account" a ON a."clientId" = p."clientId"
WHERE NOT EXISTS (SELECT 1 FROM "Campaign" c WHERE c."accountId" = a."id" AND c."platform" = p."platform");
