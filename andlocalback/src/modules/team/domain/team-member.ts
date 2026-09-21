import { ApplicationError } from "../../../common/errors/application.error";

/* El equipo son los usuarios internos. Un cliente nunca se administra desde
   aqui: tiene su propia pantalla, con plataformas, credito y recargas. */
export const TEAM_ROLES = ["ADMIN", "GESTOR"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const isTeamRole = (value: string): value is TeamRole => (TEAM_ROLES as readonly string[]).includes(value);

export type TeamMemberInput = Readonly<{ username: string; role: TeamRole; note?: string | null }>;

/* Minusculas, digitos, punto, guion y guion bajo. El usuario se dicta por
   telefono junto con la clave temporal, asi que no admite espacios ni
   mayusculas que obliguen a preguntar como se escribe. */
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,23}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateTeamMember(input: TeamMemberInput): void {
  if (!usernamePattern.test(normalizeUsername(input.username))) {
    throw new ApplicationError("INVALID_USERNAME", "El usuario admite de 3 a 24 caracteres: minusculas, numeros, punto, guion y guion bajo");
  }
  if (!isTeamRole(input.role)) {
    throw new ApplicationError("INVALID_TEAM_ROLE", "El rol del equipo solo puede ser administrador o gestor");
  }
  if (input.note !== undefined && input.note !== null && input.note.length > 500) {
    throw new ApplicationError("NOTE_TOO_LONG", "La nota no puede superar 500 caracteres");
  }
}
