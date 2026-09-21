/* Alcance de quien consulta el portal administrativo. Un admin no lleva
   recorte; un gestor solo alcanza a los clientes que tiene asignados.

   Se construye en el controller a partir del token y viaja como dato hasta la
   consulta. El frontend nunca lo envia: si lo enviara, seria un control de
   acceso en el cliente, y eso ya lo prohiben las guidelines del proyecto. */
export type ManagerScope = Readonly<{ managerId?: string }>;

export const ADMIN_SCOPE: ManagerScope = {};

export function scopeFor(principal: Readonly<{ role: string; userId: string }>): ManagerScope {
  return principal.role === "GESTOR" ? { managerId: principal.userId } : ADMIN_SCOPE;
}
