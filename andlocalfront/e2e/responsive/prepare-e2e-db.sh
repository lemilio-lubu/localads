#!/usr/bin/env sh
# Prepara la base de datos de la suite responsive: una copia de dev.db en la
# que la suite puede escribir sin tocar tus datos. Arranca el backend contra
# ella con:
#   cd andlocalback && DATABASE_URL="file:./e2e.db" npm run start:dev
#
# Ajuste sobre la copia: deja TikTok inactivo en las dos cuentas demo, porque
# si no, el botón de reactivar no aparece y el modal de activación no se
# puede auditar.
set -eu
prisma_dir="$(cd "$(dirname "$0")/../../../andlocalback/prisma" && pwd)"
cp "$prisma_dir/dev.db" "$prisma_dir/e2e.db"
sqlite3 "$prisma_dir/e2e.db" "UPDATE Pauta SET status = 'INACTIVE' WHERE platform = 'TIKTOK' AND clientId IN ('client-001', 'client-002');"
echo "e2e.db lista en $prisma_dir"
