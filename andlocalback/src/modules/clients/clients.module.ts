import { Module } from "@nestjs/common";
import { CLIENT_ADMIN_REPOSITORY, ClientAdminRepository } from "./application/ports/client-admin.repository";
import { CLIENT_CREDENTIALS_ISSUER, ClientCredentialsIssuer } from "./application/ports/client-credentials.port";
import { ManageClients } from "./application/use-cases/manage-clients";
import { PrismaClientAdminRepository } from "./infrastructure/prisma-client-admin.repository";
import { ClientsController } from "./presentation/clients.controller";
import { RechargesModule } from "../recharges/recharges.module";
import { AuthModule } from "../auth/auth.module";
import { CredentialsService } from "../auth/credentials.service";

@Module({
  imports: [RechargesModule, AuthModule],
  controllers: [ClientsController],
  providers: [
    PrismaClientAdminRepository,
    { provide: CLIENT_ADMIN_REPOSITORY, useExisting: PrismaClientAdminRepository },
    { provide: CLIENT_CREDENTIALS_ISSUER, useExisting: CredentialsService },
    {
      provide: ManageClients,
      inject: [CLIENT_ADMIN_REPOSITORY, CLIENT_CREDENTIALS_ISSUER],
      useFactory: (clients: ClientAdminRepository, credentials: ClientCredentialsIssuer) => new ManageClients(clients, credentials),
    },
  ],
})
export class ClientsModule {}
