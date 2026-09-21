import { TeamMemberInput, TeamRole } from "../../domain/team-member";

export type TeamMemberView = Readonly<{
  id: string;
  username: string;
  role: TeamRole;
  status: "ACTIVE" | "INACTIVE";
  note: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  /* Las dos cajas del mockup. «cuentas» son los clientes asignados y «ventas»
     las recargas completadas de esa cartera: ambas solo tienen sentido para un
     gestor, y en un admin salen en cero. */
  metrics: Readonly<{ clients: number; sales: number }>;
}>;

export type TeamMemberClientView = Readonly<{ id: string; name: string; status: "ACTIVE" | "INACTIVE" }>;
export type TeamMemberSaleView = Readonly<{ id: string; code: string; clientId: string; clientName: string; pautaAmount: number; totalAmount: number; createdAt: string }>;

export type TeamMemberDetailView = TeamMemberView & Readonly<{
  clients: readonly TeamMemberClientView[];
  sales: readonly TeamMemberSaleView[];
}>;

export type TeamFilters = Readonly<{ role?: TeamRole; status?: "ACTIVE" | "INACTIVE"; search?: string }>;
export type UpdateTeamMemberInput = Partial<TeamMemberInput> & Readonly<{ status?: "ACTIVE" | "INACTIVE" }>;

export interface TeamRepository {
  list(filters: TeamFilters): Promise<readonly TeamMemberView[]>;
  findById(id: string): Promise<TeamMemberDetailView | null>;
  create(input: TeamMemberInput, credentials: Readonly<{ username: string; passwordHash: string }>, createdById: string): Promise<TeamMemberView>;
  update(id: string, input: UpdateTeamMemberInput): Promise<TeamMemberView | null>;
  /* Dar de baja a un gestor deja a sus clientes sin asignar, no los da de
     baja: el negocio sigue, cambia quien responde por el. */
  deactivate(id: string): Promise<Readonly<{ member: TeamMemberView; releasedClients: number }> | null>;
  resetPassword(id: string, passwordHash: string): Promise<TeamMemberView | null>;
}

export const TEAM_REPOSITORY = Symbol("TEAM_REPOSITORY");
