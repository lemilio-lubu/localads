import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AccessPayload } from "./auth.types";

type UserState = Readonly<{ active: boolean; role: string; tokenVersion: number }>;
const ttlMs = 30_000;

/* Un access token vale 15 minutos aunque en ese tiempo den de baja a la
   persona, le cambien el rol o le restablezcan la clave. Este servicio cierra
   ese hueco: cada token se contrasta con el estado del usuario en la base.
   Para no consultarla en cada peticion, el estado se guarda 30 segundos; ese
   es el retraso maximo con el que una baja corta el acceso. */
@Injectable()
export class SessionStateService {
  private readonly cache = new Map<string, Readonly<{ state: UserState | null; at: number }>>();

  constructor(private readonly database: PrismaService) {}

  async isCurrent(payload: Pick<AccessPayload, "userId" | "role" | "tv">, now = Date.now()): Promise<boolean> {
    const state = await this.state(payload.userId, now);
    return Boolean(state?.active && state.role === payload.role && state.tokenVersion === (payload.tv ?? 0));
  }

  /* Tras un cambio hecho por este mismo proceso, no esperar a que caduque. */
  invalidate(userId: string) { this.cache.delete(userId); }

  private async state(userId: string, now: number): Promise<UserState | null> {
    const cached = this.cache.get(userId);
    if (cached && now - cached.at < ttlMs) return cached.state;
    const user = await this.database.authUser.findUnique({ where: { id: userId }, select: { status: true, role: true, tokenVersion: true, clientId: true } });
    let active = user?.status === "ACTIVE";
    /* Un cliente deja de operar cuando se da de baja su ficha, aunque su
       usuario siga activo: la baja del cliente no toca AuthUser. */
    if (user && active && user.role === "CLIENT") {
      const client = user.clientId ? await this.database.client.findUnique({ where: { id: user.clientId }, select: { status: true } }) : null;
      active = client?.status === "ACTIVE";
    }
    const state = user ? { active, role: user.role, tokenVersion: user.tokenVersion } : null;
    this.cache.set(userId, { state, at: now });
    if (this.cache.size > 5_000) this.cache.delete(this.cache.keys().next().value as string);
    return state;
  }
}
