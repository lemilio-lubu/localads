import { ManagerScope } from "../../../../common/access/manager-scope";
import { ApplicationError } from "../../../../common/errors/application.error";
import { ClientProfileInput, validateClientProfile } from "../../domain/client-profile";
import { validateRuc } from "../../domain/ruc";
import { ClientAdminRepository, UpdateClientInput } from "../ports/client-admin.repository";
import { ClientCredentialsIssuer } from "../ports/client-credentials.port";

export class ManageClients {
  constructor(private readonly clients: ClientAdminRepository, private readonly credentials: ClientCredentialsIssuer) {}

  list(scope: ManagerScope) { return this.clients.list(scope); }

  /* Un cliente fuera del alcance responde 404, igual que uno inexistente: un
     403 confirmaria que existe y de quien es. */
  async get(id: string, scope: ManagerScope) {
    const client = await this.clients.findById(id, scope);
    if (!client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return client;
  }

  /* La clave temporal se devuelve en claro una sola vez, aqui, y no vuelve a
     salir por ningun GET. Si se pierde, el camino es restablecerla. */
  /* Un gestor se asigna a si mismo el cliente que crea, tomando el id del
     token; lo que pida el cuerpo se ignora. Un admin elige gestor o lo deja
     sin asignar. */
  async create(profile: ClientProfileInput, scope: ManagerScope, requestedManagerId?: string | null) {
    const input = { ...profile, ruc: validateRuc(profile.ruc) };
    validateClientProfile(input);
    const managerId = scope.managerId ?? requestedManagerId?.trim() ?? null;
    const { username, temporaryPassword, passwordHash } = await this.credentials.prepare(input.email);
    const client = await this.clients.create(input, { username, passwordHash }, managerId || null);
    return { ...client, credentials: { username, temporaryPassword } };
  }

  /* El RUC es opcional en el cuerpo (no cambiarlo), pero si llega se valida
     igual que al crear: vacio no es una forma de borrarlo. */
  async update(id: string, changes: UpdateClientInput, scope: ManagerScope) {
    const current = await this.get(id, scope);
    const input = changes.ruc === undefined ? changes : { ...changes, ruc: validateRuc(changes.ruc) };
    validateClientProfile({
      name: input.name ?? current.name,
      email: input.email ?? current.email,
      ruc: input.ruc ?? current.ruc ?? "",
      accountType: input.accountType ?? current.account.type,
      platforms: input.platforms ?? current.account.platforms,
      creditDays: input.accountType === "PREPAGO" ? 0 : input.creditDays ?? current.account.creditDays,
    });
    const updated = await this.clients.update(id, input.accountType === "PREPAGO" ? { ...input, creditDays: 0 } : input);
    if (!updated) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return updated;
  }

  /* Reasignar es cosa del admin: el alcance vacio no es un descuido, es que un
     gestor no puede mover clientes, ni suyos ni ajenos. */
  async assignManager(id: string, managerId: string | null) {
    await this.get(id, {});
    const updated = await this.clients.assignManager(id, managerId);
    if (updated === undefined) throw new ApplicationError("MANAGER_NOT_ACTIVE", "El gestor no existe o no esta activo", 409);
    if (!updated) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return updated;
  }

  async deactivate(id: string, scope: ManagerScope) {
    await this.get(id, scope);
    const client = await this.clients.deactivate(id);
    if (!client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return client;
  }
}
