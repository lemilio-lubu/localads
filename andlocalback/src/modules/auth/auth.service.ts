import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { AccessTokenService } from "./access-token.service";
import { PasswordService } from "./password.service";
import { AuthPrincipal, isAuthRole } from "./auth.types";
import { MfaSecretCipher } from "./mfa-secret-cipher";
import { passwordProblem } from "./password-policy";
import { lockoutUntil, refreshExpiry, refreshReuseGraceMs, sessionLimits } from "./session-policy";
import { SessionStateService } from "./session-state.service";
import { SECURITY_AUDIT_LOG, SecurityAuditLog } from "../../common/audit/security-audit.port";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUri, verifyTotp } from "./totp";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/* Un mismo mensaje para todo fallo de acceso: usuario inexistente, clave
   incorrecta, cuenta inactiva o bloqueada. Distinguirlos le diria a quien
   prueba correos cuales existen. El aviso del bloqueo va incluido para que la
   persona legitima sepa por que no entra. */
const invalidCredentials = "Correo o contraseña incorrectos. Tras varios intentos fallidos el acceso se bloquea unos minutos";
const invalidCode = "El código no es correcto. Tras varios intentos fallidos el acceso se bloquea unos minutos";
const expiredChallenge = "El paso de verificación caducó. Vuelve a iniciar sesión";
const mfaAlreadyEnabled = "El doble factor ya está activo en esta cuenta";

type UserRecord = Readonly<{
  id: string; username: string; role: string; status: string; clientId: string | null; accountId: string | null; accountType: string | null;
  mustChangePassword: boolean; tokenVersion: number; failedLoginCount: number; lockedUntil: Date | null;
  mfaSecret: string | null; mfaEnabledAt: Date | null; mfaLastStep: number | null; mfaRecoveryCodes: string[];
}>;

export type IssuedSession = Readonly<{
  kind: "session"; principal: AuthPrincipal; displayName: string; accessToken: string; expiresIn: number;
  refreshToken: string; refreshMaxAgeMs: number; recoveryCodesLeft?: number;
}>;
export type MfaChallenge = Readonly<{ kind: "mfa"; challengeToken: string }>;

