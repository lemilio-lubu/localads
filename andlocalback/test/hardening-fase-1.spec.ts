import { describe, expect, it, vi } from "vitest";
import { environmentProblems } from "../src/common/config/environment";
import { AccessTokenService } from "../src/modules/auth/access-token.service";
import { AuthService, IssuedSession, MfaChallenge } from "../src/modules/auth/auth.service";
import { MfaSecretCipher } from "../src/modules/auth/mfa-secret-cipher";
import { PasswordService } from "../src/modules/auth/password.service";
import { passwordProblem } from "../src/modules/auth/password-policy";
import { lockoutUntil, refreshExpiry, sessionLimits, suggestsMfa } from "../src/modules/auth/session-policy";
import { SessionStateService } from "../src/modules/auth/session-state.service";
import { base32Decode, base32Encode, hotp, totpStep, verifyTotp } from "../src/modules/auth/totp";

const minute = 60_000; const hour = 60 * minute; const day = 24 * hour;

describe("TOTP (RFC 6238)", () => {
  /* Vector del apendice B de la RFC: secreto ASCII "12345678901234567890". */
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("reproduce el vector oficial de la RFC", () => {
    expect(hotp(base32Decode(rfcSecret), totpStep(59_000), 8)).toBe("94287082");
    expect(hotp(base32Decode(rfcSecret), totpStep(1_111_111_109_000), 8)).toBe("07081804");
  });

  it("acepta un paso de desfase y rechaza el mismo codigo dos veces", () => {
    const now = 1_700_000_000_000;
    const code = hotp(base32Decode(rfcSecret), totpStep(now) - 1);
    const step = verifyTotp(rfcSecret, code, null, now);
    expect(step).toBe(totpStep(now) - 1);
    expect(verifyTotp(rfcSecret, code, step, now)).toBeNull();
    expect(verifyTotp(rfcSecret, hotp(base32Decode(rfcSecret), totpStep(now) - 3), null, now)).toBeNull();
    expect(verifyTotp(rfcSecret, "12a456", null, now)).toBeNull();
  });
});

