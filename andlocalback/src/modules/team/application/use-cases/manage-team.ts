import { ApplicationError } from "../../../../common/errors/application.error";
import { normalizeUsername, TeamMemberInput, validateTeamMember } from "../../domain/team-member";
import { TeamCredentialsIssuer } from "../ports/team-credentials.port";
import { PortfolioDestination, TeamFilters, TeamRepository, UpdateTeamMemberInput } from "../ports/team.repository";

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
    if (input.status === "INACTIVE") return this.deactivate(id, input.portfolio);
    const updated = await this.team.update(id, { ...input, ...(input.username ? { username: normalizeUsername(input.username) } : {}), ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}) });
    if (!updated) throw new ApplicationError("TEAM_MEMBER_NOT_FOUND", "El usuario no existe", 404);
    return updated;
  }

  /* Dar de baja a un gestor con cartera exige decir a donde va esa cartera.
     Antes se soltaba sola: un gestor con veinte clientes generaba veinte
     huerfanos de golpe, invisibles para todos los demas gestores y sin ninguna
     senal para el admin. Soltarla sigue siendo valido -`{ kind: "release" }`-,
     pero ahora hay que escribirlo.

     La cuenta viaja en el error para que la pantalla pueda decir cuantos
     clientes hay en juego sin pedirla por separado. */
  async deactivate(id: string, destination?: PortfolioDestination) {
    const member = await this.get(id);
    const portfolio = member.metrics.clients;
    if (portfolio > 0 && !destination) {
      throw new ApplicationError(
        "PORTFOLIO_DESTINATION_REQUIRED",
        `Este gestor tiene ${portfolio} ${portfolio === 1 ? "cliente asignado" : "clientes asignados"}: indica a quien pasan o marca que quedan sin asignar`,
        409,
      );
    }
    const result = await this.team.deactivate(id, destination ?? { kind: "release" });
    if (!result) throw new ApplicationError("TEAM_MEMBER_NOT_FOUND", "El usuario no existe", 404);
    return { ...result.member, movedClients: result.movedClients, portfolioDestination: destination?.kind ?? "release" };
  }

  async resetPassword(id: string) {
    const member = await this.get(id);
    const issued = await this.credentials.issue(member.username);
    const updated = await this.team.resetPassword(id, issued.passwordHash);
    if (!updated) throw new ApplicationError("TEAM_MEMBER_NOT_FOUND", "El usuario no existe", 404);
    return { ...updated, credentials: { username: member.username, temporaryPassword: issued.temporaryPassword } };
  }
}
