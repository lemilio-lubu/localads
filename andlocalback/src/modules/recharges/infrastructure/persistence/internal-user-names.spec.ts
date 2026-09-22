import { describe, expect, it, vi } from "vitest";
import { resolveInternalNames } from "./internal-user-names";

const prismaWith = (users: ReadonlyArray<{ id: string; username: string }>) => {
  const findMany = vi.fn().mockResolvedValue([...users]);
  return { prisma: { authUser: { findMany } } as never, findMany };
};

/* `decidedBy` y `reviewedBy` guardan un id suelto, sin relacion en el schema.
   Se resuelven aparte para que la pantalla pueda decir quien tiene el caso en
   vez de enseñar «auth-admin». */
describe("nombres de los internos", () => {
  it("resuelve los ids a nombre", async () => {
    const { prisma } = prismaWith([{ id: "auth-admin", username: "admin" }]);
    const names = await resolveInternalNames(prisma, ["auth-admin"]);
    expect(names.get("auth-admin")).toBe("admin");
  });

  /* Una pagina repite al mismo administrador en muchas filas: se pregunta una
     vez por id distinto, no una por fila. */
  it("pregunta una sola vez por cada id distinto", async () => {
    const { prisma, findMany } = prismaWith([{ id: "a", username: "admin" }, { id: "b", username: "otro" }]);
    await resolveInternalNames(prisma, ["a", "a", "b", "a"]);
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany.mock.calls[0][0].where.id.in.sort()).toEqual(["a", "b"]);
  });

  /* Lo normal en una lista de pendientes es que nadie haya tomado nada: no
     tiene sentido ir a la base a preguntar por un conjunto vacio. */
  it.each([
    ["solo nulos", [null, undefined, null]],
    ["lista vacia", []],
  ])("no consulta cuando no hay a quien resolver (%s)", async (_label, ids) => {
    const { prisma, findMany } = prismaWith([]);
    await expect(resolveInternalNames(prisma, ids)).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it("un id sin usuario detras simplemente no aparece", async () => {
    const { prisma } = prismaWith([]);
    const names = await resolveInternalNames(prisma, ["borrado"]);
    expect(names.has("borrado")).toBe(false);
  });
});
