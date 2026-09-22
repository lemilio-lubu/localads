import { Inject } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { AccessTokenService } from "../../auth/access-token.service";
import { AuthPrincipal } from "../../auth/auth.types";
import { MANAGER_SCOPE_QUERY, ManagerScopeQueryPort } from "../application/ports/manager-scope.ports";
import { VerificationRealtimeEvent, VerificationRealtimePublisher } from "../application/ports/transaction-verification.ports";

const accountRoom = (accountId: string) => `account:${accountId}`;
/* Un gestor no puede entrar en `transactions:admin`: por ahi viajan clientId,
   accountId y estados de transacciones de toda la cartera, no solo de la suya.
   Tiene sala propia y los eventos se le enrutan uno a uno. */
const managerRoom = (managerId: string) => `manager:${managerId}`;

@WebSocketGateway({
  namespace: "/transactions",
  cors: { origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000", credentials: true },
})
export class TransactionsGateway implements VerificationRealtimePublisher, OnGatewayConnection {
  constructor(
    private readonly accessTokens: AccessTokenService,
    @Inject(MANAGER_SCOPE_QUERY) private readonly scopeQueries: ManagerScopeQueryPort,
  ) {}
  @WebSocketServer()
  private server!: Server;

  handleConnection(client: Socket) {
    const raw = typeof client.handshake.auth?.accessToken === "string" ? client.handshake.auth.accessToken : undefined;
    try {
      const user = this.accessTokens.verify(raw ?? "");
      client.data.user = user;
      this.joinRooms(client, user);
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
    /* `scope: "admin"` nombra la vista de back-office, no el rol: admin y
       gestor comparten esas pantallas y cada uno entra en su propia sala.
       Mientras el gestor quedo fuera de este `if`, su pantalla recibia
       `transactions:error` y no se refrescaba sola. */
    if (input?.scope === "admin" && user.role !== "ADMIN" && user.role !== "GESTOR") {
      return { event: "transactions:error", data: { message: "No autorizado" } };
    }
    if (input?.accountId && (user.role !== "CLIENT" || user.accountId !== input.accountId)) {
      return { event: "transactions:error", data: { message: "No autorizado" } };
    }
    this.joinRooms(client, user);
    return { event: "transactions:subscribed", data: { connected: true } };
  }

  private joinRooms(client: Socket, user: AuthPrincipal) {
    if (user.role === "ADMIN") client.join("transactions:admin");
    if (user.role === "GESTOR") client.join(managerRoom(user.userId));
    if (user.role === "CLIENT" && user.accountId) client.join(accountRoom(user.accountId));
    if (user.role === "CLIENT" && user.clientId) client.join(`platforms:client:${user.clientId}`);
  }

  publishPlatforms(clientId: string) {
    this.fanOut("platforms:changed", { clientId }, [`platforms:client:${clientId}`], () =>
      this.scopeQueries.managerOfClient(clientId));
  }

  publishVerification(event: VerificationRealtimeEvent) {
    const { accountId, ...payload } = event;
    this.fanOut("verification:changed", payload, [accountRoom(accountId)], () =>
      this.scopeQueries.managerOfAccount(accountId));
  }

  /* El admin y el interesado salen ya; la sala del gestor exige una consulta
     para saber de quien es el cliente, asi que se resuelve aparte y no
     retrasa a los demas. Las salas son disjuntas —un socket esta en una sola—,
     de modo que nadie recibe el evento dos veces.

     Si la consulta falla, el evento del gestor se pierde y nada mas: el tiempo
     real es una mejora sobre una pantalla que tambien sabe recargarse, y no
     puede tumbar la decision que acaba de tomarse. */
  private fanOut(event: string, payload: object, rooms: readonly string[], managerOf: () => Promise<string | null>) {
    if (!this.server) return;
    rooms.reduce((target, room) => target.to(room), this.server.to("transactions:admin")).emit(event, payload);
    /* `Promise.resolve().then(managerOf)` y no `managerOf()` a secas: si la
       consulta revienta de forma sincrona —una dependencia sin inyectar, por
       ejemplo— un `.catch` encadenado no llega a verlo y la excepcion sube
       hasta quien acaba de aprobar. Asi cualquier fallo, sincrono o no,
       termina en el mismo sitio. */
    void Promise.resolve()
      .then(managerOf)
      .then((managerId) => { if (managerId) this.server?.to(managerRoom(managerId)).emit(event, payload); })
      .catch(() => undefined);
  }
}
