/* Mismo emisor de credenciales que usa el alta de clientes, visto desde este
   modulo: el equipo pide la clave por nombre de usuario, no por correo. */
export type IssuedCredentials = Readonly<{ username: string; temporaryPassword: string; passwordHash: string }>;

export interface TeamCredentialsIssuer {
  issue(username: string): Promise<IssuedCredentials>;
}

export const TEAM_CREDENTIALS_ISSUER = Symbol("TEAM_CREDENTIALS_ISSUER");
