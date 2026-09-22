import { describe, expect, it } from "vitest";
import { ADMIN_SCOPE, clientOwnershipWhere, scopeFor, withUnassigned } from "./manager-scope";

/**
 * El recorte por cartera y el cubo de «sin asignar» condicionan el mismo campo,
 * asi que conviven en un solo sitio.
 *
 * Un cliente sin gestor es un estado valido: se crea sin asignar, o su gestor
 * se dio de baja soltando la cartera. Hasta ahora solo lo veia el admin por
 * ausencia de recorte, no porque nadie lo hubiera decidido.
 */
describe("alcance por cartera", () => {
  it("un admin sin filtro no recorta nada", () => {
    expect(clientOwnershipWhere(ADMIN_SCOPE)).toEqual({});
  });

  it("un gestor solo alcanza su cartera", () => {
    expect(clientOwnershipWhere({ managerId: "gestor-1" })).toEqual({ AND: [{ managerId: "gestor-1" }] });
  });

  it("el admin puede pedir el cubo de los que no tienen gestor", () => {
    expect(clientOwnershipWhere({ unassigned: true })).toEqual({ AND: [{ managerId: null }] });
  });

  /* La propiedad que importa: pedir el cubo no es una via para ver carteras
     ajenas. Las dos condiciones se combinan con AND sobre el mismo campo, asi
     que un gestor no obtiene huerfanos sino el conjunto vacio. */
  it("un gestor que pide el cubo no obtiene huerfanos ajenos, sino nada", () => {
    expect(clientOwnershipWhere({ managerId: "gestor-1", unassigned: true }))
      .toEqual({ AND: [{ managerId: "gestor-1" }, { managerId: null }] });
  });

  it("el alcance sale del rol y el filtro de la query, nunca al reves", () => {
    expect(scopeFor({ role: "GESTOR", userId: "g1" })).toEqual({ managerId: "g1" });
    expect(scopeFor({ role: "ADMIN", userId: "a1" })).toEqual({});
    expect(withUnassigned(scopeFor({ role: "ADMIN", userId: "a1" }), true)).toEqual({ unassigned: true });
    expect(withUnassigned(scopeFor({ role: "GESTOR", userId: "g1" }), false)).toEqual({ managerId: "g1" });
  });
});
