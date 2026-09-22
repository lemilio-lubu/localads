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

/* A donde va la cartera cuando su gestor se da de baja. */
export type PortfolioDestination =
  | Readonly<{ kind: "reassign"; managerId: string }>
  | Readonly<{ kind: "release" }>;

export type TeamFilters = Readonly<{ role?: TeamRole; status?: "ACTIVE" | "INACTIVE"; search?: string }>;
export type UpdateTeamMemberInput = Partial<TeamMemberInput> & Readonly<{ status?: "ACTIVE" | "INACTIVE"; portfolio?: PortfolioDestination }>;

export interface TeamRepository {
  list(filters: TeamFilters): Promise<readonly TeamMemberView[]>;
  findById(id: string): Promise<TeamMemberDetailView | null>;
  create(input: TeamMemberInput, credentials: Readonly<{ username: string; passwordHash: string }>, createdById: string): Promise<TeamMemberView>;
  update(id: string, input: UpdateTeamMemberInput): Promise<TeamMemberView | null>;
  /* Dar de baja a un gestor nunca da de baja a sus clientes: el negocio sigue,
     cambia quien responde por el. Lo que si hace falta es decir por quien, y
     por eso el destino es obligatorio en la firma: soltar la cartera tiene que
     ser una eleccion escrita, no lo que pasa cuando nadie dice nada. */
  deactivate(id: string, destination: PortfolioDestination): Promise<Readonly<{ member: TeamMemberView; movedClients: number }> | null>;
  resetPassword(id: string, passwordHash: string): Promise<TeamMemberView | null>;
}

export const TEAM_REPOSITORY = Symbol("TEAM_REPOSITORY");
