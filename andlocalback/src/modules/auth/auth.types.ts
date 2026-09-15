export type AuthRole = "CLIENT" | "ADMIN";
export type AuthPrincipal = Readonly<{ userId: string; username: string; role: AuthRole; clientId: string | null; accountId: string | null; accountType: string | null }>;
export type AccessPayload = AuthPrincipal & Readonly<{ type: "access"; iat: number; exp: number; iss: string; aud: string }>;

