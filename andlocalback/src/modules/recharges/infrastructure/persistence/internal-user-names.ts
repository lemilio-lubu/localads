import { PrismaService } from "../../../../database/prisma.service";

/**
 * `decidedBy` y `reviewedBy` guardan el id del interno que tomo el caso.
 *
 * No hay relacion en el schema -son `String?` sueltos-, asi que el nombre se
 * resuelve aparte: una sola consulta por pagina, no una por fila. Sin esto la
 * pantalla solo podria enseñar `auth-admin`, que no le dice nada a nadie.
 */
export async function resolveInternalNames(
  prisma: PrismaService,
  ids: readonly (string | null | undefined)[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await prisma.authUser.findMany({ where: { id: { in: unique } }, select: { id: true, username: true } });
  return new Map(users.map((user) => [user.id, user.username]));
}
