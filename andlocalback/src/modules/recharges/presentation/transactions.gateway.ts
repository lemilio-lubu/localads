import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { AccessTokenService } from "../../auth/access-token.service";
import { AuthPrincipal } from "../../auth/auth.types";
import { VerificationRealtimeEvent, VerificationRealtimePublisher } from "../application/ports/transaction-verification.ports";

const accountRoom = (accountId: string) => `account:${accountId}`;

@WebSocketGateway({
  namespace: "/transactions",
  cors: { origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000", credentials: true },
})
export class TransactionsGateway implements VerificationRealtimePublisher, OnGatewayConnection {
  constructor(private readonly accessTokens: AccessTokenService) {}
  @WebSocketServer()
  private server!: Server;

  handleConnection(client: Socket) {
    const raw = typeof client.handshake.auth?.accessToken === "string" ? client.handshake.auth.accessToken : undefined;
    try {
      const user = this.accessTokens.verify(raw ?? "");
      client.data.user = user;
      if (user.role === "ADMIN") client.join("transactions:admin");
      if (user.role === "CLIENT" && user.accountId) client.join(accountRoom(user.accountId));
      if (user.role === "CLIENT" && user.clientId) client.join(`platforms:client:${user.clientId}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("transactions:subscribe")
  subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() input?: { scope?: "admin"; accountId?: string },
  ) {
    const user = client.data.user as AuthPrincipal | undefined;
    if (!user) return { event: "transactions:error", data: { message: "No autorizado" } };
    if (input?.scope === "admin" && user.role !== "ADMIN") {
      return { event: "transactions:error", data: { message: "No autorizado" } };
    }
    if (input?.accountId && (user.role !== "CLIENT" || user.accountId !== input.accountId)) {
      return { event: "transactions:error", data: { message: "No autorizado" } };
    }
    if (user.role === "ADMIN") client.join("transactions:admin");
    if (user.role === "CLIENT" && user.accountId) client.join(accountRoom(user.accountId));
    return { event: "transactions:subscribed", data: { connected: true } };
  }

  publishPlatforms(clientId: string) {
    this.server?.to("transactions:admin").to(`platforms:client:${clientId}`).emit("platforms:changed", { clientId });
  }

  publishVerification(event: VerificationRealtimeEvent) {
    const { accountId, ...payload } = event;
    this.server
      .to("transactions:admin")
      .to(accountRoom(accountId))
      .emit("verification:changed", payload);
  }
}
