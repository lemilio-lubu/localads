import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { RecipientDirectoryPort } from "../application/ports/notification.ports";
import { EventSubject, RecipientContext } from "../domain/notification-catalog";

@Injectable()
export class PrismaRecipientDirectory implements RecipientDirectoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async contextFor(subject: EventSubject): Promise<RecipientContext | null> {
    /* La seguridad de una cuenta solo va a su dueño, si sigue activo. */
    if ("userId" in subject) {
      const owner = await this.prisma.authUser.findFirst({ where: { id: subject.userId, status: "ACTIVE" }, select: { id: true } });
      return owner ? { clientName: "", clientUsers: [], managerId: null, adminIds: [] } : null;
    }
    if ("system" in subject) {
      const admins = await this.prisma.authUser.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
      return { clientName: "", clientUsers: [], managerId: null, adminIds: admins.map((admin) => admin.id) };
    }
    const clientId = "clientId" in subject
      ? subject.clientId
      : (await this.prisma.rechargeTransaction.findUnique({ where: { id: subject.transactionId }, select: { clientId: true } }))?.clientId;
    if (!clientId) return null;
    const [client, admins] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: {
          name: true,
          manager: { select: { id: true, status: true } },
        },
      }),
      this.prisma.authUser.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } }),
    ]);
    if (!client) return null;
    const clientUsers = await this.prisma.authUser.findMany({
      where: { clientId, role: "CLIENT", status: "ACTIVE" },
      select: { id: true, accountType: true },
    });
    return {
      clientName: client.name,
      clientUsers: clientUsers.map((user) => ({ userId: user.id, accountType: user.accountType })),
      /* Un gestor dado de baja no recibe nada: el caso pasa a los admins. */
      managerId: client.manager?.status === "ACTIVE" ? client.manager.id : null,
      adminIds: admins.map((admin) => admin.id),
    };
  }
}
