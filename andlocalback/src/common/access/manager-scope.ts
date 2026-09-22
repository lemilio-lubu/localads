/* Alcance de quien consulta el portal administrativo. Un admin no lleva
   recorte; un gestor solo alcanza a los clientes que tiene asignados.

   Se construye en el controller a partir del token y viaja como dato hasta la
   consulta. El frontend nunca lo envia: si lo enviara, seria un control de
   acceso en el cliente, y eso ya lo prohiben las guidelines del proyecto. */
export type ManagerScope = Readonly<{
  managerId?: string;
  /* Filtro del admin, no autoridad: «ensename lo que no tiene dueno». Un
     cliente sin gestor es un estado valido -se crea sin asignar, o su gestor
     se dio de baja soltando la cartera-, y hasta ahora solo lo veia el admin
     por ausencia de recorte, no porque nadie lo hubiera decidido.

     Convive con managerId en vez de excluirlo: los dos condicionan el mismo
     campo y se combinan con AND, asi que un gestor que pidiera este filtro no
     obtiene huerfanos ajenos sino nada, que es lo correcto. */
  unassigned?: boolean;
}>;

export const ADMIN_SCOPE: ManagerScope = {};

export function scopeFor(principal: Readonly<{ role: string; userId: string }>): ManagerScope {
  return principal.role === "GESTOR" ? { managerId: principal.userId } : ADMIN_SCOPE;
}

/* El filtro llega de la query y la autoridad del token: se combinan aqui para
   que ningun controller tenga que acordarse del orden. */
export function withUnassigned(scope: ManagerScope, unassigned: boolean): ManagerScope {
  return unassigned ? { ...scope, unassigned: true } : scope;
}

/* El recorte por cartera, en un solo sitio. Estaba escrito cuatro veces con
   la misma forma -`managerId ? { client: { is: { managerId } } } : {}`- y
   ahora ademas tiene que saber del cubo de sin asignar. */
export function clientOwnershipWhere(scope: ManagerScope): Readonly<Record<string, unknown>> {
  const conditions: Array<Record<string, unknown>> = [];
  if (scope.managerId) conditions.push({ managerId: scope.managerId });
  if (scope.unassigned) conditions.push({ managerId: null });
  if (!conditions.length) return {};
  return { AND: conditions };
}
