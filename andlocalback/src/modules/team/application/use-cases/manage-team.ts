import { ApplicationError } from "../../../../common/errors/application.error";
import { normalizeUsername, TeamMemberInput, validateTeamMember } from "../../domain/team-member";
import { TeamCredentialsIssuer } from "../ports/team-credentials.port";
import { TeamFilters, TeamRepository, UpdateTeamMemberInput } from "../ports/team.repository";

export class ManageTeam {
  constructor(private readonly team: TeamRepository, private readonly credentials: TeamCredentialsIssuer) {}

  list(filters: TeamFilters) { return this.team.list(filters); }

  async get(id: string) {
    const member = await this.team.findById(id);
    if (!member) throw new ApplicationError("TEAM_MEMBER_NOT_FOUND", "El usuario no existe", 404);
    return member;
  }

  /* La clave temporal viaja en claro una sola vez, en esta respuesta, y no
     vuelve a salir por ningun GET. Si se pierde, se restablece. */
  async create(input: TeamMemberInput, createdById: string) {
    validateTeamMember(input);
    const username = normalizeUsername(input.username);
    const issued = await this.credentials.issue(username);
    const member = await this.team.create({ ...input, username, note: input.note?.trim() || null }, { username, passwordHash: issued.passwordHash }, createdById);
    return { ...member, credentials: { username, temporaryPassword: issued.temporaryPassword } };
  }

  async update(id: string, input: UpdateTeamMemberInput) {
    const current = await this.get(id);
    validateTeamMember({ username: input.username ?? current.username, role: input.role ?? current.role, note: input.note ?? current.note });
    /* Desactivar pasa por su propio camino porque arrastra la cartera: un
     PATCH con status INACTIVE dejaria clientes apuntando a un gestor de baja. */
    if (input.status === "INACTIVE") return this.deactivate(id);
    const updated = await this.team.update(id, { ...input, ...(input.username ? { username: normalizeUsername(input.username) } : {}), ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}) });
    if (!updated) throw new ApplicationError("TEAM_MEMBER_NOT_FOUND", "El usuario no existe", 404);
    return updated;
  }

  async deactivate(id: string) {
    const result = await this.team.deactivate(id);
    if (!result) throw new ApplicationError("TEAM_MEMBER_NOT_FOUND", "El usuario no existe", 404);
    return { ...result.member, releasedClients: result.releasedClients };
  }

  async resetPassword(id: string) {
    const member = await this.get(id);
    const issued = await this.credentials.issue(member.username);
    const updated = await this.team.resetPassword(id, issued.passwordHash);
    if (!updated) throw new ApplicationError("TEAM_MEMBER_NOT_FOUND", "El usuario no existe", 404);
    return { ...updated, credentials: { username: member.username, temporaryPassword: issued.temporaryPassword } };
  }
}
