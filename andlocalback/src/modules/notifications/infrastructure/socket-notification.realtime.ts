import { Injectable } from "@nestjs/common";
import { TransactionsGateway } from "../../recharges/presentation/transactions.gateway";
import { NotificationRealtimePort } from "../application/ports/notification.ports";

/* Reutiliza la conexión de socket que ya tiene cada pestaña: notificaciones
   depende del gateway, no al revés. */
@Injectable()
export class SocketNotificationRealtime implements NotificationRealtimePort {
  constructor(private readonly gateway: TransactionsGateway) {}

  notifyUser(userId: string, unread: number): void {
    try {
      this.gateway.emitToUser(userId, "notifications:changed", { unread });
    } catch {
      /* El contador en vivo es una mejora; la bandeja se corrige al abrirse. */
    }
  }
}