@Injectable()
export class AuthService {
  /* Se compara contra este hash cuando el usuario no existe o esta bloqueado:
     la respuesta tarda lo mismo y el tiempo no delata nada. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly database: PrismaService,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly cipher: MfaSecretCipher,
    private readonly sessions: SessionStateService,
    @Inject(SECURITY_AUDIT_LOG) private readonly audit: SecurityAuditLog,
  ) {
    this.dummyHash = this.passwords.hash(randomBytes(16).toString("hex"));
  }

  async login(username: string, password: string): Promise<IssuedSession | MfaChallenge> {
    const user = await this.database.authUser.findUnique({ where: { username: username.trim().toLowerCase() } });
    if (!user || (user.lockedUntil && user.lockedUntil > new Date())) {
      await this.passwords.verify(password, await this.dummyHash);
      await this.audit.record({ action: "LOGIN_FAILED", outcome: "FAILURE", actorUserId: null, ...(user ? { target: { type: "USER", id: user.id } } : {}), detail: { reason: user ? "LOCKED" : "UNKNOWN_USER" } });
      throw new UnauthorizedException(invalidCredentials);
    }
    const validPassword = await this.passwords.verify(password, user.passwordHash);
    if (!validPassword || user.status !== "ACTIVE") {
      await this.audit.record({ action: "LOGIN_FAILED", outcome: "FAILURE", actorUserId: null, target: { type: "USER", id: user.id }, detail: { reason: validPassword ? "INACTIVE_USER" : "BAD_PASSWORD" } });
      await this.registerFailure(user);
      throw new UnauthorizedException(invalidCredentials);
    }
    try { await this.assertCommercialAccess(user.clientId, user.accountId); }
    catch (error) {
      await this.audit.record({ action: "LOGIN_FAILED", outcome: "FAILURE", actorUserId: null, target: { type: "USER", id: user.id }, detail: { reason: "INACTIVE_CLIENT" } });
      throw error;
    }
    /* Con el doble factor activo, la clave sola no abre sesion: devuelve un
       reto para el paso del codigo. Sin el, entra: activarlo es decision de
       cada uno, desde la pantalla de la cuenta. */
    if (user.mfaEnabledAt) return { kind: "mfa", challengeToken: this.accessTokens.signChallenge(user.id, "verify") };
    return this.completeLogin(user, "PASSWORD");
  }

  /* Segundo paso: un codigo de la app o uno de recuperacion. Las escrituras
     son condicionales: dos peticiones simultaneas con el mismo codigo no pueden
     abrir dos sesiones. */
  async verifyMfa(challengeToken: string, code: string): Promise<IssuedSession> {
    const user = await this.challengedUser(challengeToken);
    if (!user.mfaEnabledAt || !user.mfaSecret) throw new UnauthorizedException(expiredChallenge);
    const step = verifyTotp(this.cipher.decrypt(user.mfaSecret), code, user.mfaLastStep);
    if (step !== null) {
      const claimed = await this.database.authUser.updateMany({ where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
      if (claimed.count === 1) return this.completeLogin(user, "TOTP");
    }
    const recovery = hashRecoveryCode(code);
    if (user.mfaRecoveryCodes.includes(recovery)) {
      const remaining = user.mfaRecoveryCodes.filter((hash) => hash !== recovery);
      const claimed = await this.database.authUser.updateMany({ where: { id: user.id, mfaRecoveryCodes: { has: recovery } }, data: { mfaRecoveryCodes: remaining } });
      if (claimed.count === 1) {
        await this.audit.record({ action: "MFA_RECOVERY_CODE_USED", outcome: "SUCCESS", actorUserId: user.id, target: { type: "USER", id: user.id }, detail: { recoveryCodesLeft: remaining.length } });
        return { ...(await this.completeLogin(user, "RECOVERY_CODE")), recoveryCodesLeft: remaining.length };
      }
    }
    await this.audit.record({ action: "MFA_VERIFY_FAILED", outcome: "FAILURE", actorUserId: null, target: { type: "USER", id: user.id } });
    await this.registerFailure(user);
    throw new UnauthorizedException(invalidCode);
  }

  /* Alta del segundo factor, con la sesion ya abierta. El secreto se guarda
     ya (cifrado) pero no cuenta hasta que la persona demuestra con un codigo
     que lo tiene en su app. Pedirlo otra vez genera uno nuevo. */
  async startEnrollment(userId: string) {
    const user = await this.activeUser(userId);
    if (user.mfaEnabledAt) throw new BadRequestException(mfaAlreadyEnabled);
    const secret = generateTotpSecret();
    await this.database.authUser.update({ where: { id: user.id }, data: { mfaSecret: this.cipher.encrypt(secret), mfaLastStep: null } });
    return { secret, otpauthUri: otpauthUri(secret, user.username) };
  }

  /* Los codigos de recuperacion salen en esta respuesta y en ninguna otra. */
  async confirmEnrollment(userId: string, code: string) {
    const user = await this.activeUser(userId);
    if (user.mfaEnabledAt) throw new BadRequestException(mfaAlreadyEnabled);
    if (!user.mfaSecret) throw new BadRequestException("Primero genera el código QR");
    const step = verifyTotp(this.cipher.decrypt(user.mfaSecret), code, null);
    if (step === null) throw new BadRequestException("El código no es correcto. Revisa que la hora del móvil esté bien");
    const recoveryCodes = generateRecoveryCodes();
    const claimed = await this.database.authUser.updateMany({ where: { id: user.id, mfaEnabledAt: null, mfaSecret: user.mfaSecret }, data: { mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) } });
    if (claimed.count !== 1) throw new BadRequestException(mfaAlreadyEnabled);
    await this.audit.record({ action: "MFA_ENABLED", outcome: "SUCCESS", actorUserId: user.id, target: { type: "USER", id: user.id } });
    return { recoveryCodes };
  }

  async mfaStatus(userId: string) {
    const user = await this.activeUser(userId);
    return { enabled: user.mfaEnabledAt !== null, recoveryCodesLeft: user.mfaEnabledAt ? user.mfaRecoveryCodes.length : 0 };
  }

  /* Quitarlo pide la clave y un codigo (o uno de recuperacion): con una sesion
     abierta y desatendida no basta para dejar la cuenta solo con la clave. */
  async disableMfa(userId: string, password: string, code: string) {
    const user = await this.activeUser(userId);
    const denied = (reason: string) => this.audit.record({ action: "MFA_DISABLE_FAILED", outcome: "FAILURE", actorUserId: user.id, target: { type: "USER", id: user.id }, detail: { reason } });
    if (!(await this.passwords.verify(password, user.passwordHash))) { await denied("BAD_PASSWORD"); throw new UnauthorizedException("La contraseña no es correcta"); }
    if (!user.mfaEnabledAt || !user.mfaSecret) return { enabled: false };
    const validCode = verifyTotp(this.cipher.decrypt(user.mfaSecret), code, user.mfaLastStep) !== null || user.mfaRecoveryCodes.includes(hashRecoveryCode(code));
    if (!validCode) { await denied("BAD_CODE"); throw new BadRequestException("El código no es correcto"); }
    await this.database.authUser.update({ where: { id: user.id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] } });
    await this.audit.record({ action: "MFA_DISABLED", outcome: "SUCCESS", actorUserId: user.id, target: { type: "USER", id: user.id } });
    return { enabled: false };
  }

  async refresh(rawToken: string): Promise<IssuedSession> {
    const session = await this.database.refreshSession.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!session) throw new UnauthorizedException("Refresh token no válido");
    const now = new Date();
    if (session.revokedAt) {
      /* Dos renovaciones casi simultaneas (recargar con una en vuelo) no son
         un robo. Fuera del margen, o si el token se revoco sin sustituto
         (logout, cambio de clave), reutilizarlo tumba toda la familia. */
      const concurrent = session.replacedById !== null && now.getTime() - session.revokedAt.getTime() < refreshReuseGraceMs;
      if (!concurrent) {
        await this.database.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: now } });
        /* Solo cuenta como reutilizacion si el token tenia sustituto: uno
           revocado por logout o cambio de clave que vuelve no es un robo. */
        if (session.replacedById !== null) await this.audit.record({ action: "REFRESH_TOKEN_REUSED", outcome: "DENIED", actorUserId: null, target: { type: "USER", id: session.userId }, detail: { familyId: session.familyId } });
        throw new UnauthorizedException("La sesión fue revocada");
      }
    }
    if (session.expiresAt <= now || session.user.status !== "ACTIVE") { await this.revoke(rawToken); throw new UnauthorizedException("La sesión expiró"); }
    await this.assertCommercialAccess(session.user.clientId, session.user.accountId);
    const principal = this.principal(session.user);
    const nextRaw = randomBytes(48).toString("base64url"); const nextId = randomUUID();
    const create = this.database.refreshSession.create({ data: { id: nextId, userId: session.userId, familyId: session.familyId, familyCreatedAt: session.familyCreatedAt, tokenHash: hashToken(nextRaw), expiresAt: refreshExpiry(principal.role, session.familyCreatedAt, now) } });
    if (session.revokedAt) await create;
    else await this.database.$transaction([this.database.refreshSession.update({ where: { id: session.id }, data: { revokedAt: now, lastUsedAt: now, replacedById: nextId } }), create]);
    return this.session(principal, session.user.tokenVersion, nextRaw, session.familyCreatedAt);
  }

  /* Cerrar sesion: revoca el refresh de esta cookie y lo deja registrado si
     de verdad habia una sesion abierta. */
  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    const session = await this.database.refreshSession.findUnique({ where: { tokenHash }, select: { userId: true } });
    const revoked = await this.database.refreshSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    if (session && revoked.count === 1) await this.audit.record({ action: "LOGOUT", outcome: "SUCCESS", actorUserId: session.userId, target: { type: "USER", id: session.userId } });
  }

  async revoke(rawToken: string | undefined) { if (!rawToken) return; await this.database.refreshSession.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } }); }

  /* Cómo se ve a quien entró. El correo (o el usuario) es solo la credencial: a
     un cliente se le muestra su nombre o razón social, y al equipo su nombre.
     Si no hay (cuenta anterior, cliente borrado), cae al usuario. */
  async displayName(principal: AuthPrincipal): Promise<string> {
    if (principal.role !== "CLIENT" || !principal.clientId) {
      const user = await this.database.authUser.findUnique({ where: { id: principal.userId }, select: { name: true } });
      return user?.name?.trim() || principal.username;
    }
    const client = await this.database.client.findUnique({ where: { id: principal.clientId }, select: { name: true } });
    return client?.name.trim() || principal.username;
  }

  /* Cambiar la contrasena revoca todas las sesiones abiertas y sube la version
     del token: si la temporal circulo por otro canal, cualquier sesion que la
     use muere aqui, incluido el access token en curso. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.database.authUser.findUnique({ where: { id: userId } });
    if (!user || !(await this.passwords.verify(currentPassword, user.passwordHash))) {
      await this.audit.record({ action: "PASSWORD_CHANGE_FAILED", outcome: "FAILURE", actorUserId: userId, target: { type: "USER", id: userId }, detail: { reason: "BAD_CURRENT_PASSWORD" } });
      throw new UnauthorizedException("La contraseña actual no es correcta");
    }
    const problem = passwordProblem(newPassword, user.username);
    if (problem) throw new BadRequestException(problem);
    if (await this.passwords.verify(newPassword, user.passwordHash)) throw new BadRequestException("La contraseña nueva debe ser distinta de la actual");
    const passwordHash = await this.passwords.hash(newPassword);
    await this.database.$transaction([
      this.database.authUser.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null } }),
      this.database.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    this.sessions.invalidate(userId);
    await this.audit.record({ action: "PASSWORD_CHANGED", outcome: "SUCCESS", actorUserId: userId, target: { type: "USER", id: userId }, detail: { wasTemporary: user.mustChangePassword } });
    return { success: true };
  }

  private async challengedUser(challengeToken: string): Promise<UserRecord> {
    let userId: string;
    try { userId = this.accessTokens.verifyChallenge(challengeToken).userId; }
    catch { throw new UnauthorizedException(expiredChallenge); }
    const user = await this.database.authUser.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException(expiredChallenge);
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new UnauthorizedException(invalidCode);
    return user;
  }

  private async activeUser(userId: string) {
    const user = await this.database.authUser.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("La sesión ya no es válida");
    return user;
  }

  private async completeLogin(user: UserRecord, method: "PASSWORD" | "TOTP" | "RECOVERY_CODE"): Promise<IssuedSession> {
    const now = new Date();
    await this.database.authUser.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    const principal = this.principal(user);
    const raw = randomBytes(48).toString("base64url");
    await this.database.refreshSession.create({ data: { userId: user.id, familyId: randomUUID(), familyCreatedAt: now, tokenHash: hashToken(raw), expiresAt: refreshExpiry(principal.role, now, now) } });
    await this.audit.record({ action: "LOGIN_SUCCEEDED", outcome: "SUCCESS", actorUserId: user.id, target: { type: "USER", id: user.id }, detail: { method, role: principal.role } });
    return this.session(principal, user.tokenVersion, raw, now);
  }

  /* La cookie del refresh vive lo que le queda al tope absoluto de la sesion. */
  private async session(principal: AuthPrincipal, tokenVersion: number, refreshToken: string, familyCreatedAt: Date): Promise<IssuedSession> {
    const access = this.accessTokens.sign(principal, tokenVersion);
    const refreshMaxAgeMs = Math.max(0, familyCreatedAt.getTime() + sessionLimits(principal.role).absoluteMs - Date.now());
    return { kind: "session", principal, displayName: await this.displayName(principal), accessToken: access.token, expiresIn: access.expiresIn, refreshToken, refreshMaxAgeMs };
  }

  /* Mientras dura un bloqueo los intentos no suman: si no, quien conozca el
     correo podria alargarlo sin fin. Al vencer, cada fallo lo duplica. */
  private async registerFailure(user: Pick<UserRecord, "id" | "failedLoginCount" | "lockedUntil">) {
    if (user.lockedUntil && user.lockedUntil > new Date()) return;
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil = lockoutUntil(failedLoginCount);
    await this.database.authUser.update({ where: { id: user.id }, data: { failedLoginCount, lockedUntil } });
    if (lockedUntil) await this.audit.record({ action: "ACCOUNT_LOCKED", outcome: "DENIED", actorUserId: null, target: { type: "USER", id: user.id }, detail: { failedLoginCount, lockedUntil: lockedUntil.toISOString() } });
  }

  /* El rol llega de la base como texto libre. Un valor que no sea uno de los
     tres roles no puede firmarse en un token. */
  private principal(user: { id: string; username: string; role: string; clientId: string | null; accountId: string | null; accountType: string | null; mustChangePassword?: boolean }): AuthPrincipal { if (!isAuthRole(user.role)) throw new UnauthorizedException("La cuenta no tiene un rol valido"); return { userId: user.id, username: user.username, role: user.role, clientId: user.clientId, accountId: user.accountId, accountType: user.accountType, mustChangePassword: user.mustChangePassword === true }; }
  private async assertCommercialAccess(clientId: string | null, accountId: string | null) { if (!clientId) return; const [client, account] = await Promise.all([this.database.client.findUnique({ where: { id: clientId } }), accountId ? this.database.account.findUnique({ where: { id: accountId } }) : null]); if (!client || client.status !== "ACTIVE" || !account || account.status !== "ACTIVE" || account.clientId !== clientId) throw new UnauthorizedException("La cuenta no está activa"); }
}
