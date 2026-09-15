import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AccessPayload, AuthPrincipal } from "./auth.types";

const issuer = "andlocal-api"; const audience = "andlocal-web"; const ttlSeconds = 15 * 60;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

@Injectable()
export class AccessTokenService {
  private readonly secret: string;
  constructor() {
    this.secret = process.env.JWT_ACCESS_SECRET ?? "development-only-change-this-jwt-secret";
    if (process.env.NODE_ENV === "production" && (!process.env.JWT_ACCESS_SECRET || this.secret.length < 32)) throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters in production");
  }
  sign(principal: AuthPrincipal): { token: string; expiresIn: number } {
    const now = Math.floor(Date.now() / 1000); const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({ ...principal, type: "access", iat: now, exp: now + ttlSeconds, iss: issuer, aud: audience });
    const signature = this.signature(`${header}.${payload}`); return { token: `${header}.${payload}.${signature}`, expiresIn: ttlSeconds };
  }
  verify(token: string): AccessPayload {
    const parts = token.split("."); if (parts.length !== 3) throw new Error("INVALID_TOKEN");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; typ?: string };
    if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("INVALID_TOKEN");
    const unsigned = `${parts[0]}.${parts[1]}`; const expected = Buffer.from(this.signature(unsigned)); const actual = Buffer.from(parts[2]);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("INVALID_TOKEN");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as AccessPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.type !== "access" || payload.iss !== issuer || payload.aud !== audience || !payload.exp || payload.exp <= now || !payload.userId || !["CLIENT", "ADMIN"].includes(payload.role)) throw new Error("INVALID_TOKEN");
    return payload;
  }
  private signature(value: string) { return createHmac("sha256", this.secret).update(value).digest("base64url"); }
}
