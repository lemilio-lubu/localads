import { Prisma, PrismaClient } from "@prisma/client";

/* Búsqueda de texto sin mayúsculas ni tildes: «perseo» encuentra «PERSEOSOFT
   S.A.» y «jose» encuentra «José». Prisma solo sabe ignorar mayúsculas
   (`mode: "insensitive"`), así que las columnas con nombres de personas,
   empresas o bancos pasan por `unaccent` (migración
   20261110000000_busqueda_sin_tildes) y la consulta devuelve ids, que el
   repositorio combina con el resto del filtro como `id: { in: … }`. */

/* Lista cerrada: tabla y columnas entran en el SQL como identificadores, así
   que nunca salen de la petición. */
const searchableColumns = {
  Client: ["name", "email"],
  AuthUser: ["username", "name"],
  OcrResult: ["bank"],
} as const;

type SearchableTable = keyof typeof searchableColumns;
type SearchableColumn<T extends SearchableTable> = (typeof searchableColumns)[T][number];

/** Tope de ids por búsqueda: de sobra para las tablas de clientes, equipo y OCR. */
export const textSearchIdLimit = 500;

/** Patrón LIKE con los comodines escapados: «50%» busca «50%» literal. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

/** Ids de `table` con algún valor de `columns` que contiene `term`, sin distinguir mayúsculas ni tildes. */
export async function idsMatchingText<T extends SearchableTable>(
  prisma: PrismaClient,
  table: T,
  columns: readonly SearchableColumn<T>[],
  term: string,
): Promise<string[]> {
  const pattern = containsPattern(term.trim());
  const conditions = columns.map((column) => Prisma.sql`unaccent(${Prisma.raw(`"${column}"`)}) ILIKE unaccent(${pattern})`);
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE ${Prisma.join(conditions, " OR ")} LIMIT ${textSearchIdLimit}`;
  return rows.map((row) => row.id);
}

/** Escapa los comodines de LIKE con la barra invertida, el escape por defecto de PostgreSQL. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Para códigos y textos sin tildes (código de transacción, comprobante): basta
 * con ignorar mayúsculas. Prisma no escapa los comodines de `contains`: sin
 * esto, buscar «%» devolvía todas las filas.
 */
export function containsIgnoringCase(term: string): Prisma.StringFilter {
  return { contains: escapeLike(term.trim()), mode: "insensitive" };
}