describe("cifrado del secreto MFA", () => {
  const key = Buffer.alloc(32, 3).toString("base64");

  it("cifra con IV aleatorio y descifra solo con la misma clave", () => {
    const cipher = MfaSecretCipher.fromEnv({ MFA_ENCRYPTION_KEY: key });
    const first = cipher.encrypt("JBSWY3DPEHPK3PXP");
    expect(first).not.toContain("JBSWY3DPEHPK3PXP");
    expect(cipher.encrypt("JBSWY3DPEHPK3PXP")).not.toBe(first);
    expect(cipher.decrypt(first)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => MfaSecretCipher.fromEnv({ MFA_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64") }).decrypt(first)).toThrow();
  });

  it("un despliegue sin clave no arranca, y una clave mal formada tampoco", () => {
    expect(() => MfaSecretCipher.fromEnv({ RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => MfaSecretCipher.fromEnv({ MFA_ENCRYPTION_KEY: "corta" })).toThrow(/32 bytes/);
    expect(environmentProblems({ NODE_ENV: "production", JWT_ACCESS_SECRET: "s".repeat(40), FRONTEND_ORIGIN: "https://x.ec", DATABASE_URL: "postgresql://x" }).join(" ")).toMatch(/MFA_ENCRYPTION_KEY/);
  });
});

describe("politicas de sesion y contrasena", () => {
  it("equipo: 12 h de tope y 30 min de inactividad; clientes: 7 dias y 1 dia", () => {
    expect(sessionLimits("ADMIN")).toEqual({ absoluteMs: 12 * hour, idleMs: 30 * minute });
    expect(sessionLimits("GESTOR")).toEqual({ absoluteMs: 12 * hour, idleMs: 30 * minute });
    expect(sessionLimits("CLIENT")).toEqual({ absoluteMs: 7 * day, idleMs: day });
  });

  it("el refresh caduca por inactividad o por el tope absoluto, lo que llegue antes", () => {
    const start = new Date("2026-11-02T08:00:00Z");
    expect(refreshExpiry("GESTOR", start, start).getTime()).toBe(start.getTime() + 30 * minute);
    const late = new Date(start.getTime() + 11 * hour + 50 * minute);
    expect(refreshExpiry("GESTOR", start, late).getTime()).toBe(start.getTime() + 12 * hour);
  });

  it("bloquea a los 5 fallos, duplica despues y nunca pasa de un dia", () => {
    const now = new Date(0);
    expect(lockoutUntil(4, now)).toBeNull();
    expect(lockoutUntil(5, now)?.getTime()).toBe(15 * minute);
    expect(lockoutUntil(6, now)?.getTime()).toBe(30 * minute);
    expect(lockoutUntil(40, now)?.getTime()).toBe(day);
  });

  it("el doble factor solo se le sugiere al equipo", () => {
    expect([suggestsMfa("ADMIN"), suggestsMfa("GESTOR"), suggestsMfa("CLIENT")]).toEqual([true, true, false]);
  });

  it("pide 12 caracteres, rechaza claves comunes o con el usuario y no exige simbolos", () => {
    expect(passwordProblem("corta")).toMatch(/12/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).toMatch(/común/);
    expect(passwordProblem("Contraseña123")).toMatch(/común/);
    expect(passwordProblem("marta-del-rio-2026", "marta@andlocal.ec")).toMatch(/usuario/);
    expect(passwordProblem("tres palabras cualquiera")).toBeNull();
  });
});

describe("revalidacion del access token", () => {
  function database(user: object | null, client: object | null = { status: "ACTIVE" }) {
    return { authUser: { findUnique: vi.fn().mockResolvedValue(user) }, client: { findUnique: vi.fn().mockResolvedValue(client) } };
  }

  it("un token con version vieja, de un usuario dado de baja o con otro rol deja de valer", async () => {
    const base = { status: "ACTIVE", role: "GESTOR", tokenVersion: 2, clientId: null };
    const payload = { userId: "u1", role: "GESTOR" as const, tv: 2 };
    expect(await new SessionStateService(database(base) as never).isCurrent(payload)).toBe(true);
    expect(await new SessionStateService(database(base) as never).isCurrent({ ...payload, tv: 1 })).toBe(false);
    expect(await new SessionStateService(database({ ...base, status: "INACTIVE" }) as never).isCurrent(payload)).toBe(false);
    expect(await new SessionStateService(database({ ...base, role: "ADMIN" }) as never).isCurrent(payload)).toBe(false);
    expect(await new SessionStateService(database(null) as never).isCurrent(payload)).toBe(false);
  });

  it("un cliente cuya ficha se dio de baja pierde el acceso aunque su usuario siga activo", async () => {
    const user = { status: "ACTIVE", role: "CLIENT", tokenVersion: 0, clientId: "c1" };
    expect(await new SessionStateService(database(user, { status: "INACTIVE" }) as never).isCurrent({ userId: "u1", role: "CLIENT" })).toBe(false);
  });

  it("guarda el estado 30 segundos e invalidate lo fuerza a releer", async () => {
    const db = database({ status: "ACTIVE", role: "ADMIN", tokenVersion: 0, clientId: null });
    const sessions = new SessionStateService(db as never);
    await sessions.isCurrent({ userId: "u1", role: "ADMIN" }, 0);
    await sessions.isCurrent({ userId: "u1", role: "ADMIN" }, 29_000);
    expect(db.authUser.findUnique).toHaveBeenCalledTimes(1);
    await sessions.isCurrent({ userId: "u1", role: "ADMIN" }, 31_000);
    sessions.invalidate("u1");
    await sessions.isCurrent({ userId: "u1", role: "ADMIN" }, 31_500);
    expect(db.authUser.findUnique).toHaveBeenCalledTimes(3);
  });

  it("un token firmado lleva la version y un reto MFA no sirve como access token", () => {
    const tokens = new AccessTokenService();
    const principal = { userId: "u1", username: "a@b.ec", role: "ADMIN" as const, clientId: null, accountId: null, accountType: null };
    expect(tokens.verify(tokens.sign(principal, 4).token).tv).toBe(4);
    const challenge = tokens.signChallenge("u1", "verify");
    expect(() => tokens.verify(challenge)).toThrow();
    expect(tokens.verifyChallenge(challenge)).toEqual({ userId: "u1", purpose: "verify" });
    expect(() => tokens.verifyChallenge(tokens.sign(principal).token)).toThrow();
  });
});

/* Base en memoria con lo justo de Prisma que usa AuthService. */
type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((part) => matches(row, part));
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as { lt?: number; has?: string };
      if ("lt" in c) return typeof value === "number" && value < (c.lt as number);
      if ("has" in c) return Array.isArray(value) && value.includes(c.has);
    }
    return value === condition;
  });
}
function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === "object" && "increment" in (value as Row) ? (row[key] as number) + ((value as { increment: number }).increment) : value;
  }
}
function memoryDatabase(users: Row[]) {
  const sessions: Row[] = [];
  const table = (rows: Row[], withUser = false) => ({
    findUnique: vi.fn(async ({ where }: { where: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? { ...row, ...(withUser ? { user: users.find((user) => user.id === row.userId) } : {}) } : null;
    }),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `s${rows.length + 1}`, revokedAt: null, replacedById: null, createdAt: new Date(), ...data }; rows.push(row); return row; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const row = rows.find((candidate) => matches(candidate, where)); if (!row) throw new Error("P2025"); apply(row, data); return row; }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const hit = rows.filter((candidate) => matches(candidate, where)); hit.forEach((row) => apply(row, data)); return { count: hit.length }; }),
  });
  return {
    sessions,
    authUser: table(users),
    refreshSession: table(sessions, true),
    client: { findUnique: vi.fn(async () => null) },
    account: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
}

