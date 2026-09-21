import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { AccessTokenService } from "./access-token.service";
import { PasswordService } from "./password.service";
import { AuthPrincipal, isAuthRole } from "./auth.types";

const refreshTtlMs = 7 * 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthService {
  constructor(private readonly database: PrismaService, private readonly passwords: PasswordService, private readonly accessTokens: AccessTokenService) {}
  async login(username: string, password: string) {
    const user = await this.database.authUser.findUnique({ where: { username: username.trim().toLowerCase() } });
    if (!user || user.status !== "ACTIVE" || !(await this.passwords.verify(password, user.passwordHash))) throw new UnauthorizedException("Usuario o contraseña incorrectos");
    await this.assertCommercialAccess(user.clientId, user.accountId);
    return this.issue(this.principal(user), randomUUID());
  }
  async refresh(rawToken: string) {
    const session = await this.database.refreshSession.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!session) throw new UnauthorizedException("Refresh token no válido");
    if (session.revokedAt) { await this.database.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } }); throw new UnauthorizedException("La sesión fue revocada"); }
    if (session.expiresAt <= new Date() || session.user.status !== "ACTIVE") { await this.revoke(rawToken); throw new UnauthorizedException("La sesión expiró"); }
    await this.assertCommercialAccess(session.user.clientId, session.user.accountId);
    const nextRaw = randomBytes(48).toString("base64url"); const nextId = randomUUID(); const now = new Date();
    await this.database.$transaction([
      this.database.refreshSession.update({ where: { id: session.id }, data: { revokedAt: now, lastUsedAt: now, replacedById: nextId } }),
      this.database.refreshSession.create({ data: { id: nextId, userId: session.userId, familyId: session.familyId, tokenHash: hashToken(nextRaw), expiresAt: new Date(Date.now() + refreshTtlMs) } }),
    ]);
    const principal = this.principal(session.user); const access = this.accessTokens.sign(principal); return { principal, accessToken: access.token, expiresIn: access.expiresIn, refreshToken: nextRaw };
  }
  async revoke(rawToken: string | undefined) { if (!rawToken) return; await this.database.refreshSession.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } }); }
  private async issue(principal: AuthPrincipal, familyId: string) { const raw = randomBytes(48).toString("base64url"); await this.database.refreshSession.create({ data: { userId: principal.userId, familyId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + refreshTtlMs) } }); const access = this.accessTokens.sign(principal); return { principal, accessToken: access.token, expiresIn: access.expiresIn, refreshToken: raw }; }
  /* El rol llega de la base como texto libre. Un valor que no sea uno de los
     tres roles no puede firmarse en un token: antes se colaba con un `as` y el
     guard lo comparaba contra una lista que nunca iba a coincidir. */
  /* Cambiar la contrasena revoca todas las sesiones abiertas: si la temporal
     circulo por otro canal, cualquier sesion que la use muere aqui. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.database.authUser.findUnique({ where: { id: userId } });
    if (!user || !(await this.passwords.verify(currentPassword, user.passwordHash))) throw new UnauthorizedException("La contraseña actual no es correcta");
    if (await this.passwords.verify(newPassword, user.passwordHash)) throw new UnauthorizedException("La contraseña nueva debe ser distinta de la actual");
    const passwordHash = await this.passwords.hash(newPassword);
    await this.database.$transaction([
      this.database.authUser.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
      this.database.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { success: true };
  }

  private principal(user: { id: string; username: string; role: string; clientId: string | null; accountId: string | null; accountType: string | null; mustChangePassword?: boolean }): AuthPrincipal { if (!isAuthRole(user.role)) throw new UnauthorizedException("La cuenta no tiene un rol valido"); return { userId: user.id, username: user.username, role: user.role, clientId: user.clientId, accountId: user.accountId, accountType: user.accountType, mustChangePassword: user.mustChangePassword === true }; }
  private async assertCommercialAccess(clientId: string | null, accountId: string | null) { if (!clientId) return; const [client, account] = await Promise.all([this.database.client.findUnique({ where: { id: clientId } }), accountId ? this.database.account.findUnique({ where: { id: accountId } }) : null]); if (!client || client.status !== "ACTIVE" || !account || account.status !== "ACTIVE" || account.clientId !== clientId) throw new UnauthorizedException("La cuenta no está activa"); }
}

