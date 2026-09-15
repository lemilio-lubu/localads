import { Module } from "@nestjs/common";
import { CLIENT_ADMIN_REPOSITORY, ClientAdminRepository } from "./application/ports/client-admin.repository";
import { ManageClients } from "./application/use-cases/manage-clients";
import { PrismaClientAdminRepository } from "./infrastructure/prisma-client-admin.repository";
import { ClientsController } from "./presentation/clients.controller";
import { RechargesModule } from "../recharges/recharges.module";

@Module({
  imports: [RechargesModule],
  controllers: [ClientsController],
  providers: [
    PrismaClientAdminRepository,
    { provide: CLIENT_ADMIN_REPOSITORY, useExisting: PrismaClientAdminRepository },
    {
      provide: ManageClients,
      inject: [CLIENT_ADMIN_REPOSITORY],
      useFactory: (clients: ClientAdminRepository) => new ManageClients(clients),
    },
  ],
})
export class ClientsModule {}
