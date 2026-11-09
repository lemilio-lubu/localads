-- Los buscadores comparan sin tildes ni mayúsculas: «jose» encuentra «José».
-- `unaccent` viene con PostgreSQL (contrib); IF NOT EXISTS la deja idempotente.
CREATE EXTENSION IF NOT EXISTS unaccent;
