import { ApplicationError } from "../../../common/errors/application.error";

/* El equipo son los usuarios internos. Un cliente nunca se administra desde
   aqui: tiene su propia pantalla, con plataformas, credito y recargas. */
export const TEAM_ROLES = ["ADMIN", "GESTOR"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const isTeamRole = (value: string): value is TeamRole => (TEAM_ROLES as readonly string[]).includes(value);

export type TeamMemberInput = Readonly<{ username: string; role: TeamRole }>;

/* El usuario del equipo es su correo, igual que el de los clientes: un solo dato
   para entrar. El campo se sigue llamando `username` (es la columna y el nombre
   del contrato con el frontend) y guarda el correo en minusculas. Las cuentas
   anteriores, con un usuario que no es un correo, siguen entrando con el suyo
   hasta que alguien les ponga correo. */
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateTeamEmail(value: string): void {
  const email = normalizeUsername(value);
  if (email.length > 120 || !emailPattern.test(email)) {
    throw new ApplicationError("INVALID_USERNAME", "El correo no es válido");
  }
}

export function validateTeamRole(role: string): void {
  if (!isTeamRole(role)) {
    throw new ApplicationError("INVALID_TEAM_ROLE", "El rol del equipo solo puede ser administrador o gestor");
  }
}

export function validateTeamMember(input: TeamMemberInput): void {
  validateTeamEmail(input.username);
  validateTeamRole(input.role);
}