describe("login, bloqueo y doble factor", () => {
  const passwords = new PasswordService();
  const cipher = MfaSecretCipher.fromEnv({});

  async function setup(role: "ADMIN" | "GESTOR" | "CLIENT", extra: Row = {}) {
    const user: Row = {
      id: "u1", username: "marta@andlocal.ec", name: "Marta", passwordHash: await passwords.hash("tres palabras cualquiera"), role, status: "ACTIVE",
      clientId: null, accountId: null, accountType: null, mustChangePassword: false, tokenVersion: 0, failedLoginCount: 0, lockedUntil: null,
      mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [], ...extra,
    };
    const db = memoryDatabase([user]);
    const tokens = new AccessTokenService();
    const auth = new AuthService(db as never, passwords, tokens, cipher, { invalidate: vi.fn() } as never);
    return { user, db, tokens, auth };
  }
  const codeFor = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep() + offset);

  it("cinco claves malas bloquean la cuenta y la buena tampoco entra mientras dura", async () => {
    const { user, auth } = await setup("CLIENT");
    for (let attempt = 0; attempt < 5; attempt += 1) await expect(auth.login("marta@andlocal.ec", "mala")).rejects.toThrow(/incorrectos/);
    expect(user.lockedUntil).toBeInstanceOf(Date);
    await expect(auth.login("marta@andlocal.ec", "tres palabras cualquiera")).rejects.toThrow(/incorrectos/);
    // Los intentos durante el bloqueo no lo alargan.
    expect(user.failedLoginCount).toBe(5);
  });

  it("el usuario inexistente responde igual que una clave mala", async () => {
    const { auth } = await setup("CLIENT");
    const unknown = await auth.login("nadie@andlocal.ec", "x").catch((error: Error) => error.message);
    const wrong = await auth.login("marta@andlocal.ec", "x").catch((error: Error) => error.message);
    expect(unknown).toBe(wrong);
  });

  it("un login correcto pone a cero los fallos y abre sesion a un cliente sin MFA", async () => {
    const { user, auth } = await setup("CLIENT");
    await auth.login("marta@andlocal.ec", "mala").catch(() => undefined);
    const result = await auth.login("marta@andlocal.ec", "tres palabras cualquiera");
    expect(result.kind).toBe("session");
    expect(user.failedLoginCount).toBe(0);
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it("el MFA es opcional: un admin sin el entra y se le sugiere; un cliente, no", async () => {
    const admin = await setup("ADMIN");
    await expect(admin.auth.login("marta@andlocal.ec", "tres palabras cualquiera")).resolves.toMatchObject({ kind: "session", mfaSuggested: true });
    const client = await setup("CLIENT");
    const session = await client.auth.login("marta@andlocal.ec", "tres palabras cualquiera") as IssuedSession;
    expect(session.mfaSuggested).toBeUndefined();
  });

  it("se activa con la sesion abierta y solo tras demostrar un codigo valido", async () => {
    const { user, auth } = await setup("CLIENT");
    const { secret, otpauthUri } = await auth.startEnrollment("u1");
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(user.mfaSecret).not.toContain(secret);
    await expect(auth.mfaStatus("u1")).resolves.toEqual({ enabled: false, recoveryCodesLeft: 0 });
    await expect(auth.confirmEnrollment("u1", "000000")).rejects.toThrow(/código/);
    const { recoveryCodes } = await auth.confirmEnrollment("u1", codeFor(secret));
    expect(recoveryCodes).toHaveLength(10);
    expect(user.mfaRecoveryCodes).not.toContain(recoveryCodes[0]);
    await expect(auth.mfaStatus("u1")).resolves.toEqual({ enabled: true, recoveryCodesLeft: 10 });
    await expect(auth.startEnrollment("u1")).rejects.toThrow(/ya está activo/);
    // Desde ahora la clave sola no abre sesion.
    await expect(auth.login("marta@andlocal.ec", "tres palabras cualquiera")).resolves.toMatchObject({ kind: "mfa" });
  });

  it("quitarlo pide la clave y un codigo", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const { user, auth } = await setup("GESTOR", { mfaSecret: cipher.encrypt(secret), mfaEnabledAt: new Date() });
    await expect(auth.disableMfa("u1", "mala", codeFor(secret))).rejects.toThrow(/contraseña/);
    await expect(auth.disableMfa("u1", "tres palabras cualquiera", "000000")).rejects.toThrow(/código/);
    await expect(auth.disableMfa("u1", "tres palabras cualquiera", codeFor(secret))).resolves.toEqual({ enabled: false });
    expect(user.mfaEnabledAt).toBeNull();
    expect(user.mfaSecret).toBeNull();
  });

  it("con MFA activo pide el codigo, no acepta repetirlo y acepta un codigo de recuperacion una sola vez", async () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const { hashRecoveryCode } = await import("../src/modules/auth/totp");
    const { auth } = await setup("ADMIN", { mfaSecret: cipher.encrypt(secret), mfaEnabledAt: new Date(), mfaRecoveryCodes: [hashRecoveryCode("abcde-fghjk")] });
    const first = await auth.login("marta@andlocal.ec", "tres palabras cualquiera") as MfaChallenge;
    expect(first.kind).toBe("mfa");
    await expect(auth.verifyMfa(first.challengeToken, codeFor(secret))).resolves.toMatchObject({ kind: "session" });

    const second = await auth.login("marta@andlocal.ec", "tres palabras cualquiera") as MfaChallenge;
    await expect(auth.verifyMfa(second.challengeToken, codeFor(secret))).rejects.toThrow(/código/);
    const recovered = await auth.verifyMfa(second.challengeToken, "ABCDE FGHJK");
    expect(recovered.recoveryCodesLeft).toBe(0);
    await expect(auth.verifyMfa(second.challengeToken, "abcde-fghjk")).rejects.toThrow(/código/);
  });

  it("los codigos MFA fallidos tambien cuentan para el bloqueo", async () => {
    const { user, auth } = await setup("ADMIN", { mfaSecret: cipher.encrypt("JBSWY3DPEHPK3PXP"), mfaEnabledAt: new Date() });
    const challenge = await auth.login("marta@andlocal.ec", "tres palabras cualquiera") as MfaChallenge;
    for (let attempt = 0; attempt < 5; attempt += 1) await auth.verifyMfa(challenge.challengeToken, "000000").catch(() => undefined);
    expect(user.lockedUntil).toBeInstanceOf(Date);
    await expect(auth.verifyMfa(challenge.challengeToken, codeFor("JBSWY3DPEHPK3PXP"))).rejects.toThrow();
  });

  it("un reto caducado o un access token no sirven como reto", async () => {
    const { auth, tokens } = await setup("ADMIN");
    const principal = { userId: "u1", username: "marta@andlocal.ec", role: "ADMIN" as const, clientId: null, accountId: null, accountType: null };
    await expect(auth.verifyMfa(tokens.sign(principal).token, "123456")).rejects.toThrow(/caducó/);
    await expect(auth.verifyMfa("basura", "123456")).rejects.toThrow(/caducó/);
  });

  describe("renovacion de la sesion", () => {
    async function clientSession() {
      const context = await setup("CLIENT");
      context.db.client.findUnique = vi.fn(async () => null);
      const session = await context.auth.login("marta@andlocal.ec", "tres palabras cualquiera") as IssuedSession;
      return { ...context, session };
    }

    it("dos renovaciones casi simultaneas con el mismo token no tumban la sesion", async () => {
      const { auth, session, db } = await clientSession();
      const first = await auth.refresh(session.refreshToken);
      const second = await auth.refresh(session.refreshToken);
      expect(first.refreshToken).not.toBe(second.refreshToken);
      expect(db.sessions.filter((row) => row.revokedAt === null)).toHaveLength(2);
    });

    it("reusar un token rotado fuera del margen revoca toda la familia", async () => {
      vi.useFakeTimers();
      try {
        const { auth, session, db } = await clientSession();
        const next = await auth.refresh(session.refreshToken);
        vi.advanceTimersByTime(31_000);
        await expect(auth.refresh(session.refreshToken)).rejects.toThrow(/revocada/);
        await expect(auth.refresh(next.refreshToken)).rejects.toThrow(/revocada/);
        expect(db.sessions.every((row) => row.revokedAt !== null)).toBe(true);
      } finally { vi.useRealTimers(); }
    });

    it("un token revocado por logout no tiene margen", async () => {
      const { auth, session } = await clientSession();
      await auth.revoke(session.refreshToken);
      await expect(auth.refresh(session.refreshToken)).rejects.toThrow(/revocada/);
    });

    it("la cookie vive lo que le queda al tope absoluto y la inactividad cierra la sesion", async () => {
      vi.useFakeTimers();
      try {
        const { auth, session } = await clientSession();
        expect(session.refreshMaxAgeMs).toBe(7 * day);
        vi.advanceTimersByTime(day + 1);
        await expect(auth.refresh(session.refreshToken)).rejects.toThrow(/expiró/);
      } finally { vi.useRealTimers(); }
    });

    it("renovar no estira el tope absoluto de la familia", async () => {
      vi.useFakeTimers();
      try {
        const { auth, session, db } = await clientSession();
        let token = session.refreshToken;
        for (let day_ = 0; day_ < 7; day_ += 1) { vi.advanceTimersByTime(day - minute); token = (await auth.refresh(token)).refreshToken; }
        const last = db.sessions.at(-1) as { expiresAt: Date; familyCreatedAt: Date };
        expect(last.expiresAt.getTime()).toBe(last.familyCreatedAt.getTime() + 7 * day);
      } finally { vi.useRealTimers(); }
    });
  });
});
