import { Module } from "@nestjs/common";
import { RechargesModule } from "./modules/recharges/recharges.module";
import { DatabaseModule } from "./database/database.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { TeamModule } from "./modules/team/team.module";
import { PaymentAccountModule } from "./modules/payment-account/payment-account.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthController } from "./health.controller";

@Module({ imports: [DatabaseModule, AuthModule, RechargesModule, ClientsModule, TeamModule, PaymentAccountModule], controllers: [HealthController] })
export class AppModule {}
