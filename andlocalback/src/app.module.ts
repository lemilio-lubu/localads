import { Module } from "@nestjs/common";
import { RechargesModule } from "./modules/recharges/recharges.module";
import { DatabaseModule } from "./database/database.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { AuthModule } from "./modules/auth/auth.module";

@Module({ imports: [DatabaseModule, AuthModule, RechargesModule, ClientsModule] })
export class AppModule {}
