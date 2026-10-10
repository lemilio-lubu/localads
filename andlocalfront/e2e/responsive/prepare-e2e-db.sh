#!/usr/bin/env sh
# Prepara la base de datos de la suite responsive: una copia de dev.db en la
# que la suite puede escribir sin tocar tus datos. Arranca el backend contra
# ella con:
#   cd andlocalback && DATABASE_URL="file:./e2e.db" npm run start:dev
#
# Ajustes sobre la copia: deja TikTok inactivo en las dos cuentas demo (si
# no, el botón de reactivar no aparece y el modal de activación no se puede
# auditar) y mete datos largos.
set -eu
prisma_dir="$(cd "$(dirname "$0")/../../../andlocalback/prisma" && pwd)"
cp "$prisma_dir/dev.db" "$prisma_dir/e2e.db"
sqlite3 "$prisma_dir/e2e.db" "UPDATE Pauta SET status = 'INACTIVE' WHERE platform = 'TIKTOK' AND clientId IN ('client-001', 'client-002');"
# Datos largos a propósito: un nombre de 60 caracteres en la cuenta prepago
# (sale en transacciones, verificaciones y detalles) y un correo largo en un
# cliente sin cartera, para ver qué se recorta y qué se parte.
sqlite3 "$prisma_dir/e2e.db" "UPDATE Client SET name = 'Comercializadora Internacional de Productos del Litoral S.A.' WHERE id = 'client-001';"
sqlite3 "$prisma_dir/e2e.db" "UPDATE Client SET email = 'facturacion.electronica.departamento.contable@empresa-ejemplo.com.ec' WHERE id = 'ae2024ff-7187-487c-9c1a-f35aa83237b3';"
echo "e2e.db lista en $prisma_dir"
