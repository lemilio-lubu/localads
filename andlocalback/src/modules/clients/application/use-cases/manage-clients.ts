import { ApplicationError } from "../../../../common/errors/application.error";
import { ClientProfileInput, validateClientProfile } from "../../domain/client-profile";
import { ClientAdminRepository, UpdateClientInput } from "../ports/client-admin.repository";

export class ManageClients {
  constructor(private readonly clients: ClientAdminRepository) {}

  list() { return this.clients.list(); }

  async get(id: string) {
    const client = await this.clients.findById(id);
    if (!client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return client;
  }

  create(input: ClientProfileInput) {
    validateClientProfile(input);
    return this.clients.create(input);
  }

  async update(id: string, input: UpdateClientInput) {
    const current = await this.get(id);
    validateClientProfile({
      name: input.name ?? current.name,
      email: input.email ?? current.email,
      accountType: input.accountType ?? current.account.type,
      platforms: input.platforms ?? current.account.platforms,
      creditDays: input.accountType === "PREPAGO" ? 0 : input.creditDays ?? current.account.creditDays,
    });
    const updated = await this.clients.update(id, input.accountType === "PREPAGO" ? { ...input, creditDays: 0 } : input);
    if (!updated) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return updated;
  }

  async deactivate(id: string) {
    const client = await this.clients.deactivate(id);
    if (!client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return client;
  }
}
