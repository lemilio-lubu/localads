import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AccessPayload, AuthPrincipal, isAuthRole } from "./auth.types";
import { isDeployed } from "../../common/config/environment";

const issuer = "andlocal-api"; const audience = "andlocal-web"; const ttlSeconds = 15 * 60;
const challengeAudience = "andlocal-mfa"; const challengeTtlSeconds = 5 * 60;
export type MfaChallengePurpose = "verify";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

@Injectable()
export class AccessTokenService {
  private readonly secret: string;
  constructor() {
    /* El secreto por defecto solo vale fuera de un despliegue; main.ts ya lo
       comprueba al arrancar, y esto cubre a quien construya el servicio sin pasar por alli. */
    if (isDeployed() && (process.env.JWT_ACCESS_SECRET ?? "").length < 32) throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters when deployed");
    this.secret = process.env.JWT_ACCESS_SECRET ?? "development-only-change-this-jwt-secret";
  }
  /* tv (tokenVersion) permite matar los tokens ya firmados: el guard lo compara
     con el del usuario en la base. Un token sin tv cuenta como version 0. */
  sign(principal: AuthPrincipal, tokenVersion = 0): { token: string; expiresIn: number } {
    const now = Math.floor(Date.now() / 1000);
    return { token: this.encodeToken({ ...principal, tv: tokenVersion, type: "access", iat: now, exp: now + ttlSeconds, iss: issuer, aud: audience }), expiresIn: ttlSeconds };
  }
  verify(token: string): AccessPayload {
    const payload = this.decode(token) as AccessPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.type !== "access" || payload.iss !== issuer || payload.aud !== audience || !payload.exp || payload.exp <= now || !payload.userId || !isAuthRole(payload.role)) throw new Error("INVALID_TOKEN");
    return payload;
  }
  /* Entre la contrasena y el segundo factor no hay sesion: solo este token de
     cinco minutos que dice «la clave de este usuario ya se comprobo». Su
     audiencia es otra, asi que nunca sirve como token de acceso. */
  signChallenge(userId: string, purpose: MfaChallengePurpose): string {
    const now = Math.floor(Date.now() / 1000);
    return this.encodeToken({ userId, purpose, type: "mfa", iat: now, exp: now + challengeTtlSeconds, iss: issuer, aud: challengeAudience });
  }
  verifyChallenge(token: string): Readonly<{ userId: string; purpose: MfaChallengePurpose }> {
    const payload = this.decode(token) as { userId?: string; purpose?: string; type?: string; iss?: string; aud?: string; exp?: number };
    const now = Math.floor(Date.now() / 1000);
    if (payload.type !== "mfa" || payload.iss !== issuer || payload.aud !== challengeAudience || !payload.exp || payload.exp <= now || !payload.userId || payload.purpose !== "verify") throw new Error("INVALID_TOKEN");
    return { userId: payload.userId, purpose: payload.purpose };
  }
  private encodeToken(payload: object) {
    const header = encode({ alg: "HS256", typ: "JWT" }); const body = encode(payload);
    return `${header}.${body}.${this.signature(`${header}.${body}`)}`;
  }
  private decode(token: string): unknown {
    const parts = token.split("."); if (parts.length !== 3) throw new Error("INVALID_TOKEN");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; typ?: string };
    if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("INVALID_TOKEN");
    const expected = Buffer.from(this.signature(`${parts[0]}.${parts[1]}`)); const actual = Buffer.from(parts[2]);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("INVALID_TOKEN");
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  }
  private signature(value: string) { return createHmac("sha256", this.secret).update(value).digest("base64url"); }
}
