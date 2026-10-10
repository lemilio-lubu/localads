#!/usr/bin/env sh
# Prepara la base de datos de la suite responsive: una base PostgreSQL propia
# (localads_e2e), separada de la de desarrollo, en la que la suite puede
# escribir sin tocar tus datos.
#
#   1. sh e2e/responsive/prepare-e2e-db.sh
#   2. cd ../andlocalback && DATABASE_URL="<la misma URL>" npm run start:dev
#   3. node e2e/responsive/seed-e2e.mjs        (con el backend del paso 2)
#
# La URL sale de E2E_DATABASE_URL; por defecto, la base local con tu usuario.
#
# Sobre el seed del backend se ajusta lo que la suite necesita ver: un nombre
# de cliente de 60 caracteres, para comprobar qué se recorta y qué se parte.
# El resto de datos (transacciones, comprobantes, verificaciones, solicitudes
# de activación, un gestor más) los crea seed-e2e.mjs a través de la API,
# como lo haría la aplicación.
set -eu
url="${E2E_DATABASE_URL:-postgresql://${USER}@localhost:5432/localads_e2e?schema=public}"
database="$(printf '%s' "$url" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
backend="$(cd "$(dirname "$0")/../../../andlocalback" && pwd)"

dropdb --if-exists "$database"
createdb "$database"
(cd "$backend" && DATABASE_URL="$url" npx prisma migrate deploy && DATABASE_URL="$url" npm run prisma:seed)

psql -q -d "$database" -c "UPDATE \"Client\" SET name = 'Comercializadora Internacional de Productos del Litoral S.A.' WHERE id = 'client-001';"

echo "Base $database lista. Arranca el backend con DATABASE_URL=\"$url\" y ejecuta node e2e/responsive/seed-e2e.mjs"
