import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { isAuthRole } from "../../auth/auth.types";
import { EmailRecipient, EmailRecipientDirectoryPort } from "../application/ports/email.ports";

/* Solo usuarios activos de clientes activos, con el correo de su empresa.
   El equipo no recibe correo de avisos (decidido el 2026-11-25). */
@Injectable()
export class PrismaEmailRecipientDirectory implements EmailRecipientDirectoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async forUsers(userIds: readonly string[]): Promise<readonly EmailRecipient[]> {
    if (userIds.length === 0) return [];
    const users = await this.prisma.authUser.findMany({
      where: { id: { in: [...userIds] }, role: "CLIENT", status: "ACTIVE", clientId: { not: null } },
      select: { id: true, role: true, clientId: true },
    });
    const clientIds = [...new Set(users.flatMap((user) => (user.clientId ? [user.clientId] : [])))];
    if (clientIds.length === 0) return [];
    const clients = new Map((await this.prisma.client.findMany({
      where: { id: { in: clientIds }, status: "ACTIVE" },
      select: { id: true, email: true, name: true },
    })).map((client) => [client.id, client]));
    return users.flatMap((user) => {
      const client = user.clientId ? clients.get(user.clientId) : undefined;
      return client && isAuthRole(user.role) ? [{ userId: user.id, role: user.role, email: client.email, name: client.name }] : [];
    });
  }
}
